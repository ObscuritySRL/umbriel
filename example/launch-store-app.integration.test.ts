/**
 * launch-store-app — the library `launch()` must reach a Store-aliased app (the Win11 Paint), not only $PATH exes.
 * CreateProcess (Bun.spawn) cannot resolve an App Execution Alias, so `launch(['mspaint'], …)` used to throw ENOENT;
 * launch() now mirrors the MCP launch_app fallback (spawn → on failure ShellExecuteW via openPath, which resolves
 * App-Paths + Store aliases). Proof: launch the new Paint by alias through the LIBRARY function and confirm its
 * MSPaintApp window appears; then close it (dispose≠close — taskkill + closeWindow so no Paint is leaked).
 *
 * bun test is broken repo-wide for FFI — runnable harness:
 * Run: bun run example/launch-store-app.integration.test.ts
 */
import { closeWindow, umbriel, windowProcessId } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
let paint: Awaited<ReturnType<typeof umbriel.launch>> | null = null;
try {
  // 'mspaint' is NOT on $PATH as a real exe on Win11 (it is a Store execution alias) — Bun.spawn throws ENOENT, so this
  // only succeeds via the new ShellExecuteW fallback inside launch().
  paint = await umbriel.launch(['mspaint'], { className: 'MSPaintApp' }, 15000);
  assert(paint.hWnd !== 0n, `launch() resolved the Store-aliased Paint to a window: hwnd=0x${paint.hWnd.toString(16)}`);
  assert(paint.className === 'MSPaintApp', `the launched window is Paint (className=${JSON.stringify(paint.className)})`);
} catch (error) {
  assert(false, `launch(['mspaint']) should launch the Store-aliased Paint via the ShellExecuteW fallback, but threw: ${(error as Error).message}`);
} finally {
  if (paint && paint.hWnd !== 0n) {
    const pid = windowProcessId(paint.hWnd);
    if (pid) Bun.spawnSync(['taskkill', '/F', '/PID', String(pid)]);
    closeWindow(paint.hWnd);
    paint.dispose();
  }
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — the library launch() reaches a Store-aliased app (Win11 Paint) via the ShellExecuteW fallback.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
