// Pure-TS template (image) matching over RGB bitmaps — the nut.js / robotjs "find an image on screen"
// capability, for grounding actions on surfaces with no accessibility tree. Coarse-to-fine search:
// scan candidate offsets on a coarse stride scoring by mean absolute RGB difference (subsampled),
// then refine 1px around the best candidate. Returns the top-left match + a 0..1 confidence, or null
// below the threshold. Best for small needles (a button, an icon); a full-screen scan is O(area).

import type { Rect } from '../com/reads';
import { type Bitmap, captureScreen } from './screen';

export interface Match {
  x: number;
  y: number;
  /** 0..1 confidence (1 = exact). */
  score: number;
}

function meanDifference(haystack: Bitmap, needle: Bitmap, offsetX: number, offsetY: number, step: number): number {
  let total = 0;
  for (let ny = 0; ny < needle.height; ny += step) {
    const needleRow = ny * needle.width;
    const haystackRow = (offsetY + ny) * haystack.width;
    for (let nx = 0; nx < needle.width; nx += step) {
      const needleIndex = (needleRow + nx) * 3;
      const haystackIndex = (haystackRow + offsetX + nx) * 3;
      total += Math.abs(needle.rgb[needleIndex]! - haystack.rgb[haystackIndex]!) + Math.abs(needle.rgb[needleIndex + 1]! - haystack.rgb[haystackIndex + 1]!) + Math.abs(needle.rgb[needleIndex + 2]! - haystack.rgb[haystackIndex + 2]!);
    }
  }
  // 3 channels × the exact inner-iteration count: ceil(h/step) rows × ceil(w/step) cols. No continue/break skips an
  // iteration, so this equals the running `samples += 3` accumulator for every (h, w, step≥1) — computed once instead
  // of per pixel (drops one add from the hot loop). The integer value, hence `total / samples`, is bit-identical, and
  // an empty loop (h=0 or w=0) still yields samples=0 → 255 exactly as before.
  const samples = 3 * Math.ceil(needle.height / step) * Math.ceil(needle.width / step);
  return samples > 0 ? total / samples : 255;
}

/** Find `needle` within `haystack` (top-left coords in haystack space). Null below `threshold` (0..1). */
export function findImage(haystack: Bitmap, needle: Bitmap, options: { threshold?: number; step?: number } = {}): Match | null {
  if (needle.width > haystack.width || needle.height > haystack.height) return null;
  const threshold = options.threshold ?? 0.92;
  const step = options.step ?? Math.max(1, Math.floor(needle.width / 16));
  const coarse = Math.max(2, Math.floor(needle.width / 8));
  const maxOffsetX = haystack.width - needle.width;
  const maxOffsetY = haystack.height - needle.height;

  let bestX = 0;
  let bestY = 0;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let offsetY = 0; offsetY <= maxOffsetY; offsetY += coarse) {
    for (let offsetX = 0; offsetX <= maxOffsetX; offsetX += coarse) {
      const difference = meanDifference(haystack, needle, offsetX, offsetY, step);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestX = offsetX;
        bestY = offsetY;
      }
    }
  }

  for (let offsetY = Math.max(0, bestY - coarse); offsetY <= Math.min(maxOffsetY, bestY + coarse); offsetY += 1) {
    for (let offsetX = Math.max(0, bestX - coarse); offsetX <= Math.min(maxOffsetX, bestX + coarse); offsetX += 1) {
      const difference = meanDifference(haystack, needle, offsetX, offsetY, 1);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestX = offsetX;
        bestY = offsetY;
      }
    }
  }

  const confidence = 1 - bestDifference / 255;
  return confidence >= threshold ? { x: bestX, y: bestY, score: confidence } : null;
}

/**
 * Capture the screen (or `region`, to scope the scan to a known window/sub-rect — the nut.js
 * searchRegion / AHK ImageSearch bounds parity) and locate `needle` on it, returning ABSOLUTE
 * screen coords (ready to click). The region's origin is folded into the captured bitmap, so the
 * returned coords stay absolute regardless of the scan bounds.
 */
export function locateOnScreen(needle: Bitmap, options?: { threshold?: number; step?: number; region?: Partial<Rect> }): Match | null {
  const screen = captureScreen(options?.region);
  const match = findImage(screen, needle, options);
  return match === null ? null : { x: screen.originX + match.x, y: screen.originY + match.y, score: match.score };
}

/**
 * Find EVERY occurrence of `needle` within `haystack` (the nut.js `findAll` parity hole) — coarse-grid
 * scan, refine each below-threshold cell to its local minimum, then non-max suppression drops overlaps
 * inside needle bounds (best score wins). Sorted by descending score; capped at `maxResults`.
 */
export function findAllImages(haystack: Bitmap, needle: Bitmap, options: { threshold?: number; step?: number; maxResults?: number } = {}): Match[] {
  if (needle.width > haystack.width || needle.height > haystack.height) return [];
  const threshold = options.threshold ?? 0.92;
  const step = options.step ?? Math.max(1, Math.floor(needle.width / 16));
  const maxResults = options.maxResults ?? 64;
  const coarse = Math.max(2, Math.floor(needle.width / 8));
  const maxOffsetX = haystack.width - needle.width;
  const maxOffsetY = haystack.height - needle.height;
  const cutoff = (1 - threshold) * 255;

  const relaxed = Math.min(255, cutoff + (255 * coarse * (needle.width + needle.height)) / (needle.width * needle.height)); // a coarse cell sits up to `coarse` px off the true match; bound its worst-case score inflation so a real match is never gated out before the refine

  const candidates: Match[] = [];
  for (let offsetY = 0; offsetY <= maxOffsetY; offsetY += coarse) {
    for (let offsetX = 0; offsetX <= maxOffsetX; offsetX += coarse) {
      if (meanDifference(haystack, needle, offsetX, offsetY, step) > relaxed) continue;
      let localX = offsetX;
      let localY = offsetY;
      let localDifference = Number.POSITIVE_INFINITY;
      for (let refineY = Math.max(0, offsetY - coarse); refineY <= Math.min(maxOffsetY, offsetY + coarse); refineY += 1) {
        for (let refineX = Math.max(0, offsetX - coarse); refineX <= Math.min(maxOffsetX, offsetX + coarse); refineX += 1) {
          const difference = meanDifference(haystack, needle, refineX, refineY, 1);
          if (difference < localDifference) {
            localDifference = difference;
            localX = refineX;
            localY = refineY;
          }
        }
      }
      if (localDifference <= cutoff) candidates.push({ x: localX, y: localY, score: 1 - localDifference / 255 });
    }
  }

  candidates.sort((first, second) => second.score - first.score);
  const accepted: Match[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= maxResults) break;
    if (accepted.some((kept) => Math.abs(kept.x - candidate.x) < needle.width && Math.abs(kept.y - candidate.y) < needle.height)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

/**
 * Capture the screen (or `region`, to scope the scan to a known window/sub-rect) and locate EVERY
 * occurrence of `needle`, each in ABSOLUTE screen coords. The region's origin is folded into the
 * captured bitmap, so the returned coords stay absolute regardless of the scan bounds.
 */
export function locateAllOnScreen(needle: Bitmap, options?: { threshold?: number; step?: number; maxResults?: number; region?: Partial<Rect> }): Match[] {
  const screen = captureScreen(options?.region);
  return findAllImages(screen, needle, options).map((match) => ({ x: screen.originX + match.x, y: screen.originY + match.y, score: match.score }));
}

/**
 * Locate the first screen pixel matching `rgb` within `tolerance` (per-channel max abs delta) — the
 * nut.js `pixelWithColor` parity hole, for color-based grounding ('find the next red pixel'). Returns
 * ABSOLUTE screen coords (top-down, left-to-right scan), or null if no pixel is within tolerance.
 */
export function locateColor(rgb: { r: number; g: number; b: number }, tolerance = 0, region?: Partial<Rect>): { x: number; y: number } | null {
  const screen = captureScreen(region);
  for (let y = 0, index = 0; y < screen.height; y += 1) {
    for (let x = 0; x < screen.width; x += 1, index += 3) {
      if (Math.abs(screen.rgb[index]! - rgb.r) <= tolerance && Math.abs(screen.rgb[index + 1]! - rgb.g) <= tolerance && Math.abs(screen.rgb[index + 2]! - rgb.b) <= tolerance) return { x: screen.originX + x, y: screen.originY + y };
    }
  }
  return null;
}

/** Mean per-channel absolute RGB delta (0..255) between two SAME-SIZE bitmaps, subsampled by `step` to bound cost.
 *  Returns 255 (the max) when the dimensions differ — a resized/letterboxed frame counts as "changed", and the guard
 *  prevents indexing past the smaller buffer (an OOB read → NaN-poisoned average). */
export function frameDifference(a: Bitmap, b: Bitmap, step = 1): number {
  if (a.width !== b.width || a.height !== b.height) return 255;
  let total = 0;
  const stride = a.width * 3;
  for (let y = 0; y < a.height; y += step) {
    const row = y * stride;
    for (let x = 0; x < a.width; x += step) {
      const index = row + x * 3;
      total += Math.abs(a.rgb[index]! - b.rgb[index]!) + Math.abs(a.rgb[index + 1]! - b.rgb[index + 1]!) + Math.abs(a.rgb[index + 2]! - b.rgb[index + 2]!);
    }
  }
  // 3 × ceil(h/step) × ceil(w/step) — the exact inner-iteration count, computed once instead of accumulated per pixel
  // (bit-identical divisor; same h=0/w=0 → 255 guard). Mirrors meanDifference; output pinned byte-stable by test/visual-idle.test.ts.
  const samples = 3 * Math.ceil(a.height / step) * Math.ceil(a.width / step);
  return samples > 0 ? total / samples : 255;
}

/** Poll `getFrame` until consecutive frames stay within `tolerance` (mean-abs RGB, 0..255; default 2) for `quietMs`,
 *  or `timeout` elapses — the pixel analog of waitForIdle for a surface with no a11y tree (game/canvas/WebGL/video/GPU
 *  browser content), where the UIA tree is constant so waitForIdle "settles" instantly while pixels still animate.
 *  A null frame (no surface / dropped capture) counts as "changed", so a surfaceless window never falsely settles.
 *  The caller supplies the frame source: () => captureWindowLive(hWnd) for BG/WGC, () => captureScreen(region) for FG. */
export async function waitForVisualIdle(getFrame: () => Bitmap | null | Promise<Bitmap | null>, options: { tolerance?: number; quietMs?: number; interval?: number; timeout?: number; step?: number } = {}): Promise<boolean> {
  const tolerance = options.tolerance ?? 2;
  const quietMs = options.quietMs ?? 400;
  const interval = options.interval ?? 100;
  const timeout = options.timeout ?? 5000;
  const step = options.step ?? 4;
  const start = Bun.nanoseconds();
  let previous = await getFrame();
  let stableSince = start;
  for (;;) {
    await Bun.sleep(interval);
    const now = Bun.nanoseconds();
    const current = await getFrame();
    if (previous === null || current === null || frameDifference(previous, current, step) > tolerance) {
      previous = current;
      stableSince = now;
    } else if ((now - stableSince) / 1e6 >= quietMs) {
      return true;
    }
    if ((now - start) / 1e6 >= timeout) return false;
  }
}
