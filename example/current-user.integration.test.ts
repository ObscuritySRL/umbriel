/**
 * current-user — the `current_user` tool reports the current security context (account name, process integrity level,
 * elevated y/n, UAC elevation type) NATIVELY, so an AI knows its OWN access before a privileged action instead of
 * shelling to `whoami` — and so an access-denied (driving an elevated window, OpenProcess on an elevated process,
 * writing a protected path) is EXPECTED, not a surprise. Reuses umbriel's token machinery (the integrityLevel path) +
 * GetUserNameW + GetTokenInformation(TokenElevation/TokenElevationType).
 *
 * Proof over the real stdio MCP server (read-only, no GUI): current_user returns a non-empty account name, a known
 * integrity level, and a coherent elevation verdict.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/current-user.integration.test.ts
 */
import { currentUser } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// (1) facade
const user = currentUser();
console.log(`  currentUser() → name=${JSON.stringify(user.name)} integrity=${user.integrity} elevated=${user.elevated} type=${user.elevationType}`);
assert(user.name.length > 0, 'reports a non-empty account name');
assert(['low', 'medium', 'high', 'system', ''].includes(user.integrity), `integrity is a known level (${user.integrity})`);
assert(typeof user.elevated === 'boolean' && ['default', 'full', 'limited'].includes(user.elevationType), 'reports an elevated flag and a UAC elevation type');
assert(!(user.elevationType === 'full') || user.elevated, 'a "full" elevation type implies elevated (internal consistency)');

// (2) MCP tool
type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'readonly' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (m: Rpc) => void>();
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
        const m = JSON.parse(line) as Rpc;
        if (typeof m.id === 'number' && pending.has(m.id)) {
          pending.get(m.id)!(m);
          pending.delete(m.id);
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
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'current-user', version: '1' } });
  const text = (await call('tools/call', { name: 'current_user', arguments: {} })).result?.content?.[0]?.text ?? '';
  console.log(`  current_user → ${JSON.stringify(text)}`);
  assert(/user ".+" · \w+ integrity · (ELEVATED|not elevated) · UAC \w+/.test(text), 'the MCP tool renders name / integrity / elevation / UAC type');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — current_user reports the user access context natively (name, integrity, elevation).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
