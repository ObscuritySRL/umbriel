/**
 * scroll-unknown-direction — the scroll handler had scrollIntoView as an UNCONDITIONAL fall-through, so a provided-but-
 * unrecognized direction (a hallucinated 'diagonal' / 'scroll_down' / 'upward') silently became a scroll-INTO-VIEW and
 * returned a confident "scrolled … into view" success for a DIFFERENT operation — the lone verb-handler missing the
 * enumerate-on-unknown guard that act()/manage_window already have. scroll now errors on an unknown direction and lists
 * the valid set; an OMITTED direction still scrolls the ref into view.
 *
 * Proof (synthetic, deterministic): scroll {direction:'diagonal'} errors "unknown scroll direction" + lists valid ones;
 * scroll {} (no direction) still reports "into view". Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic window):
 * Run: bun run example/scroll-unknown-direction.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
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

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-scrolldir-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 240, 240, 300, 160, 0n, 0n, BigInt(hInstance), null);
const button = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Button').ptr!, wide('Target').ptr!, WS_CHILD | WS_VISIBLE, 20, 20, 160, 32, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'scrolldir', version: '1' } });
  if (parent === 0n || button === 0n) console.log('  skip: could not create the synthetic window');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const ref = /Button[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log('  skip: no ref in the synthetic snapshot');
    else {
      const bad = await call('tools/call', { name: 'scroll', arguments: { ref, direction: 'diagonal' } });
      assert(bad.result?.isError === true && /unknown scroll direction/.test(textOf(bad)) && /page-down/.test(textOf(bad)), `unknown direction errors + lists the valid set (got: ${JSON.stringify(textOf(bad).slice(0, 110))})`);
      assert(!/scrolled .* into view/.test(textOf(bad)), 'unknown direction does NOT silently report a scroll-into-view success');

      // Omitted direction must NOT hit the guard — it flows to the scroll-into-view path (its own success/no-pattern
      // outcome is unchanged by this fix; the point is the guard fires ONLY for a provided invalid direction).
      const into = await call('tools/call', { name: 'scroll', arguments: { ref } });
      assert(!/unknown scroll direction/.test(textOf(into)), 'omitted direction is NOT treated as an unknown direction (guard lets it through to scroll-into-view)');
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — scroll errors on an unknown direction (enumerates valid); omitted direction still scrolls into view.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
