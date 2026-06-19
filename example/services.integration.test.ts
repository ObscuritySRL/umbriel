/**
 * services — list_services / control_service drive the Windows Service Control Manager natively, no sc / Get-Service /
 * Start-Service shell. list_services (read) enumerates every Win32 service (EnumServicesStatusW → name/displayName/
 * state); control_service (os) opens ONE by name and queries (state + owning pid via QueryServiceStatusEx) / starts /
 * stops it. FFI-only (Advapi32; no Bun service API). The richer EnumServicesStatusExW is avoided because its
 * pszGroupName is mistyped non-nullable in the binding and NULL is required for "all services" (casts forbidden) — the
 * non-Ex variant is the clean path, with the pid recovered on demand by control_service.
 *
 * Proof over the real stdio MCP server (read + query only — nothing started/stopped): list_services returns hundreds
 * with a known service present; control_service query gives a running service's state + pid; a bogus name is
 * not-found; stop on a protected service is a clean denied from medium integrity; list_services is in the safe profile
 * (read) while control_service is os-gated.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/services.integration.test.ts
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

const full = connect('full');
const safe = connect('safe');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'services', version: '1' } });

  const listed = textOf(await full.call('tools/call', { name: 'list_services', arguments: {} }));
  assert(/^\d+ services:/.test(listed) && /\bDnscache\b/.test(listed), 'list_services enumerates every service (hundreds, incl. Dnscache)');

  const query = textOf(await full.call('tools/call', { name: 'control_service', arguments: { name: 'Dnscache', action: 'query' } }));
  console.log(`  control_service(Dnscache, query) → ${JSON.stringify(query)}`);
  assert(/Dnscache: running \(pid \d+\)/.test(query), 'control_service query returns a running service\'s state + owning pid');

  const bogus = await full.call('tools/call', { name: 'control_service', arguments: { name: 'zzz-no-such-service', action: 'query' } });
  assert(isErr(bogus) && /no service named/.test(textOf(bogus)), 'control_service on a missing service is not-found');

  const stop = await full.call('tools/call', { name: 'control_service', arguments: { name: 'Dnscache', action: 'stop' } });
  assert(isErr(stop) && /access-denied/.test(textOf(stop)), 'control_service stop on a protected service is a clean access-denied (medium integrity)');

  const badAction = await full.call('tools/call', { name: 'control_service', arguments: { name: 'Dnscache', action: 'frobnicate' } });
  assert(isErr(badAction) && /action must be/.test(textOf(badAction)), 'control_service rejects an unknown action');

  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'services', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('list_services'), 'list_services IS exposed under the safe profile (read)');
  assert(!names.includes('control_service'), 'control_service is NOT exposed under the safe profile (os-gated)');
} finally {
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — list_services / control_service drive the SCM natively (state + pid), os-gated on control.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
