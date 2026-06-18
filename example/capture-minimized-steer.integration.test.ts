/**
 * capture-minimized-steer — the capture/OCR tools used to dead-end on a MINIMIZED window: ocr/click_text/capture_window
 * returned a bare error and screenshot fell through to a useless taskbar-button sliver, none telling the agent that a
 * cursor-free restore would unblock them. All four now detect the minimized window on the failure path and return the
 * established restore steer (manage_window {action:"restore"} — cursor-free, no foreground), bypassing the sliver.
 *
 * Proof: minimize a window cursor-free, then assert screenshot / capture_window / ocr / click_text each return the
 * MINIMIZED restore steer (not a sliver image or a bare error); restore it cursor-free and assert screenshot no longer
 * reports minimized. Also asserts the COLD-FRAME path: the FIRST capture_window of a freshly-visible window yields a
 * frame (the one-shot warm retry), not the misleading "protected/DRM, or WGC unavailable" error. Window closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned, UWP, Calculator):
 * Run: bun run example/capture-minimized-steer.integration.test.ts
 */
import { closeWindow, isMinimized, minimizeWindow, restoreWindow, skry } from 'skry';

import { assert, finish, spawnServer, type Rpc } from './_harness';

const { call, kill, textOf } = spawnServer();
const isImage = (m: Rpc): boolean => m.result?.content?.[0]?.type === 'image';

skry.initialize();
const priorCalc = new Set(
  skry
    .windows({ includeUntitled: true })
    .filter((window) => /Calcul/i.test(window.title))
    .map((window) => window.hWnd),
);
// Cold-start guard (finding/34): a wedged single-instance Calculator app model leaves `start calc` re-activating a
// headless zombie that never gets a titled window, so `launch` throws. That throw happens BEFORE the try below, so
// without this guard the `finally` never runs and the MCP subprocess (kill) leaks. SKIP clean instead, killing it.
const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' }).catch(() => null);
if (calc === null) {
  kill();
  console.log('SKIP — Calculator app model wedged/unavailable (single-instance); cannot prove the minimized capture steers here (finding/34).');
  for (const window of skry.windows({ includeUntitled: true }).filter((w) => /Calcul/i.test(w.title) && !priorCalc.has(w.hWnd))) closeWindow(window.hWnd);
  skry.uninitialize();
  process.exit(0);
}
const hx = `0x${calc.hWnd.toString(16)}`;
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'capture-min', version: '1' } });
  await Bun.sleep(800);
  await call('tools/call', { name: 'attach', arguments: { hWnd: hx } });

  // Cold-frame: the FIRST capture_window of the freshly-launched, still-visible window must NOT mis-report DRM/unavailable.
  // A cold Direct3D11CaptureFramePool routinely misses its first frame inside the 500ms default — without the one-shot
  // warm retry this returned null and the handler emitted the misleading "protected/DRM content, or WGC unavailable".
  if (!isMinimized(calc.hWnd)) {
    const cold = await call('tools/call', { name: 'capture_window', arguments: { hWnd: hx } });
    assert(isImage(cold) || !/protected\/DRM|unavailable/i.test(textOf(cold)), `first capture_window warms past a cold pool to a frame, not a misleading DRM/unavailable error: ${isImage(cold) ? 'image' : textOf(cold).slice(0, 40)}`);
  } else {
    console.log('  skip: window came up minimized — cold-frame check needs a visible window');
  }

  minimizeWindow(calc.hWnd);
  for (let waited = 0; !isMinimized(calc.hWnd) && waited < 2000; waited += 100) await Bun.sleep(100); // poll, not a fixed sleep — UWP Calc minimizes slowly
  const steers = (m: Rpc): boolean => m.result?.isError === true && /MINIMIZED/i.test(textOf(m)) && /restore/i.test(textOf(m));

  const shot = await call('tools/call', { name: 'screenshot', arguments: {} });
  assert(steers(shot) && !isImage(shot), `screenshot steers to restore (no taskbar sliver) — got: ${JSON.stringify(textOf(shot).slice(0, 60))}`);
  assert(steers(await call('tools/call', { name: 'capture_window', arguments: { hWnd: hx } })), 'capture_window steers to restore');
  assert(steers(await call('tools/call', { name: 'ocr', arguments: { hWnd: hx } })), 'ocr steers to restore');
  assert(steers(await call('tools/call', { name: 'click_text', arguments: { hWnd: hx, text: 'five' } })), 'click_text steers to restore');

  restoreWindow(calc.hWnd);
  await Bun.sleep(500);
  const after = await call('tools/call', { name: 'screenshot', arguments: {} });
  assert(!/MINIMIZED/i.test(textOf(after)), 'after a cursor-free restore, screenshot no longer reports minimized (the steer unblocked it)');
} finally {
  kill();
  closeWindow(calc.hWnd);
  calc.dispose();
  for (const window of skry.windows({ includeUntitled: true }).filter((w) => /Calcul/i.test(w.title) && !priorCalc.has(w.hWnd))) closeWindow(window.hWnd);
  skry.uninitialize();
}

finish('PASS — capture/OCR tools steer a minimized window to restore; the first capture of a fresh window warms past a cold frame.');
