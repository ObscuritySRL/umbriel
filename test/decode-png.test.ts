import { expect, test } from 'bun:test';

import { decodePNG, encodePNG } from '../capture/png';

// decodePNG is the highest-risk new code (a from-scratch PNG reader). encodePNG only emits color type 2 + filter 0,
// so this test builds PNGs the encoder never would — every row filter (0-4, incl. Paeth) and color types 0/2/3/6 —
// and asserts decodePNG recovers the exact RGB. It also pins the unsupported-input rejections.

const uint32BE = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const adler32 = (bytes: Uint8Array): number => {
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % 65521;
    high = (high + low) % 65521;
  }
  return ((high << 16) | low) >>> 0;
};
const chunk = (type: string, data: Uint8Array): number[] => {
  const body = [...Uint8Array.from(type, (character) => character.charCodeAt(0)), ...data];
  return [...uint32BE(data.length), ...body, ...uint32BE(crc32(Uint8Array.from(body)))];
};

// Forward-filter (the inverse of decodePNG's un-filter) so we can hand the decoder real filtered scanlines.
function forwardFilter(channelData: Uint8Array, width: number, height: number, bpp: number, filterType: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    out[row * (stride + 1)] = filterType;
    for (let index = 0; index < stride; index += 1) {
      const raw = channelData[row * stride + index]!;
      const left = index >= bpp ? channelData[row * stride + index - bpp]! : 0;
      const up = row > 0 ? channelData[(row - 1) * stride + index]! : 0;
      const upLeft = row > 0 && index >= bpp ? channelData[(row - 1) * stride + index - bpp]! : 0;
      let filtered = raw;
      if (filterType === 1) filtered = raw - left;
      else if (filterType === 2) filtered = raw - up;
      else if (filterType === 3) filtered = raw - ((left + up) >> 1);
      else if (filterType === 4) {
        const predict = left + up - upLeft;
        const distLeft = Math.abs(predict - left);
        const distUp = Math.abs(predict - up);
        const distUpLeft = Math.abs(predict - upLeft);
        filtered = raw - (distLeft <= distUp && distLeft <= distUpLeft ? left : distUp <= distUpLeft ? up : upLeft);
      }
      out[row * (stride + 1) + 1 + index] = filtered & 0xff;
    }
  }
  return out;
}

function assemble(colorType: number, bitDepth: number, interlace: number, filtered: Uint8Array, width: number, height: number, palette?: Uint8Array): Uint8Array {
  const deflated = Bun.deflateSync(new Uint8Array(filtered));
  const zlib = Uint8Array.from([0x78, 0x01, ...deflated, ...uint32BE(adler32(filtered))]);
  const ihdr = Uint8Array.from([...uint32BE(width), ...uint32BE(height), bitDepth, colorType, 0, 0, interlace]);
  const parts = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr)];
  if (palette) parts.push(...chunk('PLTE', palette));
  parts.push(...chunk('IDAT', zlib), ...chunk('IEND', new Uint8Array(0)));
  return Uint8Array.from(parts);
}

// A 6x4 image with per-pixel variation so every filter predictor is actually exercised.
const W = 6;
const H = 4;
const rgb = new Uint8Array(W * H * 3);
for (let index = 0; index < rgb.length; index += 1) rgb[index] = (index * 37 + (index % 7) * 11) & 0xff;

test('encodePNG -> decodePNG round-trip (color type 2, filter 0)', () => {
  const decoded = decodePNG(encodePNG(rgb, W, H));
  expect(decoded.width).toBe(W);
  expect(decoded.height).toBe(H);
  expect(Buffer.from(decoded.rgb).equals(Buffer.from(rgb))).toBe(true);
});

test('every row filter (None/Sub/Up/Average/Paeth) un-filters back to the original RGB', () => {
  for (let filterType = 0; filterType <= 4; filterType += 1) {
    const png = assemble(2, 8, 0, forwardFilter(rgb, W, H, 3, filterType), W, H);
    const decoded = decodePNG(png);
    expect(`filter ${filterType}: ${Buffer.from(decoded.rgb).equals(Buffer.from(rgb))}`).toBe(`filter ${filterType}: true`);
  }
});

test('color type 6 (RGBA) drops alpha to RGB', () => {
  const rgba = new Uint8Array(W * H * 4);
  for (let pixel = 0; pixel < W * H; pixel += 1) {
    rgba[pixel * 4] = rgb[pixel * 3]!;
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1]!;
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2]!;
    rgba[pixel * 4 + 3] = 128; // alpha — must be dropped
  }
  const decoded = decodePNG(assemble(6, 8, 0, forwardFilter(rgba, W, H, 4, 4), W, H));
  expect(Buffer.from(decoded.rgb).equals(Buffer.from(rgb))).toBe(true);
});

test('color type 0 (grayscale) expands to RGB', () => {
  const gray = new Uint8Array(W * H);
  for (let pixel = 0; pixel < W * H; pixel += 1) gray[pixel] = (pixel * 9) & 0xff;
  const decoded = decodePNG(assemble(0, 8, 0, forwardFilter(gray, W, H, 1, 2), W, H));
  for (let pixel = 0; pixel < W * H; pixel += 1) {
    expect(decoded.rgb[pixel * 3]).toBe(gray[pixel]!);
    expect(decoded.rgb[pixel * 3 + 1]).toBe(gray[pixel]!);
    expect(decoded.rgb[pixel * 3 + 2]).toBe(gray[pixel]!);
  }
});

test('color type 3 (palette) maps indices through PLTE', () => {
  const palette = Uint8Array.from([10, 20, 30, 200, 100, 50, 1, 2, 3]); // 3 entries
  const indices = new Uint8Array(W * H);
  for (let pixel = 0; pixel < W * H; pixel += 1) indices[pixel] = pixel % 3;
  const decoded = decodePNG(assemble(3, 8, 0, forwardFilter(indices, W, H, 1, 0), W, H, palette));
  for (let pixel = 0; pixel < W * H; pixel += 1) {
    const entry = (pixel % 3) * 3;
    expect(decoded.rgb[pixel * 3]).toBe(palette[entry]!);
    expect(decoded.rgb[pixel * 3 + 1]).toBe(palette[entry + 1]!);
    expect(decoded.rgb[pixel * 3 + 2]).toBe(palette[entry + 2]!);
  }
});

test('rejects unsupported / malformed input with a steered error', () => {
  expect(() => decodePNG(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  expect(() => decodePNG(assemble(2, 16, 0, forwardFilter(rgb, W, H, 3, 0), W, H))).toThrow(/8-bit/);
  expect(() => decodePNG(assemble(2, 8, 1, forwardFilter(rgb, W, H, 3, 0), W, H))).toThrow(/interlaced/);
});
