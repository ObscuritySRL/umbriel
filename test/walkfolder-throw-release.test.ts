import { expect, test } from 'bun:test';

// walkFolder() recurses the Task Scheduler folder tree, reading each subfolder's path and releasing the subfolder
// proxy. The path read goes through getBstr → a vcall that throws the use-after-free guard if the subfolder proxy is
// torn down (a folder deleted mid-enumeration — the exact live race collectTasks' own fix in this file documents).
// The bare `comRelease(subfolder)` that sat OUTSIDE any try/finally was then skipped and the ITaskFolder proxy leaked;
// the enclosing finally frees only the subfolders COLLECTION, not the per-item subfolder. Same leak-on-throw class as
// the sibling collectTasks (same file) and getSelectedText/readVisibleText/readTable/elementArrayNames — it survived in
// walkFolder while collectTasks was already guarded. The throw is a tree-timing race (not deterministically
// reproducible), so pin the guard structurally: the per-subfolder release must sit in a finally.
const src = await Bun.file(`${import.meta.dir}/../desktop/tasks.ts`).text();
const start = src.indexOf('function walkFolder(');
const body = src.slice(start, src.indexOf('\nfunction ', start + 1));

test('walkFolder parsed (the recursive subfolder walk is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('ITaskFolder_get_Path'); // the per-subfolder path read that can throw via getBstr's vcall
});

test('walkFolder releases each subfolder proxy in a finally (no leak when getBstr throws mid-walk)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*comRelease\(subfolder\)/); // RED on the old bare `comRelease(subfolder);` (and does not match comRelease(subfolders))
});
