/**
 * scroll-no-false-success — the scroll handler fell back to the ownerHwnd ANCESTOR when a control had no own HWND, so a
 * posted wheel went to the parent window (e.g. the taskbar) while PostMessage still returned success — a false
 * "scrolled … (posted wheel, cursor-free)" report for a control that never scrolled. The posted-wheel path is now
 * gated on the control's OWN nativeWindowHandle; a no-own-HWND control falls to scrollAt and an honest result.
 *
 * Proof (taskbar — read-only): scroll a no-own-HWND control (the Start button) — the result must NOT claim the false
 * cursor-free posted wheel.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + the taskbar):
 * Run: bun run example/scroll-no-false-success.integration.test.ts
 */
import { assert, finish, skip, spawnServer } from './_harness';

const { call, kill, textOf } = spawnServer();

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'scroll-honest', version: '1' } });
  const snap = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const start = /"Start" \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
  if (start === undefined) skip('no Start button ref on this taskbar');
  else {
    const r = await call('tools/call', { name: 'scroll', arguments: { ref: start, direction: 'up', amount: 2 } });
    const text = textOf(r);
    assert(!/posted wheel, cursor-free/.test(text), `scroll on a no-own-HWND control does NOT falsely claim a cursor-free posted wheel (got: ${JSON.stringify(text.slice(0, 80))})`);
  }
} finally {
  kill();
}

finish('PASS — scroll no longer reports a false posted-wheel success on a no-own-HWND control.');
