/**
 * stat-path — the `stat_path` tool stats a path NATIVELY (no dir/Get-Item shell): exists, file vs directory, byte
 * size, modified + created times, and the Windows ATTRIBUTE bits (read-only/hidden/system/reparse) that node:fs's
 * coarse `mode` structurally cannot expose. Benchmark-chosen disjoint split: node:fs statSync for size/mtime/created
 * (it decodes the struct for free), FFI Kernel32.GetFileAttributesW for the attribute DWORD (FFI is REQUIRED, not just
 * faster — node:fs cannot give hidden/system). Lets an AI check a file's SIZE before read_file (which caps at 20k).
 * fs-category, confined to UMBRIEL_FS_ROOT.
 *
 * Proof: the facade fileAttributes() returns a real bitmask for a file (not INVALID) and 0xffffffff for a missing
 * path and the DIRECTORY bit for a dir; and the MCP stat_path tool renders file/dir/size/times and "does not exist".
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/stat-path.integration.test.ts
 */
import { fileAttributes } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const INVALID = 0xffff_ffff;
// (1) facade — the raw attribute bitmask
const fileAttr = fileAttributes(`${import.meta.dir}/../package.json`);
const dirAttr = fileAttributes(`${import.meta.dir}/..`);
const missingAttr = fileAttributes(`${import.meta.dir}/../zzz-no-such-file-xyz`);
console.log(`  fileAttributes → file=0x${fileAttr.toString(16)} dir=0x${dirAttr.toString(16)} missing=0x${missingAttr.toString(16)}`);
assert(fileAttr !== INVALID && (fileAttr & 0x10) === 0, 'a real file has valid attributes with the DIRECTORY bit clear');
assert(dirAttr !== INVALID && (dirAttr & 0x10) !== 0, 'a directory has the DIRECTORY (0x10) bit set');
assert(missingAttr === INVALID, 'a missing path returns 0xffffffff (INVALID_FILE_ATTRIBUTES)');

// (2) MCP tool (full profile so the fs category is enabled; no FS_ROOT → stats the repo)
type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'full' } });
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
const call = (name: string, args: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';
try {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stat-path', version: '1' } } })}\n`);
  proc.stdin.flush();
  await new Promise((resolve) => pending.set(id, resolve));

  const fileText = textOf(await call('stat_path', { path: `${import.meta.dir}/../package.json` }));
  console.log(`  stat_path(package.json) → ${JSON.stringify(fileText.slice(0, 100))}`);
  assert(/file, \d+ bytes, modified .*, created /.test(fileText), 'stat_path renders a file with size + modified + created times');
  const dirText = textOf(await call('stat_path', { path: `${import.meta.dir}/..` }));
  assert(/^.*: directory,/.test(dirText), 'stat_path renders a directory as "directory"');
  const missingText = textOf(await call('stat_path', { path: `${import.meta.dir}/../zzz-no-such-file-xyz` }));
  assert(/does not exist/.test(missingText), 'stat_path reports a missing path as "does not exist"');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — stat_path reports existence/kind/size/times/attributes natively (node:fs + FFI attribute bits).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
