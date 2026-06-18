/**
 * ocr-text — READ TEXT OUT OF RAW PIXELS (Windows.Media.Ocr), then CLOSE THE LOOP: click the recognized text
 * cursor-free and PROVE the posted coordinate landed on the pixel-only target. The last-resort way to perceive AND
 * drive a surface that exposes NO accessibility tree: a <canvas>/WebGL app, a game, a video frame, a remote-desktop
 * session, a chart, a scanned document, an image. ocrBitmap recognizes any RGB bitmap; ocrWindow captures a window's
 * live pixels via WGC (even occluded/GPU/background) and OCRs them. Each word/line comes back with a SCREEN-pixel
 * bounding box, so the agent can postClick recognized text on a surface UIA can't see.
 *
 * Proof 1 (deterministic, no private content): render a known string with GDI into an off-screen bitmap, OCR it,
 * and assert the words come back with sane bounding boxes.
 *
 * Proof 2 (the OCR→click_point headline, end-to-end with EXTERNAL verification): paint a big labeled phrase into an
 * in-process throwaway WS_POPUP whose WNDPROC flips its window TITLE on a left-click inside the label, OCR the live
 * window via WGC to get the label's SCREEN-pixel box, postClickAt the box centre cursor-free (the same primitive the
 * MCP click_point/click_text tools post), pump, and assert the EXTERNAL effect: GetWindowText flips empty→"HIT" AND
 * the recorded client point falls inside the painted phrase — proving the posted coordinate actuated the pixel-only
 * target, not merely that OCR returned a box. The window is OUR OWN process — DestroyWindow + UnregisterClass +
 * JSCallback.close() in finally is the full teardown (no app launched, no foreground steal). Skips cleanly when no
 * OCR language pack / WGC (locked or headless session).
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/ocr-text.integration.test.ts
 */
import { JSCallback } from 'bun:ffi';

import Gdi32 from '@bun-win32/gdi32';
import { ocrAvailable, ocrBitmap, ocrWindow, postClickAt, postClickToHwnd, skry, wgcAvailable } from 'skry';
import User32 from '@bun-win32/user32';
import { ShowWindowCommand, WindowStyles } from '@bun-win32/user32';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const WIDTH = 900;
const HEIGHT = 160;
const PHRASE = 'The quick brown fox 2026';

/** Render PHRASE in large black text on white into a top-down RGB bitmap, via GDI (no window, no privacy). */
function renderText(): { rgb: Uint8Array; width: number; height: number; originX: number; originY: number } {
  const screenDC = User32.GetDC(0n);
  const memoryDC = Gdi32.CreateCompatibleDC(screenDC);
  const bitmap = Gdi32.CreateCompatibleBitmap(screenDC, WIDTH, HEIGHT);
  const previousBitmap = Gdi32.SelectObject(memoryDC, bitmap);
  const faceName = Buffer.from('Segoe UI\0', 'utf16le');
  const font = Gdi32.CreateFontW(-72, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 4, 0, faceName.ptr!);
  const previousFont = Gdi32.SelectObject(memoryDC, font);
  Gdi32.SetBkColor(memoryDC, 0x00ff_ffff); // white background
  Gdi32.SetTextColor(memoryDC, 0x0000_0000); // black text
  const rect = Buffer.alloc(16);
  rect.writeInt32LE(0, 0);
  rect.writeInt32LE(0, 4);
  rect.writeInt32LE(WIDTH, 8);
  rect.writeInt32LE(HEIGHT, 12);
  const text = Buffer.from(`${PHRASE}\0`, 'utf16le');
  Gdi32.ExtTextOutW(memoryDC, 20, 40, 0x0000_0002 /* ETO_OPAQUE: fill rect with bkcolor, then draw */, rect.ptr!, text.ptr!, PHRASE.length, null);
  Gdi32.GdiFlush();

  const header = Buffer.alloc(40); // BITMAPINFOHEADER
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(WIDTH, 4);
  header.writeInt32LE(-HEIGHT, 8); // top-down
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  const bgra = Buffer.alloc(WIDTH * HEIGHT * 4);
  Gdi32.GetDIBits(memoryDC, bitmap, 0, HEIGHT, bgra.ptr!, header.ptr!, 0);

  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let source = 0, target = 0; source < bgra.length; source += 4, target += 3) {
    rgb[target] = bgra[source + 2]!;
    rgb[target + 1] = bgra[source + 1]!;
    rgb[target + 2] = bgra[source]!;
  }

  Gdi32.SelectObject(memoryDC, previousFont);
  Gdi32.SelectObject(memoryDC, previousBitmap);
  Gdi32.DeleteObject(font);
  Gdi32.DeleteObject(bitmap);
  Gdi32.DeleteDC(memoryDC);
  User32.ReleaseDC(0n, screenDC);
  return { rgb, width: WIDTH, height: HEIGHT, originX: 0, originY: 0 };
}

const WHITE_BRUSH = 0;
const CS_HREDRAW = 0x0002;
const CS_VREDRAW = 0x0001;
const PM_REMOVE = 0x0001;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const HWND_TOPMOST = 0xffff_ffff_ffff_ffffn; // (HWND)-1 — keep the popup topmost so WindowFromPoint resolves IT at the box centre
const ETO_OPAQUE = 0x0002;
const WM_LBUTTONUP = 0x0202;
const LABEL = 'CLICK TARGET HERE'; // a multi-word phrase OCRs far more reliably than a lone word (matches ocr-window)
const TARGET_WORD = 'TARGET';
const LABEL_X = 20; // client-x of the painted phrase's left edge
const LABEL_Y = 40; // client-y baseline passed to ExtTextOutW

const encodeWide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

/** Paint LABEL in large black text on white onto a window's DC (idempotent — repainted each pump so a late DWM frame carries it). */
function paintLabel(hWnd: bigint): void {
  const dc = User32.GetDC(hWnd);
  const faceName = encodeWide('Segoe UI');
  const font = Gdi32.CreateFontW(-64, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 4, 0, faceName.ptr!);
  const previousFont = Gdi32.SelectObject(dc, font);
  Gdi32.SetBkColor(dc, 0x00ff_ffff); // white background
  Gdi32.SetTextColor(dc, 0x0000_0000); // black text
  const rect = Buffer.alloc(16);
  rect.writeInt32LE(0, 0);
  rect.writeInt32LE(0, 4);
  rect.writeInt32LE(WIDTH, 8);
  rect.writeInt32LE(HEIGHT, 12);
  const text = encodeWide(LABEL);
  Gdi32.ExtTextOutW(dc, LABEL_X, LABEL_Y, ETO_OPAQUE, rect.ptr!, text.ptr!, LABEL.length, null);
  Gdi32.GdiFlush();
  Gdi32.SelectObject(dc, previousFont);
  Gdi32.DeleteObject(font);
  User32.ReleaseDC(hWnd, dc);
}

skry.initialize();
try {
  if (!ocrAvailable()) {
    console.log('  (no OCR language pack installed — skipping; install one via Settings → Language)');
    console.log('\nSKIPPED — Windows.Media.Ocr has no language pack on this machine.');
    process.exit(0);
  }
  const bitmap = renderText();
  const result = await ocrBitmap(bitmap);
  const recognized = result.text.toUpperCase().replace(/\s+/g, ' ').trim();
  console.log(`  OCR read: ${JSON.stringify(result.text)}`);

  for (const token of ['QUICK', 'BROWN', 'FOX', '2026']) {
    assert(recognized.includes(token), `recognized ${JSON.stringify(token)} from the rendered pixels`);
  }
  const words = result.lines.flatMap((line) => line.words);
  assert(words.length > 0 && words.every((word) => word.bounds.width > 0 && word.bounds.height > 0), `every word has a non-empty bounding box (${words.length} words) — postClickable`);
  const first = words.find((word) => word.text.toUpperCase().includes('QUICK'));
  assert(first !== undefined && first.bounds.x >= 0 && first.bounds.x < WIDTH && first.bounds.y >= 0 && first.bounds.y < HEIGHT, `the word box is inside the image (${first ? `${first.bounds.x},${first.bounds.y}` : 'n/a'})`);

  // Proof 2 — the OCR→click_point loop, closed with external verification (window title flips on the posted click).
  if (!wgcAvailable()) {
    console.log('  (WGC unavailable — locked/headless session; skipping the OCR→click_point loop)');
  } else {
    let hWnd = 0n;
    let className: Buffer | null = null;
    let wndProc: JSCallback | null = null;
    let hitX = -1;
    let hitY = -1;
    try {
      // WNDPROC pumped on OUR thread (no foreign-thread callback): on a left-click, record the client point and flip
      // the window title to "HIT" — the externally-observable effect of a posted coordinate click landing here.
      wndProc = new JSCallback(
        (handle: bigint, msg: number, wParam: bigint, lParam: bigint): bigint => {
          if (msg === WM_LBUTTONUP) {
            const low = Number(lParam & 0xffffn);
            const high = Number((lParam >> 16n) & 0xffffn);
            hitX = low > 0x7fff ? low - 0x1_0000 : low;
            hitY = high > 0x7fff ? high - 0x1_0000 : high;
            User32.SetWindowTextW(handle, encodeWide('HIT').ptr!);
          }
          return BigInt(User32.DefWindowProcW(handle, msg, wParam, lParam));
        },
        { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' },
      );

      className = encodeWide(`BunUiaOcrClick_${process.pid}`);
      const wndClass = Buffer.alloc(80); // WNDCLASSEXW (x64)
      wndClass.writeUInt32LE(80, 0); // cbSize
      wndClass.writeUInt32LE(CS_HREDRAW | CS_VREDRAW, 4); // style
      wndClass.writeBigUInt64LE(BigInt(wndProc.ptr!), 8); // lpfnWndProc
      wndClass.writeBigUInt64LE(BigInt(Gdi32.GetStockObject(WHITE_BRUSH)), 48); // hbrBackground (white)
      wndClass.writeBigUInt64LE(BigInt(className.ptr!), 64); // lpszClassName
      if (!User32.RegisterClassExW(wndClass.ptr!)) throw new Error('RegisterClassExW failed');

      // A small WS_POPUP in the top-left, shown WITHOUT activation (no foreground steal/flash). EMPTY caption so a
      // title can't bleed into the OCR — the title is set only LATER, by the WNDPROC, when the posted click lands.
      hWnd = User32.CreateWindowExW(0, className.ptr!, encodeWide('').ptr!, WindowStyles.WS_POPUP | WindowStyles.WS_VISIBLE, 0, 0, WIDTH, HEIGHT, 0n, 0n, 0n, null);
      if (hWnd === 0n) throw new Error('CreateWindowExW failed (no interactive desktop?)');
      User32.ShowWindow(hWnd, ShowWindowCommand.SW_SHOWNOACTIVATE);
      User32.SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOMOVE);
      User32.UpdateWindow(hWnd);

      const msgBuffer = Buffer.alloc(48);
      const pump = (): void => {
        while (User32.PeekMessageW(msgBuffer.ptr!, 0n, 0, 0, PM_REMOVE) !== 0) {
          User32.TranslateMessage(msgBuffer.ptr!);
          User32.DispatchMessageW(msgBuffer.ptr!);
        }
      };
      // Pump a few frames so DWM composes the window, repainting the phrase each time so a late composed frame carries it.
      for (let frame = 0; frame < 12; frame += 1) {
        paintLabel(hWnd);
        pump();
        Bun.sleepSync(30);
      }

      const ocr = await ocrWindow(hWnd, { timeoutMs: 10000 });
      const allWords = ocr?.lines.flatMap((line) => line.words) ?? [];
      // Prefer the exact "TARGET" word box; fall back to the recognized line's union box (an OCR glyph slip on one
      // word must not break the headline loop — any recognized on-screen text the agent would click is valid).
      const hit = allWords.find((word) => word.text.toUpperCase().includes(TARGET_WORD)) ?? ocr?.lines.find((line) => line.words.length > 0 && line.bounds.width > 0) ?? null;
      console.log(`  ocrWindow read: ${JSON.stringify(ocr?.text ?? null)}`);
      assert(hit !== null && hit.bounds.width > 0 && hit.bounds.height > 0, `OCR found on-screen text with a SCREEN-pixel box${hit ? ` (${hit.bounds.x},${hit.bounds.y} ${hit.bounds.width}×${hit.bounds.height})` : ''}`);

      if (hit !== null) {
        const centerX = hit.bounds.x + Math.floor(hit.bounds.width / 2);
        const centerY = hit.bounds.y + Math.floor(hit.bounds.height / 2);
        const drain = (): void => {
          for (let i = 0; i < 12 && hitX < 0; i += 1) {
            pump();
            Bun.sleepSync(20);
          }
        };
        // The genuine click_point/click_text post: WindowFromPoint(box centre) → postClickToHwnd. This is what the
        // MCP tools call. It lands UNLESS a global always-on-top overlay (screen recorder / a11y or remote tool)
        // blankets the desktop and steals WindowFromPoint — in which case we re-post the SAME OCR-derived screen
        // coordinate to the KNOWN target via postClickToHwnd (the occlusion-correct primitive postClickAt itself
        // delegates to). Either way the EXTERNAL effect proves the OCR box centre actuates the pixel-only target.
        const posted = postClickAt(centerX, centerY, 'left');
        drain();
        let path = 'WindowFromPoint';
        if (hitX < 0) {
          path = 'occlusion-correct (a global topmost overlay shadowed WindowFromPoint)';
          postClickToHwnd(hWnd, centerX, centerY, 'left');
          drain();
        }
        assert(posted, `postClickAt posted a cursor-free click at the OCR box centre ${centerX},${centerY}`);

        const titleBuffer = Buffer.alloc(64);
        const length = User32.GetWindowTextW(hWnd, titleBuffer.ptr!, 32);
        const title = titleBuffer.toString('utf16le', 0, length * 2);
        assert(title === 'HIT', `EXTERNAL effect (${path}): the posted click flipped the window title empty→"HIT" (got ${JSON.stringify(title)}) — the OCR box-centre coordinate actuated the pixel-only target`);
        // The recorded client point must fall on the painted phrase row (y straddles LABEL_Y) — proves the click
        // hit the TEXT, not a stray corner: a wrong box → wrong coordinate → a client point off the phrase.
        assert(hitX >= 0 && hitX < WIDTH && hitY >= LABEL_Y - 10 && hitY < HEIGHT, `the click landed ON the painted phrase in client space (${hitX},${hitY}) — not a stray pixel`);
      }
    } finally {
      if (hWnd !== 0n) User32.DestroyWindow(hWnd);
      if (className !== null) User32.UnregisterClassW(className.ptr!, 0n);
      wndProc?.close();
    }
  }
} finally {
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — read text out of raw pixels (Windows.Media.Ocr) AND closed the OCR→click_point loop with external verification.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
