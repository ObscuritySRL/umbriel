import { expect, test } from 'bun:test';

// chromiumHostHandle() walks self → up to 32 ancestors looking for the Chromium host window, reading each node's
// nativeWindowHandle (a getHandle vcall) and .parent (a GetParentElement vcall) — both throw the use-after-free guard
// if an OWNED ancestor proxy is torn down mid-walk (a closing Chromium/Electron host window). The per-ancestor release
// `if (node !== this) node.release()` sat OUTSIDE any try/finally, so a handle/parent throw skipped it and leaked the
// owned ancestor proxy (`this`, at depth 0, is caller-owned and correctly never released). Same leak-on-throw class as
// getSelectedText/elementArrayNames/walkFolder/msaa/subtreeMatches/scrollAt. The throw is a tree-timing race (not
// deterministically reproducible), so pin the guard structurally: the per-ancestor release must sit in a finally, and
// must keep the `!== this` guard so the caller-owned start node is never released.
const src = await Bun.file(`${import.meta.dir}/../element/element.ts`).text();
const start = src.indexOf('chromiumHostHandle(): bigint {');
const body = src.slice(start, src.indexOf('\n  /**', start));

test('chromiumHostHandle parsed (the ancestor walk is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('.nativeWindowHandle'); // the throwable getHandle read
  expect(body).toContain('.parent'); // the throwable GetParentElement read
});

test('chromiumHostHandle releases each walked ancestor in a finally, preserving the !== this guard', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*if \(current !== this\) current\.release\(\)/); // RED on the old bare `if (node !== this) node.release();`
});
