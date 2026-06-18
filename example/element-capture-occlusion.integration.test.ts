/**
 * element-capture-occlusion — PROVE the FlaUI Capture.Element / Playwright locator.screenshot parity fix: an Element
 * can capture and OCR JUST its OWN pixels, OCCLUSION-CORRECT, with NO foreground and NO real cursor — the gap that
 * previously forced an agent to bounds-math + captureScreen(region) and get whatever window was TOPMOST at those
 * pixels (the criticism: OCR'ing a Notepad edit's screen bounds returned a Character Map overlapping it).
 *
 * The proof, on a real spawned Notepad with a unique marker typed into its edit cursor-free:
 *  1. el.ocr() reads the marker while Notepad is VISIBLE (the element-scoped path works end-to-end);
 *  2. fully OCCLUDE Notepad behind a maximized Explorer WITHOUT foregrounding it (z-order push, not activation);
 *  3. el.ocr() STILL reads the marker — because Element.capture() sources the element's OWN window (WGC → PrintWindow)
 *     and crops to its window-local bounds, so the occluder's pixels CANNOT leak in;
 *  4. CONTRAST — the OLD workaround captureScreen(elementScreenBounds) → ocrBitmap reads the OCCLUDER, not the marker:
 *     the exact occlusion-incorrectness the fix removes (asserted only when the occlusion setup actually took).
 *
 * Teardown (finally): Notepad and the Explorer occluder are closed by WM_CLOSE only (never taskkill /IM, never a PID
 * force-kill that could nuke the user's shared Notepad/shell process — findings/31); the edit is left empty so
 * WM_CLOSE raises no Save? dialog. bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/element-capture-occlusion.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { captureScreen, closeWindow, ControlType, foregroundWindow, isMinimized, maximizeWindow, ocrBitmap, setControlText, skry, wgcAvailable } from 'skry';

const HWND_BOTTOM = 0x1n;
const HWND_TOP = 0x0n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

const MARKER = 'ELEMENTSCOPEDOCR';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function spawnOccluder(target: bigint): bigint {
  const prior = new Set(
    skry
      .windows()
      .filter((window) => window.className === 'CabinetWClass')
      .map((window) => window.hWnd),
  );
  Bun.spawn(['explorer.exe', 'shell:MyComputerFolder'], { stdout: 'ignore', stderr: 'ignore' });
  let hWnd = 0n;
  for (let attempt = 0; attempt < 30 && hWnd === 0n; attempt += 1) {
    Bun.sleepSync(300);
    hWnd = skry.windows().find((window) => window.className === 'CabinetWClass' && !prior.has(window.hWnd))?.hWnd ?? 0n;
  }
  if (hWnd !== 0n) {
    if (target !== 0n) User32.SetWindowPos(target, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    User32.SetWindowPos(hWnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    maximizeWindow(hWnd);
    Bun.sleepSync(1800);
  }
  return hWnd;
}

skry.initialize();
if (!wgcAvailable()) {
  console.log('SKIP — Windows.Graphics.Capture unavailable (locked / headless / secure desktop); element capture not provable here.');
  skry.uninitialize();
  process.exit(0);
}

const priorNotepads = new Set(
  skry
    .windows()
    .filter((window) => window.className === 'Notepad')
    .map((window) => window.hWnd),
);
Bun.spawn(['notepad.exe'], { stdout: 'ignore', stderr: 'ignore' });
let notepadHwnd = 0n;
for (let attempt = 0; attempt < 40 && notepadHwnd === 0n; attempt += 1) {
  Bun.sleepSync(300);
  notepadHwnd = skry.windows().find((window) => window.className === 'Notepad' && !priorNotepads.has(window.hWnd))?.hWnd ?? 0n;
}

let occluderHwnd = 0n;
const window = notepadHwnd === 0n ? null : skry.attach(notepadHwnd);
try {
  if (window === null) {
    console.log('SKIP — Notepad did not appear (app model wedged/unavailable); element capture not provable this run.');
  } else {
    const editor = window.find({ controlType: ControlType.Edit }) ?? window.find({ controlType: ControlType.Document });
    assert(editor !== null, 'found Notepad text control (Edit/Document)');
    if (editor !== null) {
      const editHwnd = editor.nativeWindowHandle !== 0n ? editor.nativeWindowHandle : notepadHwnd;
      setControlText(editHwnd, MARKER); // cursor-free WM_SETTEXT — no focus, no keystrokes
      Bun.sleepSync(700); // let Notepad re-render the marker and DWM compose it

      // 1. VISIBLE — el.ocr() reads the marker from the element's own pixels.
      const visible = await editor.ocr();
      assert(visible !== null, 'editor.ocr() returned a result while Notepad is VISIBLE');
      const visibleText = (visible?.text ?? '').replace(/\s/g, '').toUpperCase();
      assert(visibleText.includes(MARKER), `editor.ocr() read the marker ${JSON.stringify(MARKER)} (got ${JSON.stringify(visible?.text ?? '')})`);

      // 2. OCCLUDE — raise a maximized Explorer over Notepad, sink Notepad, do NOT foreground it.
      occluderHwnd = spawnOccluder(notepadHwnd);
      assert(occluderHwnd !== 0n, 'opened an Explorer window to occlude Notepad with');
      if (occluderHwnd === 0n || foregroundWindow() === notepadHwnd || isMinimized(notepadHwnd)) {
        console.log('SKIP — could not put Notepad genuinely behind the occluder this run (OS foreground lock); element capture already proven on the visible baseline.');
      } else {
        // 3. THE HEADLINE — el.ocr() STILL reads Notepad's marker though it is fully occluded (own-window capture + crop).
        const occluded = await editor.ocr();
        const occludedText = (occluded?.text ?? '').replace(/\s/g, '').toUpperCase();
        assert(occludedText.includes(MARKER), `editor.ocr() STILL read ${JSON.stringify(MARKER)} while Notepad is FULLY OCCLUDED — occlusion-correct (got ${JSON.stringify(occluded?.text ?? '')})`);

        // 4. CONTRAST — the OLD workaround (captureScreen of the element's SCREEN bounds → OCR) reads the OCCLUDER, not the marker.
        const bounds = editor.boundingRectangle;
        const regionShot = captureScreen({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        const regionOcr = await ocrBitmap(regionShot);
        const regionText = regionOcr.text.replace(/\s/g, '').toUpperCase();
        assert(!regionText.includes(MARKER), `the OLD captureScreen(region) workaround did NOT read the marker (it grabbed the occluder's pixels) — got ${JSON.stringify(regionOcr.text.slice(0, 80))}`);
      }
      setControlText(editHwnd, ''); // clear the buffer so WM_CLOSE raises no Save? dialog
    }
  }
} finally {
  if (occluderHwnd !== 0n) closeWindow(occluderHwnd);
  if (window !== null) {
    if (notepadHwnd !== 0n) closeWindow(notepadHwnd);
    window.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — Element.capture/ocr read JUST the control, occlusion-correct (FlaUI Capture.Element / Playwright locator.screenshot parity).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
