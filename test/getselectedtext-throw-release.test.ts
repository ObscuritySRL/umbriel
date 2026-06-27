import { expect, test } from 'bun:test';

// getSelectedText() walks a TextPattern selection, releasing each IUIAutomationTextRange proxy as it goes. If the
// per-range GetText vcall throws the use-after-free guard (the range torn down mid-enumeration — the selection
// changed or the control was destroyed between GetSelection and the read), the bare `comRelease(range)` that sat
// OUTSIDE any try/finally was skipped and the range proxy leaked, while the throw propagated past the two outer
// finally blocks (which free only the selection array + the pattern). This is the SAME leak-on-throw class already
// fixed in the three sibling range/cell walks — readVisibleText (patterns.ts), readTable (patterns.ts) and
// collectTasks (tasks.ts) — at the one site that still carried the bare release. The throw is a tree-timing race
// (not deterministically reproducible in a unit test), so pin the guard structurally: the per-range release must
// sit in a finally, exactly as readVisibleText's does.
const src = await Bun.file(`${import.meta.dir}/../element/patterns.ts`).text();
const start = src.indexOf('export function getSelectedText(');
const body = src.slice(start, src.indexOf('\nexport ', start + 1));

test('getSelectedText parsed (the TextPattern selection walk is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('SLOT.GetSelection');
  expect(body).toContain('SLOT.GetText'); // the per-range read that can throw on a torn-down proxy
});

test('getSelectedText releases each range proxy in a finally (no leak when the GetText vcall throws mid-range)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*comRelease\(range\)/); // the per-range release is finally-guarded, not a bare post-vcall call — RED on the old bare `comRelease(range);`
});
