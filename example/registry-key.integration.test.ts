/**
 * registry-key — registry_key CREATES / DELETES a registry KEY natively (Advapi32 RegCreateKeyExW / RegDeleteKeyExW /
 * RegDeleteTreeW), no reg add/reg delete/New-Item/Remove-Item shell. It is the half registry_set lacks: registry_set
 * writes a VALUE on an EXISTING key, so a brand-new HKCU\Software\<App> subtree must be created first. create makes any
 * missing parent keys and is idempotent (reports created vs already-existed); delete refuses a key that still has
 * subkeys unless {recursive:true} (RegDeleteTreeW removes the whole subtree). SECURITY: os-gated AND requires
 * {confirm:true}; HKLM/protected keys need elevation.
 *
 * Proof over the real stdio MCP server: a nested HKCU subtree is created; registry_set then writes a value INTO the
 * created key (the create UNBLOCKS the write — the exact job this closes); a re-create reports already-existed; a
 * create/delete WITHOUT {confirm:true} is refused; a non-recursive delete of a key WITH subkeys is refused (and steers
 * to recursive); a recursive delete removes the whole subtree; and registry_key is os-gated (absent from the safe
 * profile). The subtree is removed in finally via umbriel's OWN registryDeleteKey (dogfooded — no Advapi32 reach-around).
 *
 * Run: bun run example/registry-key.integration.test.ts
 */
import { registryDeleteKey } from '../desktop/registry';

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

const BASE = 'Software\\umbriel_probe_regkey_DELETEME';
const SEED = `${BASE}\\seed`;
const DEEP = `${BASE}\\a\\b`;
const key = (k: string, args: object) => full.call('tools/call', { name: 'registry_key', arguments: { hive: 'HKCU', key: k, ...args } });

const full = connect('full');
const safe = connect('safe');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regkey', version: '1' } });

  // create a key + its missing parent (BASE), then prove registry_set can now write INTO it (the job this closes)
  const made = await key(SEED, { action: 'create', confirm: true });
  assert(!isErr(made) && /^created /.test(textOf(made)), 'registry_key create makes the key (and its missing parent)');
  const wrote = await full.call('tools/call', { name: 'registry_set', arguments: { hive: 'HKCU', key: SEED, value: 'v', type: 'REG_SZ', data: 'ok', confirm: true } });
  assert(!isErr(wrote), 'registry_set can now write a value INTO the freshly-created key (create UNBLOCKS the write)');
  const read = await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKCU', key: SEED, value: 'v' } });
  assert(/"ok"/.test(textOf(read)), 'registry_get reads back the value written into the created key');

  // idempotent re-create reports already-existed (not an error)
  const again = await key(SEED, { action: 'create', confirm: true });
  assert(!isErr(again) && /already existed/.test(textOf(again)), 'registry_key create is idempotent — a present key reports already-existed');

  // confirm gate on create
  const noConfirmCreate = await key(`${BASE}\\nope`, { action: 'create' });
  assert(isErr(noConfirmCreate) && /confirm:true/.test(textOf(noConfirmCreate)), 'registry_key create WITHOUT {confirm:true} is refused (safety gate)');

  // a deeper branch, so BASE now has subkeys (seed, a\b)
  assert(!isErr(await key(DEEP, { action: 'create', confirm: true })), 'registry_key create makes a deep nested branch (a\\b)');

  // non-recursive delete of a key WITH subkeys is refused and steers to recursive
  const nonRecursive = await key(BASE, { action: 'delete', confirm: true });
  assert(isErr(nonRecursive) && /recursive:true/.test(textOf(nonRecursive)), 'registry_key delete (non-recursive) refuses a key that still has subkeys, steering to {recursive:true}');

  // confirm gate on delete
  const noConfirmDelete = await key(SEED, { action: 'delete' });
  assert(isErr(noConfirmDelete) && /confirm:true/.test(textOf(noConfirmDelete)), 'registry_key delete WITHOUT {confirm:true} is refused (safety gate)');

  // recursive delete removes the whole subtree
  const recursive = await key(BASE, { action: 'delete', recursive: true, confirm: true });
  assert(!isErr(recursive) && /deleted .*\(recursive\)/.test(textOf(recursive)), 'registry_key delete {recursive:true} removes the key and its whole subtree');
  assert(isErr(await full.call('tools/call', { name: 'registry_get', arguments: { hive: 'HKCU', key: SEED, value: 'v' } })), 'the recursively-deleted subtree is gone (registry_get on a child key errors)');

  // os-gated: registry_key is not exposed under the safe profile
  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regkey', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(!names.includes('registry_key'), 'registry_key is NOT exposed under the safe profile (os-gated)');
} finally {
  registryDeleteKey('HKCU', BASE, true); // dogfooded cleanup via umbriel's own primitive (idempotent — already gone on the happy path)
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — registry_key creates/deletes registry KEYS natively (confirm-gated, os-gated); create unblocks registry_set; recursive nukes a subtree.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
