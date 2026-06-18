/**
 * attach-by-class — reach a title-less window by its window class. The taskbar + system tray (Shell_TrayWnd)
 * has NO title, so it can only be attached by className; the MCP attach tool advertised className but only
 * honored it alongside a title, leaving the tray/taskbar (and any title-less window) unreachable. attach now
 * accepts className alone, so an agent can enumerate + act on Start / Search / pinned apps / Network / Volume /
 * Clock / "Show Hidden Icons" — all as cursor-free Button refs.
 *
 * Proof: attach to Shell_TrayWnd by className alone and assert its buttons read. The taskbar is persistent —
 * nothing is spawned or closed.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/attach-by-class.integration.test.ts
 */
import { ControlType, type RefNode, snapshot, skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}
function countButtons(node: RefNode): number {
  return (node.ref !== undefined && node.role === (ControlType[ControlType.Button] ?? 'Button') ? 1 : 0) + node.children.reduce((sum, child) => sum + countButtons(child), 0);
}

skry.initialize();
try {
  const taskbar = skry.attach({ className: 'Shell_TrayWnd' });
  try {
    assert(taskbar.name.length >= 0, `attached to the taskbar by className alone (no title) — name=${JSON.stringify(taskbar.name)}`);
    const snap = snapshot(taskbar, { maxDepth: 20 });
    const buttons = countButtons(snap.tree);
    assert(snap.marks.length >= 5, `the taskbar/tray reads its controls — ${snap.marks.length} refs`);
    assert(buttons >= 3, `tray/taskbar buttons are actionable refs — ${buttons} Button refs (Start/Search/tray icons, cursor-free)`);
    snap.dispose();
  } finally {
    taskbar.dispose();
  }
} catch (error) {
  assert(false, `attach by className threw: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a title-less window (taskbar/tray) is reachable by className alone.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
