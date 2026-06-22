import { expect, test } from 'bun:test';
import { pruneRefTree, type RefNode } from 'umbriel';

// pruneRefTree drops a leaf Text node whose name exactly restates its parent's name (a classic Button/ListItem emits
// a child Text mirroring its own label) — pure render-economy, information-preserving (the parent keeps the name, the
// dropped Text is non-actionable so resolveRef/marks are untouched). The equality + ref/automationId gates are
// load-bearing: a DIFFERENTLY-named sibling Text, or a Text that could be a target, must be KEPT. Pure unit — no desktop.

test('a leaf Text duplicating the parent name is dropped from the render', () => {
  const node: RefNode = { ref: 'e1', role: 'Button', name: 'Trigonometry', children: [{ role: 'Text', name: 'Trigonometry', children: [] }] };
  const pruned = pruneRefTree(node);
  expect(pruned).not.toBeNull();
  expect(pruned!.children.length).toBe(0); // the duplicate Text is gone
  expect(pruned!.name).toBe('Trigonometry'); // the parent still carries the name — the string survives exactly once
});

test('a leaf Text with a DIFFERENT name is KEPT (the equality gate is load-bearing)', () => {
  const node: RefNode = { ref: 'e2', role: 'Button', name: 'Functions', children: [{ role: 'Text', name: 'Function', children: [] }] };
  const pruned = pruneRefTree(node);
  expect(pruned!.children.length).toBe(1);
  expect(pruned!.children[0]!.name).toBe('Function');
});

test('a duplicate Text that carries a ref is KEPT (it could be an action target)', () => {
  const node: RefNode = { ref: 'e3', role: 'Button', name: 'X', children: [{ ref: 'e4', role: 'Text', name: 'X', children: [] }] };
  expect(pruneRefTree(node)!.children.length).toBe(1);
});

test('a duplicate Text that carries an automationId is KEPT (it could be a selector target)', () => {
  const node: RefNode = { ref: 'e5', role: 'Button', name: 'Y', children: [{ role: 'Text', name: 'Y', automationId: 'someId', children: [] }] };
  expect(pruneRefTree(node)!.children.length).toBe(1);
});

test('a non-leaf node whose name matches the parent is KEPT (only LEAF Text is dropped)', () => {
  const node: RefNode = { ref: 'e6', role: 'Group', name: 'Panel', children: [{ role: 'Text', name: 'Panel', children: [{ ref: 'e7', role: 'Button', name: 'Click', children: [] }] }] };
  const pruned = pruneRefTree(node);
  expect(pruned!.children.length).toBe(1); // the 'Panel' Text has a child, so it is not a leaf — kept
});
