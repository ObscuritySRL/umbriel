/**
 * pattern-no-raise — the foreground-stability REGRESSION GUARD for the UIA control-pattern act paths
 * (`setValue` / `toggle` / `invoke`). cursor-free-input proves only the POSTED paths (WM_SETTEXT/WM_CHAR/WM_KEY/
 * WM_PASTE) leave the foreground untouched; the pattern-vcall paths had NO such guard, and a click() on an own-HWND
 * WinUI control happens to take the posted-click branch — so the focus-stealing pattern-vcall path went un-asserted.
 *
 * Reality this LOCKS (probed live): on a classic Win32 control that owns its own HWND (charmap's RICHEDIT50W edit,
 * the "Advanced view" checkbox, the "Select" button), a UIA pattern act (ValuePattern.SetValue, TogglePattern.Toggle,
 * InvokePattern.Invoke) goes through the OS UIA→provider bridge, which ACTIVATES the control's own window — so the
 * foreground moves to that CONTROL's HWND. That OS-bridge activation is unavoidable for these patterns on classic
 * Win32 (UIPI/OS wall), so — per the PARITY LAW — this test asserts the HONEST documented outcome rather than a fake
 * "no-raise" success (mirroring click-minimized-honest): the foreground may move to the acted CONTROL's own HWND, but
 * it MUST NOT raise charmap's TOP-LEVEL window, and the app window MUST stay minimized. If a future fix ever routes
 * own-HWND pattern acts through the posted path, the foreground would stay fully unchanged — this test accepts that
 * stronger outcome too (it only fails if the parent app window is raised or charmap is un-minimized).
 *
 * bun test is broken repo-wide for FFI; runnable harness (spawns + taskkills its own charmap):
 * Run: bun run example/pattern-no-raise.integration.test.ts
 */
import { ControlType, closeWindow, foregroundWindow, isMinimized, minimizeWindow, skry, windowProcessId } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const window = await skry.launch(['charmap.exe'], { title: 'Character Map' });
const edit = window.find({ controlType: ControlType.Edit });
const checkbox = window.find({ name: 'Advanced view' });
const button = window.find({ name: 'Select' });
try {
  assert(edit !== null && edit.nativeWindowHandle !== 0n, `charmap edit is a classic own-HWND control (the pattern-vcall target): hwnd=0x${(edit?.nativeWindowHandle ?? 0n).toString(16)}`);
  assert(checkbox !== null && checkbox.nativeWindowHandle !== 0n, `charmap "Advanced view" checkbox owns its HWND: hwnd=0x${(checkbox?.nativeWindowHandle ?? 0n).toString(16)}`);
  assert(button !== null && button.nativeWindowHandle !== 0n, `charmap "Select" button owns its HWND: hwnd=0x${(button?.nativeWindowHandle ?? 0n).toString(16)}`);

  minimizeWindow(window.hWnd);
  await Bun.sleep(300);
  assert(isMinimized(window.hWnd), 'charmap is minimized before any pattern act');
  assert(foregroundWindow() !== window.hWnd, 'charmap is provably NOT the foreground window before any pattern act');

  // The honest guard for one pattern act: the foreground may land on the acted CONTROL's own HWND (the OS UIA→provider
  // bridge activating it — the documented wall), OR stay fully unchanged (if ever routed through the posted path). It
  // must NEVER raise charmap's top-level window, and charmap must stay minimized.
  const guard = (label: string, before: bigint, controlHwnd: bigint, act: () => void): void => {
    act();
    Bun.sleepSync(150);
    const after = foregroundWindow();
    const honest = after === before || after === controlHwnd; // unchanged (posted-path) OR moved to the control's own HWND (OS bridge) — both are truthful, neither raises the parent
    assert(honest, `${label}: foreground is either unchanged or moved only to the acted control's own HWND (OS bridge), not somewhere unexpected (after=0x${after.toString(16)})`);
    assert(after !== window.hWnd, `${label}: did NOT raise charmap's TOP-LEVEL window (the parity claim: the app window is never foregrounded)`);
    assert(isMinimized(window.hWnd), `${label}: charmap stays minimized — the act did not restore the app window`);
  };

  if (edit) guard('setValue', foregroundWindow(), edit.nativeWindowHandle, () => edit.setValue('pattern-no-raise-7421'));
  if (checkbox) guard('toggle', foregroundWindow(), checkbox.nativeWindowHandle, () => checkbox.toggle());
  if (button)
    guard('invoke', foregroundWindow(), button.nativeWindowHandle, () => {
      try {
        button.invoke();
      } catch {} // a no-Invoke control would throw; the foreground assertions below still hold regardless
    });
} finally {
  const charmapPid = window.hWnd !== 0n ? windowProcessId(window.hWnd) : 0;
  if (charmapPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(charmapPid)]);
  edit?.release();
  checkbox?.release();
  button?.release();
  window.dispose();
  closeWindow(window.hWnd);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — UIA pattern acts (setValue/toggle/invoke) never raise the app window; foreground stability is now guarded (OS-bridge control activation documented).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
