/**
 * hresult-named — a COM failure must name its HRESULT and append a one-line recovery hint, not leak bare hex.
 * Before the fix, hresult() (com.ts) returned only `0x80040201`, so the single most common agent error
 * (vanished window / disabled control / unsupported pattern) dead-ended a cold LLM on an opaque code even
 * though the meaning + recovery were already documented in constants.ts / AI.md. Now the five well-known UIA
 * HRESULTs (SDK um/UIAutomationCore.h, 0x80040200–04) carry their name + next step; any other code stays bare hex.
 *
 * Proof: (A) unit — each of the five codes names itself + a recovery verb; a non-UIA code (0x80070005) stays
 * bare hex. (B) live MCP — `attach {hWnd:"0xDEADBEEF"}` against a garbage handle returns isError text naming
 * UIA_E_ELEMENTNOTAVAILABLE and pointing at list_windows. No app window is spawned or closed.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/hresult-named.integration.test.ts
 */
import { hresult } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// (A) unit — the five SDK-verified codes name themselves + a recovery hint; the bare hex is always preserved.
const expectations: { code: number; name: string }[] = [
  { code: 0x80040200, name: 'UIA_E_ELEMENTNOTENABLED' },
  { code: 0x80040201, name: 'UIA_E_ELEMENTNOTAVAILABLE' },
  { code: 0x80040202, name: 'UIA_E_NOCLICKABLEPOINT' },
  { code: 0x80040203, name: 'UIA_E_PROXYASSEMBLYNOTLOADED' },
  { code: 0x80040204, name: 'UIA_E_NOTSUPPORTED' },
];
for (const { code, name } of expectations) {
  const text = hresult(code);
  const hex = `0x${(code >>> 0).toString(16).padStart(8, '0')}`;
  assert(text.startsWith(`${hex} ${name} (`) && text.endsWith(')'), `${hex} names ${name} and carries a (recovery hint): ${JSON.stringify(text)}`);
}
assert(hresult(0x80070005) === '0x80070005', 'a non-UIA HRESULT (E_ACCESSDENIED) stays bare hex with no fabricated hint');

// (B) live MCP — a garbage hWnd must surface the named, actionable error to the agent.
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let stream = '';
const pending = new Map<number, (m: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    stream += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = stream.indexOf('\n')) >= 0) {
      const line = stream.slice(0, index).trim();
      stream = stream.slice(index + 1);
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

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hresult-test', version: '1' } });
  const dead = await call('tools/call', { name: 'attach', arguments: { hWnd: '0xDEADBEEF' } });
  const text = textOf(dead);
  assert(dead.result?.isError === true && text.includes('UIA_E_ELEMENTNOTAVAILABLE') && text.includes('list_windows'), `attach {hWnd:"0xDEADBEEF"} returns the named, actionable error: ${JSON.stringify(text)}`);
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — COM failures name their HRESULT and carry a recovery hint instead of leaking bare hex.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
