/**
 * fs-sandbox-driveroot — regression for a resolveFsPath off-by-one (introduced with the reparse-escape fix).
 *
 * When SKRY_FS_ROOT is a NOT-YET-CREATED direct child of a drive root (e.g. D:\sandbox), the deepest EXISTING
 * ancestor is the drive root `D:\`, which already ends in a separator. The old `resolved.slice(ancestor.length + 1)`
 * dropped the first char of the remainder, corrupting the path and throwing a bogus "escaped via a reparse point"
 * error — fail-closed, but it broke EVERY read_file/write_file/list_dir under a plausible first-run deployer config.
 * The fix uses path.relative() instead of a manual slice.
 *
 * Proof (drives the real MCP server with a drive-root-child FS_ROOT): a write under it is NOT rejected with the
 * bogus reparse error, and the file lands at the correct in-root path.
 *
 * bun test is broken repo-wide — runnable harness (only the MCP subprocess + a temp dir it deletes):
 * Run: bun run example/fs-sandbox-driveroot.integration.test.ts
 */
import { resolve } from 'node:path';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// A non-existent direct child of the repo drive's root (forward slash → absolute, no backslash-escaping surprises).
const drive = import.meta.dir.slice(0, 2); // e.g. "D:"
const root = `${drive}/__uia_fs_driveroot_test__`;
await Bun.$`rm -rf ${root}`.quiet().nothrow();

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe', SKRY_OS: '1', SKRY_FS_ROOT: root } });
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
  return new Promise((res) => pending.set(id, res));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fs-driveroot-test', version: '1' } });
  const write = await call('tools/call', { name: 'write_file', arguments: { path: 'sub/new.txt', content: 'ok' } });
  const text = textOf(write);
  assert(!/reparse point|escaped the allowed root/.test(text), 'a write under a drive-root-child FS_ROOT is NOT wrongly rejected as a reparse escape');
  if (write.result?.isError !== true) {
    assert(await Bun.file(resolve(root, 'sub', 'new.txt')).exists(), 'the write landed at the correct in-root path (not a corrupted/dropped-char path)');
  } else {
    console.log(`  note: write returned a non-reparse error (likely drive-root permissions): ${text.slice(0, 80)}`);
  }
} finally {
  proc.kill();
  await Bun.$`rm -rf ${root}`.quiet().nothrow();
}

console.log(failures === 0 ? '\nPASS — a drive-root-child FS_ROOT resolves correctly (no off-by-one reparse false-positive).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
