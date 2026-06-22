/**
 * wait-visual-idle — wait_visual_idle / waitForVisualIdle is the PIXEL analog of wait_idle for a surface with no a11y
 * tree (a game/canvas/WebGL/video/GPU-composited view), where wait_idle "settles" instantly because the UIA tree never
 * moves while pixels animate. It polls a frame source and settles when consecutive frames stay within tolerance for
 * quietMs. The animating-doesn't-settle / null-never-settles contract is proven deterministically in
 * test/visual-idle.test.ts; this is the LIVE integration smoke for the two real frame sources.
 *
 * Proof: a static screen region (FG/BitBlt) and a static window (BG/WGC) both SETTLE — confirming the captureScreen and
 * captureWindowLive thunk paths plumb through end-to-end and a quiet surface is detected as quiet. Notepad closed in finally.
 *
 * APIs: umbriel.waitForVisualIdle, umbriel.captureScreen, umbriel.captureWindowLive, wgcAvailable
 * bun test is broken repo-wide for FFI; runnable harness (spawns + closes its own Notepad):
 * Run: bun run example/wait-visual-idle.integration.test.ts
 */
import { closeWindow, killProcess, umbriel, wgcAvailable, windowProcessId } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const notepad = await umbriel.launch(['notepad.exe'], { className: 'Notepad' });
await Bun.sleep(900);
try {
  // FG path: a static top-left screen region settles (BitBlt frame source). A blinking caret is sub-tolerance.
  const fgSettled = await umbriel.waitForVisualIdle(() => umbriel.captureScreen({ x: 0, y: 0, width: 220, height: 160 }), { quietMs: 300, interval: 80, timeout: 5000, tolerance: 3 });
  assert(fgSettled === true, 'waitForVisualIdle settles a static screen region (FG / captureScreen thunk)');

  // BG path: a static window settles (occlusion-correct WGC frame source).
  if (!wgcAvailable()) {
    console.log('  skip: no WGC on this host — BG/captureWindowLive path not exercised live (FG asserted above; the full contract is unit-tested)');
  } else {
    const bgSettled = await umbriel.waitForVisualIdle(() => umbriel.captureWindowLive(notepad.hWnd), { quietMs: 300, interval: 80, timeout: 5000, tolerance: 3 });
    assert(bgSettled === true, 'waitForVisualIdle settles a static window (BG / captureWindowLive WGC thunk)');
  }
} finally {
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  await Bun.sleep(200);
  if (pid) killProcess(pid);
  notepad.dispose();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — waitForVisualIdle settles a quiet surface via both the FG (BitBlt) and BG (WGC) frame sources.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
