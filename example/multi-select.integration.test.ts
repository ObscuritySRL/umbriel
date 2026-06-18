/**
 * multi-select — live proof that an AI can select/multi-select/deselect list items CURSOR-FREE (cantDo #4).
 *
 * Drives a File Explorer file list through the published SelectionItem/Selection pattern methods (the same
 * path the MCP `select` tool uses): replace-select, add-to-selection (multi), read the container's selection,
 * and remove-from-selection — all without the real mouse, so it works on a background/locked session.
 *
 * Asserts: select() selects one and clears others; addToSelection() keeps both (multi-select); the container's
 * getSelection() reports them; canSelectMultiple is true; removeFromSelection() deselects. A wrong slot would
 * segfault — so this live-exercises the new SLOT entries too.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/multi-select.integration.test.ts
 */
import { closeWindow, ControlType, skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const priorExplorers = new Set(
  skry
    .windows()
    .filter((window) => window.className === 'CabinetWClass')
    .map((window) => window.hWnd),
);
Bun.spawn(['explorer.exe', 'C:\\Windows\\System32\\drivers\\etc'], { stdout: 'ignore', stderr: 'ignore' });
await Bun.sleep(2500);
const hWnd = skry.windows().find((window) => window.className === 'CabinetWClass' && !priorExplorers.has(window.hWnd))?.hWnd ?? 0n;

try {
  if (hWnd === 0n) {
    console.log('[multi-select] could not open Explorer — SKIPPING');
  } else {
    const explorer = skry.attach(hWnd);
    const list = explorer.find({ controlType: ControlType.List });
    const items = explorer.findAll({ controlType: ControlType.ListItem });
    console.log(`  list container: ${list !== null}, list items: ${items.length}`);
    assert(items.length >= 2, `the folder shows at least 2 selectable items (${items.length})`);
    if (list !== null && items.length >= 2) {
      assert(list.canSelectMultiple, 'the list container reports canSelectMultiple');

      items[0]!.select(); // replace selection with item 0
      await Bun.sleep(200);
      assert(items[0]!.isSelected && !items[1]!.isSelected, 'select() selects item 0 and clears item 1');

      items[1]!.addToSelection(); // multi-select — keep item 0
      await Bun.sleep(200);
      assert(items[0]!.isSelected && items[1]!.isSelected, 'addToSelection() keeps BOTH item 0 and item 1 selected (cursor-free multi-select)');

      const selected = list.getSelection();
      console.log(`  container.getSelection(): [${selected.map((entry) => JSON.stringify(entry.name)).join(', ')}]`);
      assert(selected.length === 2, `the container reports both selected items (${selected.length})`);
      for (const entry of selected) entry.release();

      items[1]!.removeFromSelection(); // deselect item 1
      await Bun.sleep(200);
      assert(items[0]!.isSelected && !items[1]!.isSelected, 'removeFromSelection() deselects item 1, keeps item 0');
      const afterRemove = list.getSelection();
      assert(afterRemove.length === 1, 'the container now reports a single selection');
      for (const entry of afterRemove) entry.release();
    }
    for (const item of items) item.release();
    list?.release();
    explorer.dispose();
  }
} finally {
  if (hWnd !== 0n) closeWindow(hWnd);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — cursor-free multi-select verified (select / addToSelection / getSelection / removeFromSelection).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
