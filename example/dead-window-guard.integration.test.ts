/**
 * dead-window-guard — once the attached window was destroyed (user closed it / the app exited), requireAttached() and
 * resolveRef() had NO liveness check, so desktop_snapshot rebuilt an empty "Type(0)" tree and a ref action resolved a
 * stale Element and returned a CONFIDENT FALSE success ("typed into … cursor-free") though nothing happened — the exact
 * wrong-confident-success class the rest of the server prevents (blocked-close, stale-ref rejection). Both now call a
 * shared assertAttachedAlive() (one IsWindow call): a dead attached window is dropped and the action throws a re-attach
 * steer.
 *
 * Proof (synthetic, deterministic): attach to a window, DestroyWindow it, then desktop_snapshot AND a ref action both
 * error "no longer exists" instead of a false success. Window already destroyed; nothing to close in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic window destroyed mid-session):
 * Run: bun run example/dead-window-guard.integration.test.ts
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-deadwin-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 200, 200, 320, 180, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 280, 28, parent, 0n, BigInt(hInstance), null);
pump();
let ticker: ReturnType<typeof setInterval> | undefined = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'deadwin', version: '1' } });
  if (parent === 0n || edit === 0n) console.log('  skip: could not create the synthetic window');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const editRef = /Edit[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    assert(/\[ref=/.test(snap), 'attached + got a live snapshot with refs');

    // Destroy the window out from under the server, then prove no action returns a false success.
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
    User32.DestroyWindow(edit);
    User32.DestroyWindow(parent);

    // The ref action is the critical one — it must FAIL LOUD, never return a fabricated "typed into … cursor-free".
    // It is the first action after the destroy, so it hits the liveness guard ("no longer exists") and clears `attached`.
    if (editRef !== undefined) {
      const typed = await call('tools/call', { name: 'type', arguments: { ref: editRef, text: 'ghost' } });
      assert(
        typed.result?.isError === true && /no longer exists/.test(textOf(typed)) && !/typed into/.test(textOf(typed)),
        `type {ref} on a destroyed window errors loud (no false "typed" success) (got: ${JSON.stringify(textOf(typed).slice(0, 90))})`,
      );
    }
    // A follow-up snapshot is also an honest error (the dead window was dropped), never a fabricated "Type(0)" tree.
    const reSnap = await call('tools/call', { name: 'desktop_snapshot', arguments: {} });
    assert(reSnap.result?.isError === true && !/### Snapshot/.test(textOf(reSnap)), `desktop_snapshot after the drop is an honest error, not a phantom tree (got: ${JSON.stringify(textOf(reSnap).slice(0, 90))})`);
  }
} finally {
  if (ticker !== undefined) clearInterval(ticker);
  proc.kill();
  if (parent !== 0n && User32.IsWindow(parent) !== 0) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — a destroyed attached window is detected; snapshot + ref actions error instead of a confident false success.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
