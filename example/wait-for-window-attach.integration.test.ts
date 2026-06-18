/**
 * wait-for-window-attach — wait_for_window {attach:true} collapses the gate→attach→snapshot loop into ONE call (mirrors
 * launch_app's title/className path). Without it the gate returns an identity line ("… attach by hWnd to drive it") and
 * the agent must make a SECOND attach call to act; the most common "wait for a dialog/new app then drive it" loop cost
 * two round-trips. attach:true attaches to the matched window and returns its snapshot directly.
 *
 * Proof (synthetic, deterministic): a real top-level window is created, then wait_for_window {title, attach:true} returns
 * an "attached to" snapshot result (NOT the identity "attach by hWnd to drive it" line), and a subsequent action-less
 * snapshot-bearing tool confirms the MCP server is now ATTACHED to that window — none of which happens without the fix.
 * Window destroyed in teardown (no app launched, nothing flashed).
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic window):
 * Run: bun run example/wait-for-window-attach.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const PM_REMOVE = 0x0001;
const TITLE = 'skry-attach-probe-4419';
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide(TITLE).ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 280, 280, 320, 180, 0n, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'attach', version: '1' } });
  if (parent === 0n) console.log('  skip: could not create the synthetic window');
  else {
    // The window is already open, so the wait resolves immediately. attach:true must ATTACH + snapshot in ONE call.
    const attached = await call('tools/call', { name: 'wait_for_window', arguments: { title: TITLE, attach: true, timeout: 9000 } });
    const attachedText = textOf(attached);
    assert(attached.result?.isError !== true, `wait_for_window {attach:true} does not error (got: ${JSON.stringify(attachedText.slice(0, 90))})`);
    assert(/attached to/.test(attachedText), `returns an "attached to" snapshot in one call (got: ${JSON.stringify(attachedText.slice(0, 90))})`);
    assert(!/attach by hWnd to drive it/.test(attachedText), 'does NOT return the identity-only "attach by hWnd to drive it" line that forces a second attach call');

    // Confirm the MCP server is genuinely ATTACHED now: a snapshot-bearing read that requires an attachment must succeed
    // without a separate attach call — the whole point of the one-call affordance.
    const snap = await call('tools/call', { name: 'desktop_snapshot', arguments: {} });
    assert(snap.result?.isError !== true, 'the server is attached afterward — a follow-up snapshot read succeeds with no separate attach call');

    // Default (no attach) still returns the cheap identity line — the one-call path is opt-in, not a behavior change.
    const identity = await call('tools/call', { name: 'wait_for_window', arguments: { title: TITLE, timeout: 9000 } });
    assert(/attach by hWnd to drive it/.test(textOf(identity)), 'default (no attach) preserves the cheap identity-only result');
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n && User32.IsWindow(parent) !== 0) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — wait_for_window {attach:true} attaches + snapshots in one call (default stays identity-only).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
