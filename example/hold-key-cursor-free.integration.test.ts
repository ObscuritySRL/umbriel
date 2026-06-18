/**
 * hold-key-cursor-free — hold_key had ONLY a SendInput path, so it was wholly refused under SKRY_CURSOR=never and
 * never worked on a background/locked desktop — the one input verb with no cursor-free route. hold_key {ref} on a control
 * with its OWN window handle now posts a WM_KEYDOWN autorepeat stream (postHoldKey) closed by WM_KEYUP — no focus, no
 * SendInput — so it survives the cursor lockdown; only the no-ref / no-own-HWND case still needs SendInput.
 *
 * Proof (under SKRY_CURSOR=never): hold_key {ref} on a synthetic own-HWND Edit is ALLOWED, reports "cursor-free", and
 * actually holds for ~durationMs (the autorepeat loop ran); hold_key with NO ref is still refused. Window destroyed in
 * teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess started with SKRY_CURSOR=never + a synthetic Edit):
 * Run: bun run example/hold-key-cursor-free.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
const PM_REMOVE = 0x0001;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const pumpMsg = Buffer.alloc(48);
const pump = (): void => {
  for (let i = 0; i < 200; i += 1) {
    if (User32.PeekMessageW(pumpMsg.ptr!, 0n, 0, 0, PM_REMOVE) === 0) break;
    User32.TranslateMessage(pumpMsg.ptr!);
    User32.DispatchMessageW(pumpMsg.ptr!);
  }
};

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe', SKRY_CURSOR: 'never' } });
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

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-hold-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 140, 140, 320, 160, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 300, 28, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hold-free', version: '1' } });

  // No-ref hold_key still needs SendInput → still refused under never (the lockdown holds where there's no cursor-free path).
  const noRef = await call('tools/call', { name: 'hold_key', arguments: { key: 'a', durationMs: 50 } });
  assert(noRef.result?.isError === true && /SKRY_CURSOR=never/.test(textOf(noRef)), 'hold_key with no ref is still refused under never (no cursor-free path)');

  if (parent === 0n || edit === 0n) console.log('  skip: could not create the synthetic Edit');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const ref = /Edit[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log('  skip: no ref in the synthetic snapshot');
    else {
      const start = Date.now();
      const held = await call('tools/call', { name: 'hold_key', arguments: { ref, key: 'a', durationMs: 140 } });
      const elapsed = Date.now() - start;
      assert(held.result?.isError !== true, `hold_key {ref} on an own-HWND control is ALLOWED under never (not refused) (got: ${JSON.stringify(textOf(held).slice(0, 80))})`);
      assert(/cursor-free/.test(textOf(held)), 'hold_key {ref} reports the cursor-free path');
      assert(elapsed >= 110, `the hold actually ran for ~durationMs (elapsed ${elapsed}ms ≥ 110) — the autorepeat loop executed`);
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (edit !== 0n) User32.DestroyWindow(edit);
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — hold_key {ref} holds an own-HWND control cursor-free (survives SKRY_CURSOR=never); no-ref hold_key still refused.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
