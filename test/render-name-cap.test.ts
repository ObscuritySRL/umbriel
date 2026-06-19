// renderSnapshot/renderDiff cap a node's displayed NAME (like the value@40 suffix), so one long name (a code-editor
// line, a chat/log row, a paragraph surfaced as a Text node's name) can't bloat the per-action snapshot the agent
// re-reads every step, nor push actionable refs past the size cap. Pure logic — no FFI, no window.
import { expect, test } from 'bun:test';

import { capLabel, renderSnapshot } from '../element/refmap';

test('capLabel leaves a short name intact and clips a long one to ~120 chars + …', () => {
  expect(capLabel('Five')).toBe('"Five"'); // short label: JSON-quoted, unchanged
  expect(capLabel('')).toBe('""');
  const long = 'x'.repeat(311); // a 311-char Text-node name (e.g. a source line)
  const capped = capLabel(long);
  expect(capped.length).toBeLessThan(130); // ~120 + ellipsis + quotes, NOT 313
  expect(capped.endsWith('…"')).toBe(true);
  expect(capped.startsWith('"xxx')).toBe(true); // the leading content is preserved
});

test('renderSnapshot caps a long node name instead of rendering it in full', () => {
  const shortNode = { role: 'Button', name: 'Save', ref: 'e1#1', children: [] };
  expect(renderSnapshot(shortNode)).toContain('"Save"'); // short names render verbatim

  const longName = 'y'.repeat(300);
  const longNode = { role: 'Text', name: longName, children: [] };
  const out = renderSnapshot(longNode);
  expect(out.length).toBeLessThan(160); // not ~300+ — the one uncapped field is now bounded
  expect(out).toContain('…');
  expect(out).not.toContain(longName); // the full 300-char name is NOT emitted
});
