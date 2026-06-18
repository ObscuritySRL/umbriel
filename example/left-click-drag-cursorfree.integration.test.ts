/**
 * left-click-drag-cursorfree — the computer-use `left_click_drag` action ignored the cursorless option and always
 * moved the REAL mouse (SetCursorPos + SendInput down/up), breaking the drive-in-the-dark doctrine every other click
 * verb honors and leaving the library behind the MCP `drag` tool's cursor-free path. dispatch() now resolves the
 * owner HWND of the START point (fromPoint → ownerHwnd, mirroring semanticClick) and posts a cursor-free drag-SELECT
 * (WM_LBUTTONDOWN → interpolated MK_LBUTTON moves → WM_LBUTTONUP) to it when cursorless, leaving the real cursor put.
 *
 * Proof: type a line into a spawned Notepad, park the real cursor in a corner, dispatch a cursorless left_click_drag
 * across the editor's text, and assert the result is "(cursor-free)" AND the real cursor never moved. Without the fix
 * the case returns {ok:true} with NO output AND dragTo SetCursorPos's the real mouse — both assertions fail. Notepad
 * is force-killed by its window PID in teardown (findings/31 window discipline) so no save dialog is left behind.
 *
 * bun test is broken repo-wide — runnable harness (spawned Notepad):
 * Run: bun run example/left-click-drag-cursorfree.integration.test.ts
 */
import { closeWindow, skry, windowProcessId } from 'skry';
import User32 from '@bun-win32/user32';

const cursor = (): { x: number; y: number } => {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
};

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const notepad = await skry.launch(['notepad.exe'], { title: 'Untitled - Notepad' }, 6000).catch(() => skry.launch(['notepad.exe'], { className: 'Notepad' }, 6000).catch(() => null));
try {
  if (notepad === null) {
    console.log('  skip(live): Notepad did not launch');
  } else {
    await Bun.sleep(700);
    // Put a line of text in the editor so the drag has something to marquee/text-select cursor-free.
    await skry.dispatch(notepad, { action: 'type', text: 'the quick brown fox jumps over the lazy dog' }, { cursorless: true });
    await Bun.sleep(120);
    const bounds = notepad.boundingRectangle;
    const y = Math.round(bounds.y + bounds.height / 2);
    const startX = Math.round(bounds.x + bounds.width * 0.2);
    const endX = Math.round(bounds.x + bounds.width * 0.6);
    User32.SetCursorPos(7, 7);
    await Bun.sleep(80);
    const before = cursor();
    const result = await skry.dispatch(notepad, { action: 'left_click_drag', startCoordinate: [startX, y], coordinate: [endX, y] }, { cursorless: true });
    await Bun.sleep(80);
    const after = cursor();
    console.log(`  dispatch -> ${JSON.stringify(result.output ?? result.error)}`);
    assert(result.ok && /cursor-free/.test(result.output ?? ''), `left_click_drag reports cursor-free (got: ${JSON.stringify(result.output ?? result.error)})`);
    assert(Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2, `the real cursor never moved (before ${before.x},${before.y} → after ${after.x},${after.y})`);
  }
} finally {
  if (notepad !== null) {
    const notepadPid = windowProcessId(notepad.hWnd);
    if (notepadPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(notepadPid)]);
    closeWindow(notepad.hWnd);
    notepad.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — left_click_drag honors cursorless (posted cursor-free drag-select, real mouse unmoved).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
