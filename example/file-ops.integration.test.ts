/**
 * file-ops — make_dir / copy_file / move_file / delete_file do native filesystem manipulation, so an AI never shells
 * to mkdir/copy/move/del. Built on Bun-native node:fs (benchmarked vs @bun-win32 FFI: FS ops tie/win for Bun and
 * node:fs is far simpler/safer than manual wide-string FFI). They are 'fs'-category (gated behind full/UMBRIEL_OS) and
 * — CRITICALLY — both source and destination go through resolveFsPath, the SAME hardened confinement (lexical +
 * reparse-point) the existing read/write tools use, so a UMBRIEL_FS_ROOT sandbox cannot be escaped.
 *
 * Proof over the real stdio MCP server with UMBRIEL_FS_ROOT set to a throwaway temp dir: the four ops work end-to-end
 * inside the root (verified on disk), and every attempt to reach OUTSIDE the root (a ../ traversal, an absolute system
 * path) is REFUSED with "outside the allowed root" and leaves the filesystem untouched. The temp root is removed in
 * teardown; no system path is ever mutated.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/file-ops.integration.test.ts
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const root = mkdtempSync(join(tmpdir(), 'umbriel-fileops-'));
writeFileSync(join(root, 'src.txt'), 'hello');

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'full', UMBRIEL_FS_ROOT: root } });
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
const init = (): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'file-ops', version: '1' } } })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const isErr = (m: Rpc): boolean => m.result?.isError === true;
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

try {
  await init();

  // --- functional, INSIDE the sandbox (relative paths resolve against the root) ---
  await call('make_dir', { path: 'sub' });
  assert(existsSync(join(root, 'sub')), 'make_dir creates a directory inside the root');
  await call('copy_file', { from: 'src.txt', to: 'sub/copy.txt' });
  assert(existsSync(join(root, 'sub', 'copy.txt')), 'copy_file copies a file inside the root');
  await call('move_file', { from: 'sub/copy.txt', to: 'moved.txt' });
  assert(existsSync(join(root, 'moved.txt')) && !existsSync(join(root, 'sub', 'copy.txt')), 'move_file moves a file (dest exists, source gone)');
  await call('delete_file', { path: 'moved.txt' });
  assert(!existsSync(join(root, 'moved.txt')), 'delete_file deletes a file');
  await call('delete_file', { path: 'sub' });
  assert(!existsSync(join(root, 'sub')), 'delete_file removes an empty directory');

  // --- overwrite is opt-in (no silent data loss), and a non-empty delete is steered (not a raw ERRNO) ---
  await call('copy_file', { from: 'src.txt', to: 'dst.txt' });
  const noOverwrite = await call('copy_file', { from: 'src.txt', to: 'dst.txt' });
  assert(isErr(noOverwrite) && /already exists/.test(textOf(noOverwrite)), 'copy_file refuses to overwrite an existing destination without {overwrite:true}');
  const withOverwrite = await call('copy_file', { from: 'src.txt', to: 'dst.txt', overwrite: true });
  assert(!isErr(withOverwrite) && /overwrote existing/.test(textOf(withOverwrite)), 'copy_file {overwrite:true} replaces the destination and says so');
  await call('make_dir', { path: 'tree' });
  await call('copy_file', { from: 'src.txt', to: 'tree/f.txt' });
  const nonEmpty = await call('delete_file', { path: 'tree' });
  assert(isErr(nonEmpty) && /\{recursive:true\}/.test(textOf(nonEmpty)) && !/ENOTEMPTY/.test(textOf(nonEmpty)), 'delete_file on a non-empty dir is steered to {recursive:true} (not a raw ENOTEMPTY)');
  await call('delete_file', { path: 'tree', recursive: true });
  assert(!existsSync(join(root, 'tree')), 'delete_file {recursive:true} removes the tree');

  // --- sandbox ESCAPES must be refused, with NO filesystem effect ---
  const outsideDir = join(root, '..', `umbriel-escape-${proc.pid}`);
  const escape1 = await call('make_dir', { path: `../umbriel-escape-${proc.pid}` });
  assert(isErr(escape1) && /outside the allowed root/.test(textOf(escape1)) && !existsSync(outsideDir), `make_dir ../ escape is REFUSED and creates nothing (${JSON.stringify(textOf(escape1).slice(0, 50))})`);

  const escape2 = await call('delete_file', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' });
  assert(isErr(escape2) && /outside the allowed root/.test(textOf(escape2)) && existsSync('C:\\Windows\\System32\\drivers\\etc\\hosts'), 'delete_file on an absolute system path is REFUSED and leaves it intact');

  const escape3 = await call('copy_file', { from: 'src.txt', to: '../umbriel-escape-copy.txt' });
  assert(isErr(escape3) && /outside the allowed root/.test(textOf(escape3)) && !existsSync(join(root, '..', 'umbriel-escape-copy.txt')), 'copy_file destination escape is REFUSED');
} finally {
  proc.kill();
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nPASS — file ops work inside the sandbox and every escape attempt is refused with no filesystem effect.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
