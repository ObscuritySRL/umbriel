/**
 * wpf-hwndwrapper-input — proves the no-own-HWND sub-control path on a REAL WPF host (the HwndWrapper window class),
 * the one input.ts asserts only in code comments (lines ~250/313/328: "a WinUI/WPF/Chromium sub-control with no own
 * HWND"). WPF hosts its entire visual tree inside ONE top-level HWND ("HwndWrapper[...]"); its Button/TextBox/CheckBox
 * have nativeWindowHandle === 0n, so the posted-window-message functions (setControlText/postText/postKey/pasteToControl)
 * CANNOT reach them and MUST decline the 0 handle — the SendInput / UIA-ValuePattern fallback is what drives them.
 *
 * Proof: spawn a real WPF window via PowerShell (Add-Type PresentationFramework), confirm the top-level class is
 * HwndWrapper and the inner controls have NO own HWND, assert every posted-message function returns false for that
 * 0 handle (the documented fallback gate), then drive the TextBox cursor-free through the ValuePattern fallback
 * (Element.setValue) and read it back. The PowerShell process is killed + window closed in finally. SKIPS cleanly if
 * PowerShell / PresentationFramework (the .NET desktop runtime) is absent — mirroring jab-java-tree's compile-or-skip.
 *
 * bun test is broken repo-wide for FFI — runnable harness (spawns a real WPF window):
 * Run: bun run example/wpf-hwndwrapper-input.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { ControlType, attach, closeWindow, pasteToControl, postKey, postText, setControlText, skry, windowProcessId, windowTree } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const TITLE = `WPF HwndWrapper Probe ${process.pid}`;
// A self-contained WPF window: a StackPanel of a Button, a TextBox, and a CheckBox. ShowDialog blocks the PowerShell
// thread on the WPF message loop, so the window stays alive until we kill the process.
const script =
  `Add-Type -AssemblyName PresentationFramework;` +
  `$w = New-Object System.Windows.Window;` +
  `$w.Title = '${TITLE}'; $w.Width = 420; $w.Height = 200; $w.WindowStartupLocation = 'CenterScreen';` +
  `$sp = New-Object System.Windows.Controls.StackPanel;` +
  `$b = New-Object System.Windows.Controls.Button; $b.Content = 'Click Me WPF'; $b.Name = 'theButton';` +
  `$tb = New-Object System.Windows.Controls.TextBox; $tb.Text = 'initial'; $tb.Width = 200; $tb.Name = 'theBox';` +
  `$cb = New-Object System.Windows.Controls.CheckBox; $cb.Content = 'Enable Thing'; $cb.Name = 'theCheck';` +
  `$sp.AddChild($b); $sp.AddChild($tb); $sp.AddChild($cb); $w.Content = $sp; [void]$w.ShowDialog();`;

skry.initialize();
let powershellProcess: ReturnType<typeof Bun.spawn> | null = null;
let hWnd = 0n;
try {
  powershellProcess = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-Command', script], { stdout: 'ignore', stderr: 'ignore' });
  const titleBuffer = Buffer.from(`${TITLE}\0`, 'utf16le');
  for (let i = 0; i < 60 && hWnd === 0n; i++) {
    await Bun.sleep(250);
    hWnd = User32.FindWindowW(null, titleBuffer.ptr!);
  }
  if (hWnd === 0n) {
    console.log('  skip(live): WPF window did not appear (PowerShell / PresentationFramework .NET desktop runtime absent)');
  } else {
    await Bun.sleep(700); // let the WPF visual tree realize

    const className = windowTree(hWnd, 0).className;
    assert(className.startsWith('HwndWrapper'), `top-level window class is the WPF HwndWrapper host ("${className.slice(0, 40)}")`);
    assert(windowTree(hWnd, 2).children.length === 0, 'WPF hosts its whole visual tree in ONE HWND — zero native child windows');

    const window = attach(hWnd);
    const button = window.find({ name: 'Click Me WPF' });
    const box = window.find({ controlType: ControlType.Edit });
    const check = window.find({ controlType: ControlType.CheckBox });
    try {
      assert(button !== null && box !== null && check !== null, 'UIA surfaces the WPF Button, TextBox, and CheckBox');
      const boxHwnd = box?.nativeWindowHandle ?? -1n;
      assert((button?.nativeWindowHandle ?? -1n) === 0n, 'the WPF Button has NO own HWND (nativeWindowHandle === 0n)');
      assert(boxHwnd === 0n, 'the WPF TextBox has NO own HWND (nativeWindowHandle === 0n)');
      assert((check?.nativeWindowHandle ?? -1n) === 0n, 'the WPF CheckBox has NO own HWND (nativeWindowHandle === 0n)');

      // The documented fallback gate: every posted-window-message input fn declines the 0 handle (input.ts guards),
      // so the caller is steered to SendInput / a UIA pattern instead — exactly what the comments promise.
      assert(setControlText(boxHwnd, 'x') === false, 'setControlText (WM_SETTEXT) declines the no-own-HWND WPF control');
      assert(postText(boxHwnd, 'x') === false, 'postText (WM_CHAR) declines the no-own-HWND WPF control');
      assert(postKey(boxHwnd, 'End') === false, 'postKey (WM_KEYDOWN/UP) declines the no-own-HWND WPF control');
      assert(pasteToControl(boxHwnd) === false, 'pasteToControl (WM_PASTE) declines the no-own-HWND WPF control');

      // The fallback path that DOES reach a WPF sub-control: the UIA ValuePattern, cursor-free (no focus call here).
      box?.setValue('wpf-value-set-7421');
      await Bun.sleep(150);
      const readBack = box?.value ?? '';
      assert(readBack.includes('wpf-value-set-7421'), `the WPF TextBox reads back the ValuePattern value cursor-free ("${readBack.trim().slice(0, 40)}")`);
    } finally {
      button?.release();
      box?.release();
      check?.release();
      window.dispose();
    }
  }
} finally {
  const powershellPid = hWnd !== 0n ? windowProcessId(hWnd) : 0;
  if (hWnd !== 0n) closeWindow(hWnd);
  if (powershellPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(powershellPid)]);
  powershellProcess?.kill();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — WPF HwndWrapper no-own-HWND path proven: posted messages decline, ValuePattern drives.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
