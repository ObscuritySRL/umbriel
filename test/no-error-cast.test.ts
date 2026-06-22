import { Glob } from 'bun';
import { expect, test } from 'bun:test';

// AGENTS.md: "No type casts. Ever." In strict TS a `catch (error)` binds `error: unknown`, so
// `(error as Error).message` is a real unknown→Error downcast — and it is unsafe: a thrown non-Error
// (string/object) yields `undefined`, and `throw null` / `throw undefined` makes `.message` itself throw
// TypeError inside the very handler whose job is robust error reporting. The house idiom is the total,
// cast-free `error instanceof Error ? error.message : String(error)`. Pin that no shipping module reintroduces it.
const root = `${import.meta.dir}/..`;
const patterns = ['index.ts', 'mcp.ts', 'com/**/*.ts', 'element/**/*.ts', 'input/**/*.ts', 'capture/**/*.ts', 'desktop/**/*.ts', 'agent/**/*.ts'];

const offenders: string[] = [];
for (const pattern of patterns) {
  for await (const rel of new Glob(pattern).scan(root)) {
    if ((await Bun.file(`${root}/${rel}`).text()).includes('(error as Error)')) offenders.push(rel);
  }
}

test('no shipping module uses the prohibited (error as Error) catch cast', () => {
  expect(offenders).toEqual([]);
});
