/**
 * wait-for-window-gone — there was no event-driven wait for a window to CLOSE: waitForWindow filters to appear/focus/
 * rename, so the close event the watcher already fires could never resolve a wait. New skry.waitForWindowGone + the
 * wait_for_window {gone:true} param resolve when a matching top-level window disappears (a dialog dismissed, a splash/
 * progress window finishing, an app exiting) — resolving immediately if none is open, mirroring the appear path.
 *
 * Proof (synthetic, deterministic): wait_for_window {gone:true, title} BLOCKS while the window is open, resolves "window
 * gone" once it is destroyed, and resolves immediately on a second call (already gone). Window already destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic window closed mid-wait):
 * Run: bun run example/wait-for-window-gone.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const PM_REMOVE = 0x0001;
const TITLE = 'skry-gone-probe-7731';
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide(TITLE).ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 260, 260, 300, 160, 0n, 0n, BigInt(hInstance), null);
pump();
let ticker: ReturnType<typeof setInterval> | undefined = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'gone', version: '1' } });
  if (parent === 0n) console.log('  skip: could not create the synthetic window');
  else {
    // Start the gone-wait while the window is OPEN — it must BLOCK (not resolve) until the window is destroyed.
    const gonePromise = call('tools/call', { name: 'wait_for_window', arguments: { gone: true, title: TITLE, timeout: 9000 } });
    let resolvedEarly = false;
    void gonePromise.then(() => {
      resolvedEarly = true;
    });
    await Bun.sleep(1300); // let the MCP SetWinEventHook watcher come up; the wait must still be pending
    assert(!resolvedEarly, 'wait_for_window {gone} BLOCKS while the matching window is still open');

    User32.DestroyWindow(parent);
    pump();
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;

    const goneResult = await gonePromise;
    assert(goneResult.result?.isError !== true && /window gone/.test(textOf(goneResult)), `resolves "window gone" once the window is destroyed (got: ${JSON.stringify(textOf(goneResult).slice(0, 90))})`);

    // A second call with the window already gone resolves IMMEDIATELY.
    const start = Date.now();
    const again = await call('tools/call', { name: 'wait_for_window', arguments: { gone: true, title: TITLE, timeout: 9000 } });
    assert(again.result?.isError !== true && /window gone/.test(textOf(again)) && Date.now() - start < 2000, `resolves immediately when no matching window is open (${Date.now() - start}ms)`);
  }
} finally {
  if (ticker !== undefined) clearInterval(ticker);
  proc.kill();
  if (parent !== 0n && User32.IsWindow(parent) !== 0) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — wait_for_window {gone} resolves on a matching window closing (and immediately if already gone).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
