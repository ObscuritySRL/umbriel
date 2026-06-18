/**
 * click-no-raise-waitstate — two element.ts guarantees, proven on a SYNTHETIC Win32 control (no app launch, the window
 * destroys itself):
 *
 *   1. Element.click() is cursor-free FIRST: it posts a WM_*BUTTON to the element's own window and returns WITHOUT
 *      raising it. The old click() called SetForegroundWindow unconditionally — a focus-steal / taskbar flash from a
 *      background Bun process. Proof: an auto-checkbox advances state from the posted click while the FOREGROUND window
 *      is unchanged (no raise), and the click target never becomes foreground.
 *   2. Element.waitForState() RETRIES a control's state to a timeout (the Playwright web-first-assertion analogue) —
 *      confirm a toggle landed instead of hand-rolling snapshot→parse→sleep→re-snapshot. Proof: a delayed BM_SETCHECK
 *      flips the checkbox on; waitForState({toggle:true}) resolves; the inverse expectation times out and throws.
 *
 * bun test is broken repo-wide — runnable harness (creates + DestroyWindow's its own synthetic window):
 * Run: bun run example/click-no-raise-waitstate.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { fromHandle, initialize, uninitialize } from 'skry';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const BS_AUTOCHECKBOX = 0x0003;
const BM_GETCHECK = 0x00f0;
const BM_SETCHECK = 0x00f1;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const msg = Buffer.alloc(48);
function pump(): void {
  for (let i = 0; i < 256; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break;
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}
const checkState = (hWnd: bigint): bigint => User32.SendMessageW(hWnd, BM_GETCHECK, 0n, 0n);

initialize();
const staticClass = Buffer.from('Static\0', 'utf16le');
const buttonClass = Buffer.from('BUTTON\0', 'utf16le');
const foregroundBefore = User32.GetForegroundWindow(); // capture BEFORE creating our window; click() must not change it
const parent = User32.CreateWindowExW(0, staticClass.ptr!, Buffer.from('NoRaiseWin\0', 'utf16le').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 220, 220, 300, 170, 0n, 0n, 0n, null);
const checkbox = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Airplane mode\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 30, 40, 240, 32, parent, 0n, 0n, null);
try {
  await Bun.sleep(150);
  pump();

  // (1) click() — cursor-free, no foreground raise
  const element = fromHandle(checkbox);
  assert(element.nativeWindowHandle !== 0n, 'the checkbox has its own native window (the cursor-free posted-click target)');
  assert(checkState(checkbox) === 0n, 'baseline: checkbox is unchecked');
  element.click();
  pump();
  assert(checkState(checkbox) === 1n, 'click() advanced the checkbox via the cursor-free posted path (no SendInput cursor move needed)');
  assert(User32.GetForegroundWindow() === foregroundBefore, 'click() did NOT change the foreground window — no raise/flash (the old unconditional SetForegroundWindow would have)');
  assert(User32.GetForegroundWindow() !== parent, 'the clicked control never became foreground (cursor-free, background-safe)');

  // (2) waitForState — retries a control's state to a timeout
  const parentElement = fromHandle(parent);
  User32.SendMessageW(checkbox, BM_SETCHECK, 0n, 0n); // reset to unchecked
  pump();
  setTimeout(() => User32.SendMessageW(checkbox, BM_SETCHECK, 1n, 0n), 500); // flip ON after the first couple of polls
  const start = Bun.nanoseconds();
  const settled = await parentElement.waitForState({ name: 'Airplane mode' }, { toggle: true, timeout: 3000, interval: 100 });
  const elapsed = Math.round((Bun.nanoseconds() - start) / 1e6);
  assert(settled.toggleState === 1 && elapsed >= 300, `waitForState({toggle:true}) RETRIED until the delayed flip landed (resolved at ${elapsed} ms, state ${settled.toggleState})`);
  settled.release();

  let threw = false;
  try {
    await parentElement.waitForState({ name: 'Airplane mode' }, { toggle: false, timeout: 700, interval: 100 });
  } catch {
    threw = true;
  }
  assert(threw, 'waitForState throws on timeout when the state never reaches the expectation (toggle:false while it stays ON)');
  parentElement.release();
  element.release();
} finally {
  User32.DestroyWindow(checkbox);
  User32.DestroyWindow(parent);
  uninitialize();
}

console.log(failures === 0 ? '\nPASS — click() is cursor-free with no foreground raise; waitForState retries control state to a timeout.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
