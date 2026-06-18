/**
 * click-text-cursorfree — click_text is the MCP-documented PRIMARY drive path for the no-a11y-tree stack class
 * (Tk/Tkinter, Flutter, games, <canvas>/WebGL, owner-draw): mcp.ts steers those stacks to "screen_capture + ocr /
 * click_text" as the ONLY way to read/drive them. Every branch of click_text had a test EXCEPT the one that matters —
 * the happy path: OCR the window's live pixels, match the requested text, post a cursor-free click that LANDS on it.
 *
 * Proof (synthetic, deterministic): a #32770 host carries a big-font BS_AUTOCHECKBOX|BS_PUSHLIKE toggle whose caption
 * is a known string ("CLICK TARGET"). Drive the MCP `click_text` tool ({hWnd, text:"TARGET"}) and assert (a) it reports
 * `clicked text … (cursor-free)` and (b) the posted click LANDED — the toggle's BM_GETCHECK flips 0 → 1, proving the
 * OCR'd box centre resolved to the control and the WM_LBUTTON* reached it. The full chain ocrWindow → match →
 * postClickAt-lands is proven end-to-end, not just its two halves. The real cursor is never moved. Window destroyed in
 * teardown. SKIPS cleanly when no OCR language pack is installed.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic toggle):
 * Run: bun run example/click-text-cursorfree.integration.test.ts
 */
import Gdi32 from '@bun-win32/gdi32';
import Kernel32 from '@bun-win32/kernel32';
import { ocrAvailable, skry } from 'skry';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_EX_TOPMOST = 0x0000_0008;
const BS_AUTOCHECKBOX = 0x0003;
const BS_PUSHLIKE = 0x0000_1000;
const WM_SETFONT = 0x0030;
const BM_GETCHECK = 0x00f0;
const PM_REMOVE = 0x0001;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const pumpMsg = Buffer.alloc(48);
const pump = (): void => {
  for (let i = 0; i < 300; i += 1) {
    if (User32.PeekMessageW(pumpMsg.ptr!, 0n, 0, 0, PM_REMOVE) === 0) break;
    User32.TranslateMessage(pumpMsg.ptr!);
    User32.DispatchMessageW(pumpMsg.ptr!);
  }
};
const cursorPos = (): { x: number; y: number } => {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
};

type Rpc = { id?: number; result?: { isError?: boolean; content?: { type?: string; text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (message: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      try {
        const message = JSON.parse(line) as Rpc;
        if (typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {}
    }
  }
})();
let nextId = 1;
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const hInstance = Kernel32.GetModuleHandleW(null);
// A topmost host so WindowFromPoint (the postClickAt path) resolves the OCR'd pixel to OUR toggle, not an overlapping window.
const parent = User32.CreateWindowExW(WS_EX_TOPMOST, wide('#32770').ptr!, wide('skry-clicktext-host').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 200, 200, 620, 220, 0n, 0n, BigInt(hInstance), null);
// BS_PUSHLIKE → the caption renders centred on a big toggle face (OCR-friendly); BS_AUTOCHECKBOX → a single click flips
// BM_GETCHECK 0→1 with no parent WndProc, so a LANDED posted click is observable. Caption "CLICK TARGET" OCRs reliably.
const toggle = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('BUTTON').ptr!, wide('CLICK TARGET').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX | BS_PUSHLIKE, 30, 30, 560, 140, parent, 0n, BigInt(hInstance), null);
// A large font so the caption pixels OCR (the default GUI font is too small to recognize reliably).
const bigFont = Gdi32.CreateFontW(-56, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 4, 0, wide('Segoe UI').ptr!);
if (toggle !== 0n && bigFont !== 0n) User32.SendMessageW(toggle, WM_SETFONT, BigInt(bigFont), 1n);
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'clicktext', version: '1' } });
  if (!ocrAvailable()) {
    console.log('  skip: no OCR language pack installed (Settings → Language)');
  } else if (parent === 0n || toggle === 0n) {
    console.log('  skip: could not create the synthetic toggle');
  } else {
    await Bun.sleep(400); // let the toggle paint so WGC captures its caption pixels
    const hx = `0x${parent.toString(16)}`;
    const before = Number(User32.SendMessageW(toggle, BM_GETCHECK, 0n, 0n));
    User32.SetCursorPos(7, 7); // park the real cursor; a cursor-free click must NOT move it
    await Bun.sleep(40);
    const cursorBefore = cursorPos();

    const clicked = await call('tools/call', { name: 'click_text', arguments: { hWnd: hx, text: 'TARGET' } });
    await Bun.sleep(200);
    pump();
    const after = Number(User32.SendMessageW(toggle, BM_GETCHECK, 0n, 0n));
    const cursorAfter = cursorPos();

    assert(clicked.result?.isError !== true, `click_text did not error (got: ${JSON.stringify(textOf(clicked).slice(0, 120))})`);
    assert(/clicked text .* \(cursor-free\)/.test(textOf(clicked)), `click_text reports the cursor-free success branch (got: ${JSON.stringify(textOf(clicked).slice(0, 90))})`);
    assert(before === 0 && after === 1, `the posted click LANDED on the OCR'd text — the toggle flipped (BM_GETCHECK ${before} → ${after})`);
    assert(Math.abs(cursorAfter.x - cursorBefore.x) <= 2 && Math.abs(cursorAfter.y - cursorBefore.y) <= 2, `the real cursor never moved (before ${cursorBefore.x},${cursorBefore.y} → after ${cursorAfter.x},${cursorAfter.y})`);
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (toggle !== 0n) User32.DestroyWindow(toggle);
  if (bigFont !== 0n) Gdi32.DeleteObject(bigFont);
  if (parent !== 0n) User32.DestroyWindow(parent);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — click_text OCRs a window, matches the text, and posts a cursor-free click that lands on it.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
