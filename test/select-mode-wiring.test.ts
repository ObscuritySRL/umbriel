import { expect, test } from 'bun:test';

// C8: the shared act() engine + find_and_act + reveal must thread the select mode (replace|add|remove), so a
// SELECTOR-found item can be multi-selected (add) or deselected (remove) in ONE call — previously only the dedicated
// by-ref `select` tool reached addToSelection/removeFromSelection, forcing a snapshot+per-item round-trip. The
// underlying cursor-free behavior (addToSelection keeps the others; removeFromSelection deselects) is live-proven in
// example/multi-select.integration.test.ts; this pins the wiring that routes mode to it, and that default=replace
// keeps every existing act() caller byte-identical.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('act() takes a mode param (default replace) and its select branch dispatches add/remove/replace', () => {
  expect(mcp).toContain("mode: 'replace' | 'add' | 'remove' = 'replace'"); // act() signature, default keeps callers byte-identical
  const dispatch = "mode === 'add' ? element.addToSelection() : mode === 'remove' ? element.removeFromSelection() : element.select()";
  // appears in BOTH the act() select branch and the dedicated select handler — same dispatch, same disclosure path
  expect(mcp.split(dispatch).length - 1).toBeGreaterThanOrEqual(2);
});

test('find_and_act and reveal thread the normalized mode through to act(); the enum is in both schemas', () => {
  const threaded = "args.submit === true, args.mode === 'add' ? 'add' : args.mode === 'remove' ? 'remove' : 'replace'";
  expect(mcp.split(threaded).length - 1).toBe(2); // exactly the find_and_act + reveal call sites (grid_cell stays mode-less)
  expect(mcp.split("enum: ['replace', 'add', 'remove']").length - 1).toBeGreaterThanOrEqual(3); // find_and_act + reveal + the dedicated select tool
});
