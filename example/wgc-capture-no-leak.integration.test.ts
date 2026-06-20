/**
 * wgc-capture-no-leak — captureWindowLive (the WGC background/occluded/GPU-composited capture path, and the basis of
 * ocrWindow) must NOT leak per call. It released the GraphicsCaptureSession / Direct3D11CaptureFramePool / frame /
 * surface / item but never called IClosable::Close() first, so each capture leaked ~1 USER object + ~14 kernel handles
 * — monotonic, unreclaimed by dispose, and fatal to the long-lived MCP server (the 10k USER-object/process quota).
 * The fix closeAndRelease()'s each WinRT capture object (IClosable::Close, slot 6) before Release.
 *
 * Proof: capture a real window 24x and assert USER-object growth is ~0 (was +1/call → +24) and handle growth is bounded
 * (was ~+14/call → +336). One warm-up capture first so the cached device/factory init isn't counted. Notepad killed in
 * finally; WGC disposed.
 *
 * bun test is broken repo-wide for FFI; runnable harness (spawns + kills its own Notepad):
 * Run: bun run example/wgc-capture-no-leak.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';
import { closeWindow, disposeWgc, killProcess, umbriel, windowProcessId } from 'umbriel';

const GR_USEROBJECTS = 1;
const self = Kernel32.GetCurrentProcess();
const userObjects = (): number => User32.GetGuiResources(self, GR_USEROBJECTS);
const handleCount = (): number => {
  const b = Buffer.alloc(4);
  Kernel32.GetProcessHandleCount(self, b.ptr!);
  return b.readUInt32LE(0);
};

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
  const warm = await umbriel.captureWindowLive(notepad.hWnd);
  if (warm === null) {
    console.log('  skip: window has no composable surface to capture (no WGC on this host)');
  } else {
    const userBefore = userObjects();
    const handlesBefore = handleCount();
    let captured = 0;
    for (let i = 0; i < 24; i += 1) if ((await umbriel.captureWindowLive(notepad.hWnd)) !== null) captured += 1;
    const userGrowth = userObjects() - userBefore;
    const handleGrowth = handleCount() - handlesBefore;

    assert(captured === 24, `all 24 captures succeeded (${captured}/24)`);
    // Before the IClosable::Close fix: +1 USER object/call (+24) and ~+14 handles/call (~+336). After: ~0 USER, bounded handles.
    assert(userGrowth <= 3, `USER-object growth across 24 captures is ~0, not +24 — IClosable::Close freed them (Δ${userGrowth})`);
    assert(handleGrowth <= 80, `kernel-handle growth across 24 captures is bounded, not ~+336 (Δ${handleGrowth})`);
  }
} finally {
  disposeWgc();
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  await Bun.sleep(200);
  if (pid) killProcess(pid);
  notepad.dispose();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — captureWindowLive closes its WinRT capture objects (IClosable::Close); no per-call USER-object leak.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
