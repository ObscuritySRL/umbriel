/**
 * delete-recycle — delete_file {recycle:true} sends a file/tree to the Windows Recycle Bin (RECOVERABLE) instead of a
 * permanent unlink, via Shell32.SHFileOperationW(FO_DELETE | FOF_ALLOWUNDO) — the human's "oops, restore it" safety net
 * an agent otherwise lacks. Composed on the INSTALLED @bun-win32/shell32 binding (no new package, no hand-roll). The
 * default (no flag) stays the byte-identical permanent unlinkSync/rmSync path, and the recycle path keeps the SAME
 * empty-dir safety floor (a non-empty dir still needs {recursive:true}) and the SAME UMBRIEL_FS_ROOT confinement.
 *
 * Proof over the real stdio MCP server with UMBRIEL_FS_ROOT set to a throwaway temp dir:
 *   - {recycle:true} removes a file from disk and reports it as recoverable;
 *   - a directory tree recycles in one {recursive:true} call;
 *   - a non-empty dir WITHOUT recursive is steered (not silently tree-recycled) — the safety floor holds;
 *   - the DEFAULT delete (no recycle) still permanently deletes and says "deleted";
 *   - recycleToBin rejects an embedded-NUL path (the pFrom double-NUL-injection guard) before any shell call.
 * It does NOT empty the Recycle Bin (SHEmptyRecycleBin would destroy the user's OWN recycled files) — the throwaway
 * temp files left in the bin are a few harmless bytes the user can clear themselves.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/delete-recycle.integration.test.ts
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recycleToBin } from '../element/window';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const root = mkdtempSync(join(tmpdir(), 'umbriel-recycle-'));
writeFileSync(join(root, 'recycle-me.txt'), 'restore me from the bin');
writeFileSync(join(root, 'perm.txt'), 'gone forever');
mkdirSync(join(root, 'tree'));
writeFileSync(join(root, 'tree', 'leaf.txt'), 'in a subtree');

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
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'delete-recycle', version: '1' } } })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const isErr = (m: Rpc): boolean => m.result?.isError === true;
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

try {
  await init();

  // --- {recycle:true} on a FILE: gone from disk, reported recoverable ---
  const recycled = await call('delete_file', { path: 'recycle-me.txt', recycle: true });
  assert(!isErr(recycled) && /recycled file/.test(textOf(recycled)) && /recoverable/.test(textOf(recycled)), `recycle removes the file and reports it recoverable (${JSON.stringify(textOf(recycled).slice(0, 70))})`);
  assert(!existsSync(join(root, 'recycle-me.txt')), 'the recycled file is gone from its original location on disk');

  // --- the DEFAULT (no recycle) path is the unchanged permanent delete ---
  const permanent = await call('delete_file', { path: 'perm.txt' });
  assert(!isErr(permanent) && /^deleted file/.test(textOf(permanent)), 'a delete WITHOUT {recycle} still permanently deletes and says "deleted" — not "recycled" (byte-identical default path)');
  assert(!existsSync(join(root, 'perm.txt')), 'the permanently-deleted file is gone');

  // --- empty-dir safety floor holds for recycle: a non-empty dir without recursive is STEERED, not tree-recycled ---
  const nonEmpty = await call('delete_file', { path: 'tree', recycle: true });
  assert(isErr(nonEmpty) && /\{recursive:true\}/.test(textOf(nonEmpty)), 'recycle on a non-empty dir WITHOUT {recursive} is steered to {recursive:true} (the tree is NOT silently recycled)');
  assert(existsSync(join(root, 'tree', 'leaf.txt')), 'the un-recursive recycle left the directory tree untouched');

  // --- recycle a whole tree in one {recursive:true} call ---
  const treeRecycle = await call('delete_file', { path: 'tree', recursive: true, recycle: true });
  assert(!isErr(treeRecycle) && /recycled directory/.test(textOf(treeRecycle)), 'recycle {recursive:true} sends the whole directory tree to the bin');
  assert(!existsSync(join(root, 'tree')), 'the recycled directory tree is gone from disk');

  // --- the embedded-NUL pFrom-injection guard: recycleToBin rejects a NUL-bearing path before any shell call ---
  let threw = false;
  try {
    recycleToBin('umbriel-nul-guard-probe\0second-fake-entry'); // a real embedded NUL (TS \0 escape) between two fake entries - the guard must throw BEFORE any resolve()/shell call
  } catch {
    threw = true;
  }
  assert(threw, 'recycleToBin throws on an embedded-NUL path (the double-NUL pFrom-injection guard) instead of letting the shell read past it as extra paths');
} finally {
  proc.kill();
  rmSync(root, { recursive: true, force: true }); // removes the temp root; the recycled copies live in the Recycle Bin and are intentionally left (no SHEmptyRecycleBin — that would nuke the user's own bin)
}

console.log(failures === 0 ? '\nPASS — delete_file {recycle:true} sends files/trees to the Recycle Bin recoverably, the default delete stays permanent, the empty-dir floor + sandbox hold, and the embedded-NUL guard rejects.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
