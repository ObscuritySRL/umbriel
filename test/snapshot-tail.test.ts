import { expect, test } from 'bun:test';

const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('desktop_snapshot exposes a root-scoped tail option', () => {
  expect(mcp).toContain("tail: { type: 'number', description: 'With root, render only its newest N direct children");
  expect(mcp).toContain('desktop_snapshot {tail} requires {root}');
  expect(mcp).toContain('children: tree.children.slice(-tailCount)');
});

test('desktop_snapshot threads tail into snapshotText without changing full snapshot state', () => {
  expect(mcp).toContain("typeof args.tail === 'number' ? args.tail : undefined");
  expect(mcp).toContain('lastSnapshotTree = tree;');
  expect(mcp).toContain('showing the newest ${Math.min(tailCount, tree.children.length)} of ${tree.children.length} direct children');
});
