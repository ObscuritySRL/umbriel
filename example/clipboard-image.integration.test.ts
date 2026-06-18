/**
 * clipboard-image — put an IMAGE on the Windows clipboard and read one back (CF_DIB), the way a human copies a
 * screenshot and pastes it into Paint / Word / chat. The clipboard surface was text + files only; writeClipboardImage /
 * readClipboardImage add the picture path (24-bit BI_RGB DIB, the canonical clipboard bitmap every app accepts).
 *
 * Proof: (1) a synthesized bitmap survives encode → CF_DIB clipboard → decode pixel-for-pixel; (2) a REAL screen
 * capture round-trips at the right size and bytes. No window is opened; this only touches the clipboard.
 *
 * NOTE: this overwrites the current clipboard contents (like any copy), same as the other clipboard tests.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/clipboard-image.integration.test.ts
 */
import { type Pointer, toArrayBuffer } from 'bun:ffi';

import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

import { captureScreen, readClipboardImage, writeClipboardImage } from 'skry';

const CF_DIB = 8;
/** Put a RAW CF_DIB blob on the clipboard — to exercise decode paths (32-bpp, top-down, malformed) we never WRITE. */
function setRawDib(dib: Buffer): void {
  const handle = Kernel32.GlobalAlloc(0x0002, BigInt(dib.length));
  const pointer = Kernel32.GlobalLock(handle);
  if (pointer !== null) new Uint8Array(toArrayBuffer(pointer as Pointer, 0, dib.length)).set(dib);
  Kernel32.GlobalUnlock(handle);
  User32.OpenClipboard(0n);
  User32.EmptyClipboard();
  User32.SetClipboardData(CF_DIB, handle);
  User32.CloseClipboard();
}

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}
function pixelsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// 1) exact round-trip with a synthesized 7×5 bitmap (distinct per-pixel values catch BGR/stride/orientation bugs)
const width = 7;
const height = 5;
const rgb = new Uint8Array(width * height * 3);
for (let i = 0; i < width * height; i += 1) {
  rgb[i * 3] = (i * 10) & 255;
  rgb[i * 3 + 1] = (i * 20) & 255;
  rgb[i * 3 + 2] = (255 - i * 15) & 255;
}
assert(writeClipboardImage({ rgb, width, height }), 'writeClipboardImage put a synthesized bitmap on the clipboard (CF_DIB)');
const back = readClipboardImage();
assert(back !== null && back.width === width && back.height === height, `readClipboardImage returns the same dimensions (${back?.width}×${back?.height})`);
assert(back !== null && pixelsEqual(back.rgb, rgb), 'every pixel survives the clipboard round-trip exactly (no BGR/stride/flip drift)');

// 2) a REAL screen capture round-trips losslessly (24-bit BI_RGB is lossless)
const shot = captureScreen({ x: 0, y: 0, width: 64, height: 48 });
assert(writeClipboardImage(shot), 'wrote a real 64×48 screen capture to the clipboard');
const shotBack = readClipboardImage();
assert(shotBack !== null && shotBack.width === shot.width && shotBack.height === shot.height, 'read the captured image back at the right size');
assert(shotBack !== null && pixelsEqual(shotBack.rgb, shot.rgb), 'the captured image survives the clipboard round-trip byte-for-byte');

// 3) decode a 32-bpp TOP-DOWN DIB (what a browser "copy image" / many apps write) — exercises the bpp=32 + top-down read paths
{
  const w = 3;
  const h = 2;
  const stride = (w * 4 + 3) & ~3;
  const dib = Buffer.alloc(40 + stride * h);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(w, 4);
  dib.writeInt32LE(-h, 8); // negative ⇒ top-down
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(stride * h, 20);
  const want = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    const r = (i * 30) & 255;
    const g = (i * 50) & 255;
    const b = (i * 70) & 255;
    want[i * 3] = r;
    want[i * 3 + 1] = g;
    want[i * 3 + 2] = b;
    const d = 40 + i * 4;
    dib[d] = b; // BGRA, top-down: row order already matches the output
    dib[d + 1] = g;
    dib[d + 2] = r;
    dib[d + 3] = 255;
  }
  setRawDib(dib);
  const got = readClipboardImage();
  assert(got !== null && got.width === w && got.height === h, `decoded a 32-bpp top-down DIB at the right size (${got?.width}×${got?.height})`);
  assert(got !== null && pixelsEqual(got.rgb, want), '32-bpp top-down BGRA decodes to correct RGB (alpha ignored, no row flip)');
}

// 4) untrusted-bytes contract: a malformed CF_DIB returns null, never throws (the clipboard is attacker-controllable)
setRawDib(Buffer.alloc(8)); // too small for a BITMAPINFOHEADER
assert(readClipboardImage() === null, 'a too-small CF_DIB returns null (no throw)');
{
  const bad = Buffer.alloc(40);
  bad.writeUInt32LE(40, 0);
  bad.writeInt32LE(-5, 4); // negative width — would RangeError the allocation
  bad.writeInt32LE(4, 8);
  bad.writeUInt16LE(24, 14);
  setRawDib(bad);
  assert(readClipboardImage() === null, 'a negative-width CF_DIB returns null (no throw / no RangeError)');
}
{
  const truncated = Buffer.alloc(40 + 8); // header says 100×100 but only 8 bytes of pixels follow
  truncated.writeUInt32LE(40, 0);
  truncated.writeInt32LE(100, 4);
  truncated.writeInt32LE(100, 8);
  truncated.writeUInt16LE(24, 14);
  setRawDib(truncated);
  assert(readClipboardImage() === null, 'a truncated CF_DIB (pixels not all present) returns null, not a garbage image');
}

console.log(failures === 0 ? '\nPASS — images round-trip through the Windows clipboard (CF_DIB); an agent can copy a screenshot to paste anywhere.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
