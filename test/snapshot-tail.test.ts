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

test('attach can bound or scope its initial snapshot without a second tool call', () => {
  expect(mcp).toContain("maxDepth: { type: 'number', description: 'Bound the initial snapshot depth");
  expect(mcp).toContain("if (rootName !== undefined || tail !== undefined) return textResult(`${message}\\n\\n${snapshotText(maxDepth, rootName, maxNodes, tail)}`)");
  expect(mcp).toContain('return withSnapshot(message, maxDepth, maxNodes);');
  expect(mcp).toContain('rebuilt = rebuildSnapshot(maxDepth, undefined, maxNodes);');
});
