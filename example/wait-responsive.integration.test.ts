/**
 * wait-responsive — wait_responsive probes whether a window's UI thread is RESPONSIVE (pumps messages) or HUNG/frozen,
 * via a WM_NULL ping through SendMessageTimeout (User32; FlaUI Wait.UntilResponsive parity). Unlike wait_idle (UIA
 * tree-hash stability — a FROZEN window's tree is unchanged, so it reports "settled"), this catches a genuinely hung
 * app. Read-only: no foreground steal, no input; SMTO_ABORTIFHUNG returns promptly on an already-hung target.
 *
 * Proof: the facade windowResponsive() on a live Notepad returns true PROMPTLY (well under the 5s timeout) and steals
 * NO foreground; the wait_responsive tool is exposed under readonly and reports a live window "responsive"; a
 * stale/closed handle returns the DISTINCT 'no such window' error (not a false 'hung'). Notepad is closed in finally.
 *
 * Run: bun run example/wait-responsive.integration.test.ts
 */
import { closeWindow, umbriel, windowResponsive } from 'umbriel';
import User32 from '@bun-win32/user32';

import { assert, finish, spawnServer } from './_harness';

const server = spawnServer({ UMBRIEL_PROFILE: 'readonly' });
const notepad = await umbriel.launch(['notepad.exe'], { title: 'Untitled - Notepad' }, 6000).catch(() => umbriel.launch(['notepad.exe'], { className: 'Notepad' }, 6000).catch(() => null));
try {
  await server.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wait-responsive', version: '1' } });

  // the tool is exposed under the readonly profile (read category — pure observation)
  const list = await server.call('tools/list', {});
  const names = (list.result?.tools ?? []).map((tool) => tool.name);
  assert(names.includes('wait_responsive'), 'wait_responsive IS exposed under the readonly profile (read category)');

  // a stale / never-valid handle → the DISTINCT 'no such window' error, never a false 'hung'
  const stale = await server.call('tools/call', { name: 'wait_responsive', arguments: { hWnd: 0x7ffffffe } });
  assert(stale.result?.isError === true && /no such window/.test(server.textOf(stale)), 'a stale/closed hWnd returns "no such window" (not a false hung verdict)');

  if (notepad === null) {
    assert(false, 'could not launch Notepad to prove the live-responsive path');
  } else {
    const foregroundBefore = User32.GetForegroundWindow();
    const start = Bun.nanoseconds();
    const responsive = windowResponsive(notepad.hWnd, 5000);
    const elapsedMs = (Bun.nanoseconds() - start) / 1_000_000;
    const foregroundAfter = User32.GetForegroundWindow();
    console.log(`  windowResponsive(Notepad) → ${responsive} in ${elapsedMs.toFixed(1)}ms`);
    assert(responsive === true, 'windowResponsive() returns true for a live Notepad (its thread pumps messages)');
    assert(elapsedMs < 1000, `the probe returns PROMPTLY on a healthy window (${elapsedMs.toFixed(1)}ms < 1000ms — not the full 5s timeout)`);
    assert(foregroundBefore === foregroundAfter, 'the WM_NULL probe steals NO foreground (focus-free)');

    const wire = await server.call('tools/call', { name: 'wait_responsive', arguments: { hWnd: `0x${notepad.hWnd.toString(16)}` } });
    assert(/responsive/.test(server.textOf(wire)) && wire.result?.isError !== true, 'wait_responsive over the wire reports a live window "responsive"');
  }
} finally {
  if (notepad !== null) closeWindow(notepad.hWnd);
  server.kill();
}

finish('PASS — wait_responsive probes window responsiveness via WM_NULL (read-only, focus-free, prompt); a stale handle is distinguished from a hung one.');
