import { expect, test } from 'bun:test';

import { frameDifference, waitForVisualIdle } from '../capture/match';

// frameDifference + waitForVisualIdle are pure over Bitmaps / a frame-source thunk, so the whole contract is
// deterministically testable here without a desktop: identical frames settle, changing frames don't, a size change
// or a null frame counts as "changed" (never a false settle).
const bmp = (width: number, height: number, fill: number) => ({ rgb: new Uint8Array(width * height * 3).fill(fill), width, height, originX: 0, originY: 0 });

test('frameDifference: identical frames = 0', () => {
  expect(frameDifference(bmp(4, 4, 100), bmp(4, 4, 100))).toBe(0);
});

test('frameDifference: a uniform +30 per-channel delta = 30 (0..255 units)', () => {
  expect(frameDifference(bmp(4, 4, 100), bmp(4, 4, 130))).toBe(30);
});

test('frameDifference: a dimension mismatch returns 255 (resize = changed; no out-of-bounds read)', () => {
  expect(frameDifference(bmp(4, 4, 100), bmp(5, 4, 100))).toBe(255);
  expect(frameDifference(bmp(4, 4, 100), bmp(4, 5, 100))).toBe(255);
});

test('waitForVisualIdle: settles true once frames stop changing for quietMs', async () => {
  let poll = 0;
  const getFrame = () => {
    poll += 1;
    return poll <= 3 ? bmp(8, 8, 50 + poll * 40) : bmp(8, 8, 200); // animate for 3 polls, then hold steady
  };
  expect(await waitForVisualIdle(getFrame, { interval: 20, quietMs: 80, timeout: 3000, tolerance: 2, step: 1 })).toBe(true);
});

test('waitForVisualIdle: returns false at timeout while frames keep changing', async () => {
  let poll = 0;
  const getFrame = () => {
    poll += 1;
    return bmp(8, 8, (poll * 50) & 0xff); // never stable
  };
  expect(await waitForVisualIdle(getFrame, { interval: 20, quietMs: 80, timeout: 300, tolerance: 2, step: 1 })).toBe(false);
});

test('waitForVisualIdle: a null frame (no surface) counts as changed — never falsely settles', async () => {
  expect(await waitForVisualIdle(() => null, { interval: 20, quietMs: 80, timeout: 300, tolerance: 2 })).toBe(false);
});

test('waitForVisualIdle: sub-tolerance jitter (a blinking caret) still settles', async () => {
  let poll = 0;
  const getFrame = () => {
    poll += 1;
    return bmp(40, 40, poll % 2 === 0 ? 200 : 201); // ±1 noise — under the default tolerance
  };
  expect(await waitForVisualIdle(getFrame, { interval: 20, quietMs: 80, timeout: 2000, tolerance: 2, step: 1 })).toBe(true);
});
