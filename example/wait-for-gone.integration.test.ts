/**
 * wait-for-gone — there was no "wait until a control DISAPPEARS" — the spinner / "Loading…" / progress / just-dismissed
 * -modal gate every real app flow needs (wait for the busy thing to vanish before proceeding). Element.waitForGone
 * inverts waitFor (resolves when the selector no longer matches), wired into the existing wait_for tool via gone:true.
 *
 * Proof (against the always-present taskbar — read-only, never closed; a real self-pumping process, so no UIA
 * self-automation deadlock): wait_for {gone:true} on an ABSENT selector resolves immediately; on a present control
 * (StartButton) it TIMES OUT with "still present". Those are the two branches of the poll.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + the taskbar):
 * Run: bun run example/wait-for-gone.integration.test.ts
 */
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

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wait-gone', version: '1' } });
  const snap = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  if (snap.length === 0) console.log('  skip: could not attach the taskbar');
  else {
    // Resolve branch: a selector that matches NOTHING is already "gone" → resolves promptly.
    const absent = await call('tools/call', { name: 'wait_for', arguments: { selector: { name: '__no_such_control_xyz__' }, gone: true, timeout: 3000 } });
    assert(absent.result?.isError !== true && /gone:/.test(textOf(absent)), `wait_for {gone:true} on an ABSENT selector resolves (got: ${JSON.stringify(textOf(absent).slice(0, 70))})`);

    // Timeout branch: a present control never disappears → "still present" within the timeout.
    const present = await call('tools/call', { name: 'wait_for', arguments: { selector: { automationId: 'StartButton' }, gone: true, timeout: 800 } });
    if (present.result?.isError === true && /no element matched|still present/.test(textOf(present)) && !/StartButton/.test(snap)) console.log('  skip: no StartButton on this taskbar layout');
    else assert(present.result?.isError === true && /still present/.test(textOf(present)), `wait_for {gone:true} on a present control TIMES OUT with "still present" (got: ${JSON.stringify(textOf(present).slice(0, 70))})`);
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — wait_for {gone:true} resolves when a control is absent and times out while it is present.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
