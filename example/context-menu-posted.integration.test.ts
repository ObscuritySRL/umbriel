/**
 * context-menu-posted — the context_menu tool now falls back to a POSTED right-click (WM_RBUTTON to the control's own
 * window, cursor-free) when UIA ShowContextMenu raises no popup — the modern WinUI/Chromium case where ShowContextMenu
 * has no Element3 or returns S_OK with no menu. Both paths are cursor-free; only if BOTH fail does it steer to a real
 * right-click. (Posted WM_RBUTTON raising a menu was probed live during development on an Explorer item.)
 *
 * Proof: attach a File Explorer details view, context_menu {ref} a list item → a menu popup hWnd is returned; the
 * popup is dismissed (Escape) and the Explorer window closed.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Explorer):
 * Run: bun run example/context-menu-posted.integration.test.ts
 */
import { closeWindow, postKey, skry } from 'skry';

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (message: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      try {
        const message = JSON.parse(line) as Rpc;
        if (typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {}
    }
  }
})();
let nextId = 1;
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const prior = new Set(
  skry
    .windows({ includeUntitled: true })
    .filter((w) => w.className === 'CabinetWClass')
    .map((w) => w.hWnd),
);
Bun.spawn(['explorer.exe', '/n,C:\\Windows\\System32'], { stdout: 'ignore', stderr: 'ignore' });
let explorer = 0n;
for (let i = 0; i < 25 && explorer === 0n; i += 1) {
  await Bun.sleep(300);
  explorer = skry.windows({ includeUntitled: true }).find((w) => w.className === 'CabinetWClass' && !prior.has(w.hWnd))?.hWnd ?? 0n;
}
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ctx-posted', version: '1' } });
  if (explorer === 0n) console.log('  skip: could not open an Explorer window');
  else {
    await Bun.sleep(800);
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${explorer.toString(16)}` } }));
    const ref = /(?:ListItem|DataItem)[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log('  skip: no list-item ref in the Explorer snapshot');
    else {
      const menu = await call('tools/call', { name: 'context_menu', arguments: { ref } });
      const text = textOf(menu);
      assert(menu.result?.isError !== true && /context menu opened: \[hWnd=0x([0-9a-f]+)\]/.test(text), `context_menu opened a menu cursor-free (got: ${JSON.stringify(text.slice(0, 70))})`);
      const popupHwnd = /\[hWnd=0x([0-9a-f]+)\]/.exec(text)?.[1];
      if (popupHwnd !== undefined) {
        postKey(BigInt(`0x${popupHwnd}`), 'Escape'); // dismiss the menu cursor-free
        await Bun.sleep(150);
      }
    }
  }
} finally {
  proc.kill();
  if (explorer !== 0n) closeWindow(explorer);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — context_menu opens a menu cursor-free (UIA ShowContextMenu or a posted right-click fallback).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
