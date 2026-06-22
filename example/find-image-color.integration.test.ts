/**
 * find-image-color — the find_image / find_color MCP tools wire the existing capture/match.ts grounding primitives
 * (locateOnScreen / locateColor — the AHK ImageSearch+PixelSearch / nut.js findOnScreen+pixelWithColor core) to MCP,
 * plus a from-scratch decodePNG so a base64-PNG needle can arrive over the wire. This proves the full pipeline the
 * handlers run: capture a screen region -> encodePNG -> base64 -> decodePNG (the new code) -> locateOnScreen finds it
 * at the correct SCREEN-absolute coords; and locateColor finds a screen pixel by RGB.
 *
 * No window to close (reads the live desktop). bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/find-image-color.integration.test.ts
 */
import { captureScreen, decodePNG, encodePNG, locateColor, locateOnScreen } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// A distinctive on-screen region to use as the template needle.
const region = { x: 120, y: 120, width: 140, height: 100 };
const crop = captureScreen(region);

// 1) The base64-PNG round-trip the find_image handler runs: encodePNG -> base64 -> decodePNG must be EXACT (deterministic).
const base64 = Buffer.from(encodePNG(crop.rgb, crop.width, crop.height)).toString('base64');
const decoded = decodePNG(new Uint8Array(Buffer.from(base64, 'base64')));
assert(decoded.width === crop.width && decoded.height === crop.height, `decodePNG round-trips the needle dims (${decoded.width}x${decoded.height})`);
assert(Buffer.from(decoded.rgb).equals(Buffer.from(crop.rgb)), 'decodePNG round-trips the needle pixels byte-exact (encode->base64->decode)');

// 2) locateOnScreen finds the decoded needle on the live screen with a near-perfect score (a self-match exists).
const needle = { ...decoded, originX: 0, originY: 0 };
const match = locateOnScreen(needle, {});
assert(match !== null && match.score > 0.95, `locateOnScreen finds the needle (score ${match?.score.toFixed(3) ?? 'null'})`);

// 3) The returned coords are SCREEN-absolute and point at a region that re-captures to the needle (proves origin folding).
if (match !== null) {
  const reCrop = captureScreen({ x: match.x, y: match.y, width: crop.width, height: crop.height });
  let samePixels = 0;
  for (let i = 0; i < crop.rgb.length; i += 1) if (reCrop.rgb[i] === crop.rgb[i]) samePixels += 1;
  const sameFraction = samePixels / crop.rgb.length;
  assert(sameFraction > 0.97, `re-capturing at the returned {x:${match.x},y:${match.y}} matches the needle (${(sameFraction * 100).toFixed(1)}% identical pixels)`);
}

// 4) find_color: read a pixel's RGB from the crop, locate that color on screen, and verify the returned pixel matches.
const center = (Math.floor(crop.height / 2) * crop.width + Math.floor(crop.width / 2)) * 3;
const r = crop.rgb[center]!;
const g = crop.rgb[center + 1]!;
const b = crop.rgb[center + 2]!;
const hit = locateColor({ r, g, b }, 0);
assert(hit !== null, `locateColor finds rgb(${r},${g},${b}) somewhere on screen`);
if (hit !== null) {
  const at = captureScreen({ x: hit.x, y: hit.y, width: 1, height: 1 });
  assert(at.rgb[0] === r && at.rgb[1] === g && at.rgb[2] === b, `the pixel at the returned {x:${hit.x},y:${hit.y}} really is rgb(${r},${g},${b})`);
}

console.log(failures === 0 ? '\nPASS — find_image (decodePNG + locateOnScreen) and find_color (locateColor) ground a screen surface by template/color at absolute coords.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
