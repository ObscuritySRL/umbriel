import { expect, test } from 'bun:test';

import { findImage } from '../capture/match';
import type { Bitmap } from '../capture/screen';

// Pins findImage's numeric output — and through it the meanDifference normalization, which dropped its per-pixel
// `samples += 3` accumulator for a closed form (samples = 3·ceil(h/step)·ceil(w/step)). meanDifference is module-local;
// findImage is its only exported, fully-pure entry point. A wrong samples count changes the mean → the confidence score
// → this test. (frameDifference, the sibling that took the same closed-form change, is pinned by test/visual-idle.test.ts.)
// Pure Bitmap math — no capture, no window, runs under `bun test`.

function solid(width: number, height: number, r: number, g: number, b: number): Bitmap {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = r;
    rgb[i + 1] = g;
    rgb[i + 2] = b;
  }
  return { rgb, width, height, originX: 0, originY: 0 };
}

/** Paint a `block` into `base` at (x,y), returning a new bitmap (does not mutate base). */
function place(base: Bitmap, block: Bitmap, x: number, y: number): Bitmap {
  const rgb = Uint8Array.from(base.rgb);
  for (let by = 0; by < block.height; by += 1) {
    for (let bx = 0; bx < block.width; bx += 1) {
      const dst = ((y + by) * base.width + (x + bx)) * 3;
      const src = (by * block.width + bx) * 3;
      rgb[dst] = block.rgb[src]!;
      rgb[dst + 1] = block.rgb[src + 1]!;
      rgb[dst + 2] = block.rgb[src + 2]!;
    }
  }
  return { rgb, width: base.width, height: base.height, originX: 0, originY: 0 };
}

test('findImage normalizes the mean by the exact sample count (closed-form samples is bit-identical)', () => {
  // A uniform needle (100) over a uniform haystack (110): every channel differs by 10, single candidate offset (0,0).
  // mean = (10·3·16) / (3·4·4) = 480/48 = 10  →  score = 1 − 10/255. A wrong samples divisor moves this score.
  const haystack = solid(4, 4, 110, 110, 110);
  const needle = solid(4, 4, 100, 100, 100);
  const match = findImage(haystack, needle);
  expect(match).not.toBeNull();
  expect(match!.x).toBe(0);
  expect(match!.y).toBe(0);
  expect(match!.score).toBe(1 - 10 / 255); // exact: bestDifference 480/48 = 10 is integral, so the score is deterministic
});

test('findImage locates an exact sub-image at its coordinates with score 1', () => {
  const block = solid(3, 3, 200, 50, 50);
  const haystack = place(solid(8, 8, 0, 0, 0), block, 4, 2); // on the coarse grid (stride 2) so it is hit directly
  const match = findImage(haystack, block);
  expect(match).toEqual({ x: 4, y: 2, score: 1 });
});

test('findImage returns null when the best score is below threshold (the normalized mean gates correctly)', () => {
  const haystack = solid(4, 4, 110, 110, 110);
  const needle = solid(4, 4, 100, 100, 100); // score 1 − 10/255 ≈ 0.961
  expect(findImage(haystack, needle, { threshold: 0.99 })).toBeNull();
});
