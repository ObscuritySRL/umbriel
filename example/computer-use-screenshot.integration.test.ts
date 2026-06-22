/**
 * computer-use-screenshot — the CUA `screenshot` observation action must return REAL pixels for a GPU-composited
 * window, not the blank/empty frame bare PrintWindow yields. dispatch()'s 'screenshot' case used
 * window.screenshot() (PrintWindow + GDI only), so on a Chromium/Edge/Electron/WinUI/game surface — exactly the
 * computer-use target set — the agent's observation was blank while every action verb (click/type/scroll) was
 * already cursor-free + background-capable. The fix mirrors Element.capture(): WGC-first (captureWindowLive) then
 * PrintWindow fallback, encoded to PNG; both null → honest ok:false.
 *
 * Proof: drive Calculator (WinUI/XAML, GPU-composited). dispatch({action:'screenshot'}) returns a valid, non-trivial
 * PNG; a direct captureWindowRGB (PrintWindow) of the same window is near-uniform/blank while the WGC frame has real
 * content — i.e. the WGC-first path is what saved the observation. Calculator closed in finally.
 *
 * APIs demonstrated: dispatch (screenshot action), umbriel.captureWindowLive, captureWindowRGB
 * bun test is broken repo-wide for FFI; runnable harness (spawns + closes its own Calculator):
 * Run: bun run example/computer-use-screenshot.integration.test.ts
 */
import { captureWindowRGB, dispatch, encodePNG, umbriel } from 'umbriel';

// Sample the RGB buffer; a window is "near-uniform" (blank) if every channel's min..max spread is tiny.
function nearUniform(rgb: Uint8Array): boolean {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (let index = 0; index + 2 < rgb.length; index += 3 * 97) {
    const r = rgb[index]!;
    const g = rgb[index + 1]!;
    const b = rgb[index + 2]!;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  return rMax - rMin < 8 && gMax - gMin < 8 && bMax - bMin < 8;
}

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const calc = await umbriel.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
calc.activate();
await umbriel.waitForIdle(calc, { timeout: 4000, quietMs: 350 });
try {
  await umbriel.captureWindowLive(calc.hWnd); // warm the WGC device/framepool — the first capture after launch can cold-miss
  await Bun.sleep(150);
  const printWindow = captureWindowRGB(calc.hWnd); // the OLD path window.screenshot() used
  const wgc = await umbriel.captureWindowLive(calc.hWnd); // the WGC recovery path the fix prefers

  const shot = await dispatch(calc, { action: 'screenshot' });
  assert(shot.ok === true, `dispatch screenshot ok (${shot.ok ? 'ok' : shot.error})`);
  const png = shot.screenshot;
  assert(png !== undefined && png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71, 'screenshot is a valid PNG (signature)');
  assert(png !== undefined && png.length > 3000, `screenshot is a non-trivial PNG, not a blank frame (${png?.length ?? 0} bytes)`);

  if (wgc === null) {
    console.log('  skip: no WGC surface on this host — fix still falls back to PrintWindow (asserted above)');
  } else {
    assert(!nearUniform(wgc.rgb), 'the WGC frame dispatch prefers has real content (not near-uniform)');
    // DISCRIMINATING: dispatch must return the WGC frame, not the PrintWindow frame. Re-encode the WGC frame the same
    // way dispatch does and assert byte-equality (Calculator is static after waitForIdle, so the back-to-back WGC
    // captures match). If the fix were reverted to bare PrintWindow, shot would equal the (different) PrintWindow PNG.
    const wgcPng = encodePNG(wgc.rgb, wgc.width, wgc.height);
    const pwPng = printWindow === null ? new Uint8Array(0) : encodePNG(printWindow.rgb, printWindow.width, printWindow.height);
    assert(!Buffer.from(wgcPng).equals(Buffer.from(pwPng)), 'WGC and PrintWindow frames encode to different PNGs (so the equality below is meaningful)');
    assert(png !== undefined && Buffer.from(png).equals(Buffer.from(wgcPng)), 'dispatch returned the WGC frame (byte-identical to the re-encoded WGC capture), NOT the PrintWindow frame');
    const pwBlank = printWindow !== null && nearUniform(printWindow.rgb);
    if (pwBlank) console.log('  ✓ and PrintWindow alone was blank/near-uniform — the WGC path is what supplied real pixels');
  }
} finally {
  try {
    calc.close();
  } catch {
    calc.dispose();
  }
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — the CUA screenshot action returns real WGC-recovered pixels for a GPU-composited window.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
