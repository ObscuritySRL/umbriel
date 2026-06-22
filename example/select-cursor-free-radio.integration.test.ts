/**
 * select-cursor-free-radio — the selectSmart parity fix: a classic Win32 radio (own HWND, class "Button",
 * controlType RadioButton) is REPLACE-selected via PostMessageW(BM_CLICK) — truly cursor-free, no foreground steal,
 * works on a minimized/background window — instead of UIA SelectionItem.Select, which routes through the provider
 * bridge's SetFocus and STEALS FOREGROUND to the control's own HWND (proven by select-no-raise.integration.test.ts).
 * This is the invoke/toggle BM_CLICK doctrine (invokeSmart/toggleSmart) finally applied to the select verb.
 *
 * Proof (live): a synthetic BS_AUTORADIOBUTTON in a MINIMIZED popup. The selectSmart classic-radio path
 * (postButtonClick on the radio's own HWND) lands the selection (BM_GETCHECK==1) AND leaves the foreground UNCHANGED
 * (before === after) — the parent stays minimized — vs select-no-raise where the UIA path moved foreground to the
 * radio's own HWND. Source-parse confirms selectSmart gates on RadioButton + a classic "Button" and that the three
 * replace-mode select sites route through it. The window is DestroyWindow'd in finally (dispose≠close — no leak).
 *
 * bun test is broken repo-wide for FFI; runnable harness (creates + destroys its own synthetic radio):
 * Run: bun run example/select-cursor-free-radio.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { ControlType, foregroundWindow, fromHandle, isMinimized, minimizeWindow, postButtonClick, umbriel } from 'umbriel';

const WS_POPUP = 0x8000_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_GROUP = 0x0002_0000;
const WS_TABSTOP = 0x0001_0000;
const WS_CAPTION = 0x00c0_0000;
const BS_AUTORADIOBUTTON = 0x0009;
const BM_GETCHECK = 0x00f0;
const SW_RESTORE = 9;

const msg = Buffer.alloc(48);
function pump(): void {
  for (let i = 0; i < 256; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break;
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}
const checked = (hWnd: bigint): bigint => User32.SendMessageW(hWnd, BM_GETCHECK, 0n, 0n);

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const staticClass = Buffer.from('Static\0', 'utf16le');
const buttonClass = Buffer.from('BUTTON\0', 'utf16le');
const parent = User32.CreateWindowExW(0, staticClass.ptr!, Buffer.from('SelectCursorFreeParent\0', 'utf16le').ptr!, WS_POPUP | WS_CAPTION | WS_VISIBLE, 200, 200, 280, 140, 0n, 0n, 0n, null);
const radioA = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Option A\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | BS_AUTORADIOBUTTON, 15, 20, 220, 28, parent, 0n, 0n, null);
const radioB = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Option B\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON, 15, 56, 220, 28, parent, 0n, 0n, null);

try {
  await Bun.sleep(120);
  pump();
  const radio = fromHandle(radioB);
  try {
    // The exact gate selectSmart checks: a RadioButton + own HWND + class "Button".
    assert(radio.controlType === ControlType.RadioButton, `synthetic control is a RadioButton (${radio.controlTypeName})`);
    assert(radio.nativeWindowHandle === radioB && radio.className === 'Button', `it is a classic own-HWND "Button" (className=${JSON.stringify(radio.className)}) — the selectSmart gate`);
    assert(checked(radioB) === 0n, 'radio starts unchecked');

    minimizeWindow(parent);
    await Bun.sleep(300);
    pump();
    assert(isMinimized(parent), 'parent popup is minimized before the select');
    const before = foregroundWindow();
    assert(before !== parent && before !== radioB, `neither the parent nor the radio is foreground before the select (fg=0x${before.toString(16)})`);

    // The selectSmart classic-radio path: PostMessageW(BM_CLICK) — what the select verb now posts instead of UIA Select.
    postButtonClick(radio.nativeWindowHandle);
    await Bun.sleep(200);
    pump();
    const after = foregroundWindow();

    assert(checked(radioB) === 1n, 'the BM_CLICK select LANDED — radio is now checked (BM_GETCHECK==1)');
    assert(after === before, `truly cursor-free: the foreground did NOT move (before=0x${before.toString(16)} === after=0x${after.toString(16)}) — vs select-no-raise where UIA Select moved it to the radio own HWND`);
    assert(isMinimized(parent), 'the parent stayed minimized (no raise/restore)');
  } finally {
    radio.release();
  }
} finally {
  User32.ShowWindow(parent, SW_RESTORE);
  User32.DestroyWindow(radioA);
  User32.DestroyWindow(radioB);
  User32.DestroyWindow(parent);
  umbriel.uninitialize();
}

// Source-parse: selectSmart gates on a classic radio and the three replace-mode select sites route through it.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();
assert(/function selectSmart\([^)]*\)[\s\S]{0,200}element\.controlType === ControlType\.RadioButton && isClassicButton\(element\)[\s\S]{0,80}postButtonClick/.test(mcp), 'selectSmart gates BM_CLICK on RadioButton && isClassicButton');
assert((mcp.match(/selectSmart\(element, /g) ?? []).length === 3, 'all three replace-mode select sites (act / clickElement fallback / select handler) route through selectSmart');

console.log(failures === 0 ? '\nPASS — a classic radio is replace-selected cursor-free via BM_CLICK (no foreground steal), the invoke/toggle doctrine applied to select.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
