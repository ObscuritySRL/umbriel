import { expect, test } from 'bun:test';

// subtreeMatches() applies a {labeledBy} selector by reading the candidate's UIA LabeledBy element, wrapping it as an
// owned Element, and comparing its Name. `label.name` issues a get_CurrentName vcall that throws the use-after-free
// guard if the label provider is torn down between get_CurrentLabeledBy and the read. The bare `label.release()` that
// sat OUTSIDE any try/finally was then skipped and the label IUIAutomationElement proxy leaked. This is reachable on
// the same fast-changing-tree race as the shipped find fixes: a {labeledBy} selector forces needsClientFilter
// (condition.ts), so findFirstMatch's client-filter loop calls subtreeMatches on a live tree — and that loop's catch
// frees only the candidate pointer array, NOT this label local. Same leak-on-throw class as getSelectedText/
// elementArrayNames/walkFolder/msaa. The throw is a tree-timing race (not deterministically reproducible), so pin the
// guard structurally: the label release must sit in a finally.
const src = await Bun.file(`${import.meta.dir}/../element/element.ts`).text();
const start = src.indexOf('function subtreeMatches(');
const body = src.slice(start, src.indexOf('\nfunction ', start + 1));

test('subtreeMatches parsed (the labeledBy branch is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('selector.labeledBy'); // the labeledBy comparison whose label.name read can throw
  expect(body).toContain('label.name'); // the get_CurrentName vcall on the owned label proxy
});

test('subtreeMatches releases the labeledBy label proxy in a finally (no leak when label.name throws)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*label\.release\(\)/); // RED on the old bare `label.release();`
});
