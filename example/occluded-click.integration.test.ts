/**
 * occluded-click — a cursor-free posted click must land on the TARGET control even when another window overlaps
 * the pixel ("drive in the dark").
 *
 * postClickAt resolves its target with WindowFromPoint = the TOPMOST window at the pixel, so for an occluded /
 * background target the posted click silently hit the OCCLUDING window — the exact scenario the doctrine promises.
 * The fix: clickElement (and computer-use) post to the element's OWN owner window (ownerHwnd → postClickToHwnd),
 * never WindowFromPoint.
 *
 * Proof (synthetic, deterministic): an auto-checkbox in window A, fully covered by window B.
 *   - WindowFromPoint(checkbox centre) === B  (so the old postClickAt path targets B);
 *   - ownerHwnd(attach(checkbox)) === the checkbox  (so the fix targets the real control);
 *   - postClickToHwnd(checkbox, …) TOGGLES the occluded checkbox; postClickAt(…) (→ B) leaves it untouched.
 * Messages are pumped in-process (the synthetic window's proc runs on this thread).
 *
 * bun test is broken repo-wide — runnable harness (destroys its own synthetic windows):
 * Run: bun run example/occluded-click.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { attach, ownerHwnd, postClickAt, postClickToHwnd, skry } from 'skry';

const WS_POPUP = 0x8000_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const BS_AUTOCHECKBOX = 0x0003;
const BM_GETCHECK = 0x00f0;
const BM_SETCHECK = 0x00f1;
const SWP_NOMOVE_NOSIZE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const msg = Buffer.alloc(48); // MSG (x64)
function pump(): void {
  for (let i = 0; i < 256; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break; // PM_REMOVE
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}
const packPoint = (x: number, y: number): bigint => (BigInt(y >>> 0) << 32n) | BigInt(x >>> 0);
const isChecked = (hWnd: bigint): boolean => User32.SendMessageW(hWnd, BM_GETCHECK, 0n, 0n) === 1n;

skry.initialize();
const staticClass = Buffer.from('Static\0', 'utf16le');
const buttonClass = Buffer.from('BUTTON\0', 'utf16le');
const WS_EX_TOPMOST = 0x0000_0008; // keep the synthetic windows above other desktop windows so B reliably occludes
const windowA = User32.CreateWindowExW(WS_EX_TOPMOST, staticClass.ptr!, null, WS_POPUP | WS_VISIBLE, 120, 120, 240, 90, 0n, 0n, 0n, null);
const checkbox = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Toggle\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 15, 25, 200, 32, windowA, 0n, 0n, null);
const windowB = User32.CreateWindowExW(WS_EX_TOPMOST, staticClass.ptr!, null, WS_POPUP | WS_VISIBLE, 120, 120, 240, 90, 0n, 0n, 0n, null);
try {
  User32.SetWindowPos(windowB, 0n, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE_NOACTIVATE); // raise B above A (HWND_TOP)
  pump();
  await Bun.sleep(100);

  const rect = Buffer.alloc(16);
  User32.GetWindowRect(checkbox, rect.ptr!);
  const cx = Math.floor((rect.readInt32LE(0) + rect.readInt32LE(8)) / 2);
  const cy = Math.floor((rect.readInt32LE(4) + rect.readInt32LE(12)) / 2);

  assert(User32.WindowFromPoint(packPoint(cx, cy)) !== checkbox, 'the checkbox pixel is occluded — WindowFromPoint returns another window, not the checkbox (so a topmost-targeting click misses it)');

  const el = attach(checkbox);
  assert(ownerHwnd(el) === checkbox, 'ownerHwnd(element) resolves the checkbox’s own window (the fix’s target), not the occluder');
  el.release();

  // The fix: posting to the element's own window toggles the OCCLUDED checkbox.
  User32.SendMessageW(checkbox, BM_SETCHECK, 0n, 0n);
  pump();
  postClickToHwnd(checkbox, cx, cy, 'left');
  pump();
  assert(isChecked(checkbox), 'postClickToHwnd(ownerHwnd) toggled the OCCLUDED checkbox (reached the target despite window B on top)');

  // The old path: WindowFromPoint sends the click to B, so the checkbox is untouched.
  User32.SendMessageW(checkbox, BM_SETCHECK, 0n, 0n);
  pump();
  postClickAt(cx, cy, 'left');
  pump();
  assert(!isChecked(checkbox), 'postClickAt (WindowFromPoint → B) leaves the occluded checkbox untouched (demonstrates the bug the fix avoids)');
} finally {
  User32.DestroyWindow(checkbox);
  User32.DestroyWindow(windowA);
  User32.DestroyWindow(windowB);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a cursor-free posted click reaches the occluded target via its own window, not the occluder.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
