/**
 * find-files — the find_files MCP tool: recursive glob under UMBRIEL_FS_ROOT in ONE call, replacing a
 * `dir /s` / `where` / `Get-ChildItem -Recurse` shell-out and an N-call list_dir fan-out. The security
 * guarantee is per-hit sandbox re-validation: a `../**` or absolute glob can escape the scan cwd, so every
 * raw Bun.Glob hit is re-resolved through resolveFsPath and matches outside UMBRIEL_FS_ROOT are dropped
 * (counted in a footer, never silently leaked).
 *
 * Proof (live, MCP subprocess, no window — pure fs): a temp tree with an in-root target.json (nested), an
 * in-root note.txt, and a SECRET sibling OUTSIDE the root. Asserts: (1) a recursive json glob finds the nested
 * target.json and NOT note.txt; (2) a parent-escape json glob never surfaces the out-of-root secret (filtered);
 * (3) a missing dir returns the steered 'no such path' error, not a raw stack; (4) limit:1 reports truncation.
 * The temp tree is removed in finally (the fs analog of closeWindow).
 *
 * bun test is broken repo-wide for FFI — runnable harness (only the MCP subprocess):
 * Run: bun run example/find-files.integration.test.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = join(tmpdir(), `umbriel-ff-${process.pid}`);
const root = join(base, 'root');
mkdirSync(join(root, 'a', 'b'), { recursive: true });
writeFileSync(join(root, 'a', 'b', 'target.json'), '{}');
writeFileSync(join(root, 'a', 'note.txt'), 'note');
writeFileSync(join(base, 'secret.json'), 'TOP SECRET — outside the sandbox root'); // sibling of root, OUTSIDE UMBRIEL_FS_ROOT

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'full', UMBRIEL_OS: '1', UMBRIEL_FS_ROOT: root } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (message: Rpc) => void>();
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
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'find-files', version: '1' } });

  const inRoot = textOf(await call('tools/call', { name: 'find_files', arguments: { dir: '.', pattern: '**/*.json' } }));
  assert(inRoot.includes('target.json'), `'**/*.json' finds the nested in-root target.json — got ${JSON.stringify(inRoot.split('\n').filter((l) => l.includes('.json')))}`);
  assert(!inRoot.includes('note.txt'), `'**/*.json' does not match the .txt file`);
  assert(!inRoot.includes('secret.json'), `'**/*.json' does not reach the out-of-root secret`);

  const escape = textOf(await call('tools/call', { name: 'find_files', arguments: { dir: '.', pattern: '../**/*.json' } }));
  assert(!escape.includes('secret.json'), `'../**/*.json' NEVER surfaces the out-of-root secret (per-hit sandbox re-validation) — got ${JSON.stringify(escape)}`);

  const missing = await call('tools/call', { name: 'find_files', arguments: { dir: 'does-not-exist', pattern: '*' } });
  assert(missing.result?.isError === true && /no such path/.test(textOf(missing)), `a missing dir returns the steered 'no such path' error, not a raw stack — got ${JSON.stringify(textOf(missing))}`);

  const capped = textOf(await call('tools/call', { name: 'find_files', arguments: { dir: '.', pattern: '**/*', limit: 1 } }));
  assert(/more matches past the limit/.test(capped), `limit:1 over a multi-file tree reports truncation (no silent cap) — got ${JSON.stringify(capped)}`);
} finally {
  proc.kill();
  rmSync(base, { recursive: true, force: true }); // remove the temp tree (the fs analog of closeWindow)
}

console.log(failures === 0 ? '\nPASS — find_files globs recursively in one call and drops every out-of-sandbox hit.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
