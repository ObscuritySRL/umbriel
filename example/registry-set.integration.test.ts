/**
 * registry-set — registry_set writes/deletes ONE typed registry value on an EXISTING key (Advapi32 RegSetValueExW /
 * RegDeleteValueW), no reg add/Set-ItemProperty shell — configure an app/policy/preference outside env vars. Typed:
 * REG_SZ/EXPAND_SZ/DWORD/QWORD/MULTI_SZ, validated before the write. SECURITY: gated behind the os category AND requires
 * {confirm:true} (a wrong write can corrupt the machine); the key must already exist; HKLM needs elevation.
 *
 * Proof over the real stdio MCP server: into a throwaway HKCU subkey, a REG_SZ + REG_DWORD round-trip through
 * registry_set → registry_get; a write WITHOUT confirm is refused; a type mismatch (DWORD with string data) is refused;
 * a delete removes the value; a write to a non-existent key is refused; and registry_set is os-gated. The subkey is
 * created and removed in finally.
 *
 * Run: bun run example/registry-set.integration.test.ts
 */
import { registryCreateKey, registryDeleteKey } from '../desktop/registry';

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

const SUB = 'umbriel_probe_regset_DELETEME';
registryCreateKey('HKCU', SUB); // dogfooded: umbriel's OWN create primitive (was a raw Advapi32.RegCreateKeyExW reach-around — the gap registry_key now closes)

const full = connect('full');
const safe = connect('safe');
const set = (args: object) => full.call('tools/call', { name: 'registry_set', arguments: { hive: 'HKCU', key: SUB, ...args } });
const get = (value: string) => full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKCU', key: SUB, value } });
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regset', version: '1' } });

  assert(!isErr(await set({ value: 'str', type: 'REG_SZ', data: 'hello', confirm: true })), 'registry_set writes a REG_SZ value');
  assert(/"hello"/.test(textOf(await get('str'))), 'registry_get reads back the written REG_SZ value');
  assert(!isErr(await set({ value: 'num', type: 'REG_DWORD', data: 42, confirm: true })), 'registry_set writes a REG_DWORD value');
  assert(/\b42\b/.test(textOf(await get('num'))), 'registry_get reads back the written REG_DWORD value');

  const noConfirm = await set({ value: 'x', type: 'REG_SZ', data: 'y' });
  assert(isErr(noConfirm) && /confirm:true/.test(textOf(noConfirm)), 'registry_set WITHOUT {confirm:true} is refused (safety gate)');
  const mismatch = await set({ value: 'bad', type: 'REG_DWORD', data: 'notanumber', confirm: true });
  assert(isErr(mismatch) && /must match REG_DWORD/.test(textOf(mismatch)), 'registry_set rejects data that does not match the type');
  const noKey = await full.call('tools/call', { name: 'registry_set', arguments: { hive: 'HKCU', key: 'no_such_key_xyz_DELETEME', value: 'x', type: 'REG_SZ', data: 'y', confirm: true } });
  assert(isErr(noKey) && /must already exist/.test(textOf(noKey)), 'registry_set refuses a non-existent key (no implicit create)');

  assert(/deleted/.test(textOf(await set({ value: 'str', delete: true, confirm: true }))), 'registry_set {delete:true} removes a value');
  assert(isErr(await get('str')), 'the deleted value is gone');

  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regset', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(!names.includes('registry_set'), 'registry_set is NOT exposed under the safe profile (os-gated)');
} finally {
  registryDeleteKey('HKCU', SUB, true); // dogfooded: umbriel's OWN recursive delete (RegDeleteTreeW removes the throwaway key AND its values in one call)
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — registry_set writes typed values (confirm-gated, validated, os-gated); the key must exist.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
