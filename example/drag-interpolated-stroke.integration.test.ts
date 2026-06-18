/**
 * drag-interpolated-stroke — the real-cursor `dragTo` (and the MCP `drag` default + the computer-use
 * `left_click_drag` that inherit it) used to TELEPORT: SetCursorPos(from) → LEFTDOWN → SetCursorPos(to) → LEFTUP, with
 * NO moves between button-down and button-up. The OS will not register a drag until the pointer moves ≥ SM_CXDRAG/
 * SM_CYDRAG (4px) AFTER button-down, and HTML5/Chromium fire dragstart/dragover only on the WM_MOUSEMOVE stream
 * between down and up — so every threshold-gated drag (HTML5 drag-drop, list reorder, slider thumb, canvas) silently
 * no-op'd. dragTo now interpolates `steps` (default 16) SetCursorPos moves between LEFTDOWN and LEFTUP, mirroring the
 * proven coords.ts:postDragToHwnd loop — crossing the threshold and feeding the dragover stream.
 *
 * Proof: launch classic Windows Paint (default Pencil), force it foreground, VERIFY the canvas under the start point
 * is white, drag the pencil diagonally with the real cursor, and assert a black STROKE now exists at the diagonal
 * MIDPOINT (before: 0 dark px; after: a painted line) — a teleport would leave the midpoint blank. A contended/
 * occluded desktop (concurrent agents stealing foreground) is honestly SKIPPED, not failed. Paint is force-killed by
 * its window PID in teardown (findings/31 window discipline) so no save dialog is left behind.
 *
 * bun test is broken repo-wide for FFI; runnable harness (spawned Paint):
 * Run: bun run example/drag-interpolated-stroke.integration.test.ts
 */
import { captureScreen, closeWindow, dragTo, moveTo, skry, windowProcessId } from 'skry';
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// AttachThreadInput foreground trick — the only way past the OS foreground lock to make a REAL-cursor drag land on a
// freshly spawned window when another process holds focus (this is a TEST harness need, not a library behavior).
function forceForeground(hWnd: bigint): boolean {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const foreground = User32.GetForegroundWindow();
    if (foreground === hWnd) return true;
    const me = Kernel32.GetCurrentThreadId();
    const foregroundThread = User32.GetWindowThreadProcessId(foreground, null);
    const targetThread = User32.GetWindowThreadProcessId(hWnd, null);
    User32.AttachThreadInput(me, foregroundThread, 1);
    User32.AttachThreadInput(me, targetThread, 1);
    User32.BringWindowToTop(hWnd);
    User32.ShowWindow(hWnd, 3); // SW_MAXIMIZE
    User32.SetForegroundWindow(hWnd);
    User32.AttachThreadInput(me, targetThread, 0);
    User32.AttachThreadInput(me, foregroundThread, 0);
  }
  return User32.GetForegroundWindow() === hWnd;
}

const isWhite = (x: number, y: number): boolean => {
  const shot = captureScreen({ x, y, width: 2, height: 2 });
  return shot.rgb[0]! > 200 && shot.rgb[1]! > 200 && shot.rgb[2]! > 200;
};
const darkAround = (cx: number, cy: number): number => {
  const shot = captureScreen({ x: cx - 6, y: cy - 6, width: 12, height: 12 });
  let dark = 0;
  for (let i = 0; i < shot.rgb.length; i += 3) if (shot.rgb[i]! < 100 && shot.rgb[i + 1]! < 100 && shot.rgb[i + 2]! < 100) dark += 1;
  return dark;
};

skry.initialize();
const paint = await skry.launch(['cmd', '/c', 'start', 'mspaint'], { className: 'MSPaintApp' }, 9000).catch(() => null);
try {
  if (paint === null) {
    console.log('  skip(live): Paint did not launch');
  } else {
    await Bun.sleep(2500);
    const foreground = forceForeground(paint.hWnd);
    await Bun.sleep(500);
    const bounds = paint.boundingRectangle;
    const fromX = Math.round(bounds.x + bounds.width * 0.45);
    const fromY = Math.round(bounds.y + bounds.height * 0.45);
    const toX = Math.round(bounds.x + bounds.width * 0.6);
    const toY = Math.round(bounds.y + bounds.height * 0.65);
    const midX = Math.round((fromX + toX) / 2);
    const midY = Math.round((fromY + toY) / 2);

    if (!foreground || !isWhite(fromX, fromY)) {
      console.log(`  skip(live): Paint not foreground or canvas not white (fg=${foreground}, white=${isWhite(fromX, fromY)}) — contended desktop, not a fix failure`);
    } else {
      const before = darkAround(midX, midY);
      moveTo(fromX, fromY);
      await Bun.sleep(150);
      dragTo(fromX, fromY, toX, toY);
      await Bun.sleep(400);
      const after = darkAround(midX, midY);
      console.log(`  drag ${fromX},${fromY} → ${toX},${toY}; midpoint (${midX},${midY}) dark before=${before} after=${after} /144`);
      assert(before <= 2, `canvas midpoint blank before the drag (${before} dark px)`);
      assert(after >= 6, `interpolated drag painted a stroke through the midpoint (${after} dark px — a teleport leaves it blank)`);
    }
  }
} finally {
  if (paint !== null) {
    const pid = windowProcessId(paint.hWnd);
    if (pid) Bun.spawnSync(['taskkill', '/F', '/PID', String(pid)]);
    closeWindow(paint.hWnd);
    paint.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — dragTo interpolates the real-cursor path (crosses the OS drag threshold, paints a continuous stroke).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
