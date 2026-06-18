/**
 * run-program-timeout — run_program awaited proc.exited unboundedly, so a GUI app or any never-exiting command wedged
 * the WHOLE serialized dispatch chain forever (live-proven: a concurrent list_windows timed out at 6011ms while a
 * winver run_program was in flight). run_program now drains stdout/stderr incrementally and races proc.exited against a
 * bounded timer (default 30000ms, overridable via timeoutMs, capped 300000); on timeout it kills the process and
 * returns the partial output with a note steering GUI/long-running launches to launch_app.
 *
 * Proof: a never-exiting `ping -n 30` with timeoutMs:1500 returns a "did not exit within 1500ms — killed it" note (not a
 * hang); a quick command queued right behind it still completes (the chain is no longer deadlocked) well under 5s; and a
 * normal exiting command still returns its exit code + stdout (no regression). No windows are spawned (console only).
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess, os category enabled):
 * Run: bun run example/run-program-timeout.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe', SKRY_OS: '1' } });
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'run-timeout', version: '1' } });

  // Deadlock proof: fire a never-exiting command (short timeoutMs) and a quick command right behind it, without awaiting
  // the first. Pre-fix the quick one never returns (the chain is wedged on proc.exited). Post-fix both settle promptly.
  const start = Date.now();
  const longCall = call('tools/call', { name: 'run_program', arguments: { command: 'ping', args: ['-n', '30', '127.0.0.1'], timeoutMs: 1500 } });
  const quickCall = call('tools/call', { name: 'run_program', arguments: { command: 'hostname' } });
  const [longRes, quickRes] = await Promise.all([longCall, quickCall]);
  const elapsed = Date.now() - start;

  assert(longRes.result?.isError !== true && /did not exit within 1500ms — killed it/.test(textOf(longRes)), `never-exiting command is killed at its timeout (got: ${JSON.stringify(textOf(longRes).slice(0, 90))})`);
  assert(/launch_app/.test(textOf(longRes)), 'the timeout note steers GUI/long-running launches to launch_app');
  assert(quickRes.result?.isError !== true && /exit 0/.test(textOf(quickRes)), `the command queued behind it still completes — chain not deadlocked (got: ${JSON.stringify(textOf(quickRes).slice(0, 70))})`);
  assert(elapsed < 5000, `both calls settle well under 5s (elapsed ${elapsed}ms) — proves no infinite await`);

  // No regression: a normal exiting command returns exit code + stdout.
  const normal = await call('tools/call', { name: 'run_program', arguments: { command: 'cmd', args: ['/c', 'echo', 'roundtrip'] } });
  assert(normal.result?.isError !== true && /exit 0/.test(textOf(normal)) && /roundtrip/.test(textOf(normal)), `a normal exiting command still returns exit code + stdout (got: ${JSON.stringify(textOf(normal).slice(0, 70))})`);
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — run_program bounds a never-exiting command and no longer deadlocks the serialized chain.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
