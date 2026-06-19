/**
 * env-var — get_env / set_env read and PERSIST environment variables across three scopes: process (this server's live
 * env, via process.env + SetEnvironmentVariableW), user (HKCU\Environment), machine (HKLM\…\Session Manager\Environment).
 * Persistent (user/machine) writes go through the registry write primitives and broadcast WM_SETTINGCHANGE so new
 * processes inherit them without a reboot — the canonical "configure my machine" task (JAVA_HOME / PATH), no
 * setx/reg/PowerShell. The benchmark mandate's one genuine FFI-vs-Bun split: process scope routes through process.env
 * (Bun-native wins the transient view), user/machine through FFI registry (no Bun equivalent).
 *
 * Proof over the real stdio MCP server: a throwaway USER var round-trips set → read → delete (and is cleaned up); a
 * machine write is a clean access-denied at medium integrity; get_env lists a scope; the missing-value, bad-scope, and
 * no-value-no-delete cases error; get_env is in the safe profile (read) while set_env is os-gated.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/env-var.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function connect(profile: string): { call: (m: string, p: unknown) => Promise<Rpc>; kill: () => void } {
  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: profile } });
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
  return { call, kill: () => proc.kill() };
}
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';
const isErr = (m: Rpc): boolean => m.result?.isError === true;
const VAR = 'UMBRIEL_TEST_VAR';

const full = connect('full');
const safe = connect('safe');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'env', version: '1' } });

  const procPath = textOf(await full.call('tools/call', { name: 'get_env', arguments: { scope: 'process', name: 'PATH' } }));
  assert(/^PATH=.+/.test(procPath), 'get_env reads a process-scope variable (PATH)');

  // USER persistent roundtrip — set, read back, delete
  const setUser = textOf(await full.call('tools/call', { name: 'set_env', arguments: { scope: 'user', name: VAR, value: 'umbriel-roundtrip' } }));
  assert(/persisted \+ broadcast/.test(setUser), 'set_env user persists + broadcasts WM_SETTINGCHANGE');
  const readUser = textOf(await full.call('tools/call', { name: 'get_env', arguments: { scope: 'user', name: VAR } }));
  console.log(`  user roundtrip → ${JSON.stringify(readUser)}`);
  assert(readUser === `${VAR}=umbriel-roundtrip`, 'get_env user reads back exactly what set_env wrote (persisted in HKCU)');
  const del = textOf(await full.call('tools/call', { name: 'set_env', arguments: { scope: 'user', name: VAR, delete: true } }));
  assert(/deleted/.test(del), 'set_env {delete:true} removes the persistent variable');
  assert(isErr(await full.call('tools/call', { name: 'get_env', arguments: { scope: 'user', name: VAR } })), 'get_env reports the deleted variable as not set');

  const listUser = textOf(await full.call('tools/call', { name: 'get_env', arguments: { scope: 'user' } }));
  assert(/\bPath=/i.test(listUser) || listUser.split('\n').length > 1, 'get_env lists every variable in a scope when name is omitted');

  const machine = await full.call('tools/call', { name: 'set_env', arguments: { scope: 'machine', name: VAR, value: 'x' } });
  assert(isErr(machine) && /access-denied/.test(textOf(machine)), 'set_env machine is a clean access-denied at medium integrity');

  assert(isErr(await full.call('tools/call', { name: 'set_env', arguments: { scope: 'user', name: VAR } })), 'set_env without value or delete is rejected (no accidental delete)');
  assert(isErr(await full.call('tools/call', { name: 'get_env', arguments: { scope: 'nope' } })), 'get_env rejects an invalid scope');

  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'env', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('get_env'), 'get_env IS exposed under the safe profile (read)');
  assert(!names.includes('set_env'), 'set_env is NOT exposed under the safe profile (os-gated)');
} finally {
  // belt-and-suspenders cleanup in case an assertion threw before the delete
  await full.call('tools/call', { name: 'set_env', arguments: { scope: 'user', name: VAR, delete: true } });
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — get_env/set_env read + persist env vars across process/user/machine, os-gated on write.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
