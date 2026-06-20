/**
 * drag-stroke-modifiers — dragStroke() performs a real-cursor drag along a POLYLINE with HELD modifiers — the gestures a
 * 2-point dragTo can't express (Ctrl+drag copy, Shift+constrain, lasso/curve). Proven: a 3-waypoint Ctrl+drag traces the
 * cursor to the final waypoint and leaves NO stuck modifier (the finally-guarded keyUp), the held-modifier mechanism
 * dragStroke uses (keyDown holds it, keyUp releases) works, and <2 points throws. Drags inside a launched Notepad's
 * empty editor (a benign surface — a Ctrl+drag there selects nothing); Notepad killed in finally.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/drag-stroke-modifiers.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { closeWindow, dragStroke, keyDown, keyUp, killProcess, moveWindow, raiseWindow, umbriel, windowProcessId } from 'umbriel';

const VK_CONTROL = 0x11;
const cursorAt = (): { x: number; y: number } => {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
};
const ctrlDown = (): boolean => (User32.GetAsyncKeyState(VK_CONTROL) & 0x8000) !== 0;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const notepad = await umbriel.launch(['notepad.exe'], { className: 'Notepad' });
await Bun.sleep(700);
try {
  moveWindow(notepad.hWnd, 120, 120, 700, 500);
  raiseWindow(notepad.hWnd);
  await Bun.sleep(300);
  // waypoints inside Notepad's editor area — a Ctrl+left-drag here is a benign empty-selection
  const path = [{ x: 250, y: 260 }, { x: 600, y: 330 }, { x: 400, y: 480 }];
  dragStroke(path, ['Control']);
  await Bun.sleep(60);
  const end = cursorAt();
  assert(Math.abs(end.x - 400) <= 3 && Math.abs(end.y - 480) <= 3, `dragStroke traced the polyline to its LAST waypoint (cursor at ${end.x},${end.y}, expected ~400,480 — a 2-point dragTo could not visit the middle one)`);
  assert(!ctrlDown(), 'Control is NOT stuck down after dragStroke — the finally-guarded keyUp released it');

  keyDown('Control');
  const held = ctrlDown();
  keyUp('Control');
  const released = !ctrlDown();
  assert(held, 'keyDown(Control) holds the modifier (GetAsyncKeyState reports DOWN) — the mechanism dragStroke holds during the drag');
  assert(released, 'keyUp(Control) releases it');

  let threw = false;
  try {
    dragStroke([{ x: 300, y: 300 }]);
  } catch {
    threw = true;
  }
  assert(threw, 'dragStroke([single point]) throws — a stroke needs ≥2 waypoints');

  // An invalid modifier name must throw BEFORE any key is pressed — no half-pressed modifier escapes the finally release.
  let badThrew = false;
  try {
    dragStroke([{ x: 300, y: 300 }, { x: 350, y: 350 }], ['Control', 'NotARealKey']);
  } catch {
    badThrew = true;
  }
  assert(badThrew, 'dragStroke with an invalid modifier name throws');
  assert(!ctrlDown(), 'and leaves NO modifier stuck — names are validated before any keyDown (Control was never pressed)');
} finally {
  if (ctrlDown()) keyUp('Control'); // safety: never leave Control stuck
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  await Bun.sleep(200);
  if (pid) killProcess(pid);
  notepad.dispose();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — dragStroke traces a multi-waypoint path with a held modifier and never leaks the key.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
