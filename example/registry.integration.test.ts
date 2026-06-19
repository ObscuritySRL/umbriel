/**
 * registry — registry_get / registry_list read the Windows registry NATIVELY (Advapi32 RegOpenKeyExW +
 * RegQueryValueExW two-pass sizing + RegEnumKeyExW/RegEnumValueW), so an AI configuring Windows reads an install
 * path / OS or app version / policy / HKCU preference without `reg query` or Get-ItemProperty. Values decode by
 * RegType (REG_SZ→string, REG_DWORD→number, REG_QWORD→bigint, REG_MULTI_SZ→string[], REG_BINARY→hex). FFI-only (Bun
 * has no registry API); os-gated.
 *
 * Proof over the real stdio MCP server (read-only registry reads, nothing mutated): HKLM ProductName comes back as a
 * REG_SZ Windows version; HKCU\Environment lists Path; a missing value and a bad hive error cleanly; and the tools are
 * NOT exposed under the safe profile (os-gated).
 *
 * bun test is broken repo-wide; runnable harness (MCP subprocess only):
 * Run: bun run example/registry.integration.test.ts
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
const CV = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'registry', version: '1' } });

  const product = textOf(await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKLM', key: CV, value: 'ProductName' } }));
  console.log(`  registry_get(HKLM ProductName) → ${JSON.stringify(product)}`);
  assert(/\(REG_SZ\) "Windows/.test(product), 'registry_get reads a REG_SZ value (HKLM ProductName → "Windows…")');

  const major = textOf(await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKLM', key: CV, value: 'CurrentMajorVersionNumber' } }));
  assert(/\(REG_DWORD\) \d+/.test(major), 'registry_get decodes a REG_DWORD to a number');

  const env = textOf(await full.call('tools/call', { name: 'registry_list', arguments: { hive: 'HKCU', key: 'Environment' } }));
  assert(/values \(\d+\)/.test(env) && /\bPath = \(REG_/.test(env), 'registry_list enumerates a key\'s values (HKCU\\Environment has Path)');

  const missing = await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKLM', key: CV, value: 'zzz-no-such-value' } });
  assert(isErr(missing) && /not found or inaccessible/.test(textOf(missing)), 'registry_get on a missing value errors with not-found');

  const badHive = await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'NOPE', key: CV, value: 'ProductName' } });
  assert(isErr(badHive) && /hive must be/.test(textOf(badHive)), 'registry_get rejects an invalid hive');

  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'registry', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(!names.includes('registry_get') && !names.includes('registry_list'), 'registry tools are NOT exposed under the safe profile (os-gated)');
} finally {
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — registry_get/registry_list read the registry natively (typed decode), os-gated.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
