import { Glob } from 'bun';
import { expect, test } from 'bun:test';

// AGENTS.md: "No type casts. Ever." In strict TS a `catch (error)` binds `error: unknown`, so
// `(error as Error).message` is a real unknown→Error downcast — and it is unsafe: a thrown non-Error
// (string/object) yields `undefined`, and `throw null` / `throw undefined` makes `.message` itself throw
// TypeError inside the very handler whose job is robust error reporting. The house idiom is the total,
// cast-free `error instanceof Error ? error.message : String(error)`. Pin that no shipping module reintroduces it.
// Beyond that catch idiom, AGENTS "Things to Never Do" forbids `as any` / `as unknown as T` outright — the
// type-system-erasing escape hatches it says to "fix the types instead" of. The only blessed `as` forms in shipping
// code are the FFI `Number(x) as Pointer` brand and `as const` (neither matches below); the guarded narrowings
// `as Record<string, unknown>` / `as keyof typeof X` are NOT erasing forms and stay allowed. Pin that the erasing
// forms remain absent too (0 hits today) — completing this gate's stated "no type casts" purpose past the one idiom.
const root = `${import.meta.dir}/..`;
const patterns = ['index.ts', 'mcp.ts', 'com/**/*.ts', 'element/**/*.ts', 'input/**/*.ts', 'capture/**/*.ts', 'desktop/**/*.ts', 'agent/**/*.ts'];

const errorCastOffenders: string[] = [];
const typeEraseOffenders: string[] = [];
for (const pattern of patterns) {
  for await (const rel of new Glob(pattern).scan(root)) {
    const text = await Bun.file(`${root}/${rel}`).text();
    if (text.includes('(error as Error)')) errorCastOffenders.push(rel);
    if (/\bas any\b/.test(text) || /\bas unknown as\b/.test(text)) typeEraseOffenders.push(rel); // the type-erasing forms; `as Pointer`/`as const`/`as Record<…, unknown>`/`as keyof …` do not match
  }
}

test('no shipping module uses the prohibited (error as Error) catch cast', () => {
  expect(errorCastOffenders).toEqual([]);
});

test('no shipping module uses a type-erasing `as any` / `as unknown as T` cast (AGENTS: fix the types instead)', () => {
  expect(typeEraseOffenders).toEqual([]);
});
