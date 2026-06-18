/**
 * launch-app-new-window — launch_app {command, title} must attach to the window THIS launch created, not to a
 * same-titled window the user already had open. The old impl did `Bun.spawn(...)` then `waitForWindow({title})`, and
 * waitForWindow returns ANY already-open substring-title match IMMEDIATELY — so with a Notepad already open,
 * launch_app attached to the STALE one while confidently reporting "launched and attached", the worst failure mode for
 * an autonomous agent (no error to recover from). The handler now snapshots already-open matches BEFORE spawning and
 * resolves only a window NOT in that set (preferring the spawned pid), so launch_app means "the window this launch made".
 *
 * Proof: pre-open a Notepad and stamp a unique marker into its document via set_value. Then launch_app {title:'Notepad'}.
 * The fix must attach to a DIFFERENT hWnd than the marked one and its snapshot must NOT carry the marker.
 *
 * Every spawned Notepad is closed in the finally. bun test is broken repo-wide — runnable harness (full profile for the
 * os category + input to stamp the marker):
 * Run: bun run example/launch-app-new-window.integration.test.ts
 */
import { closeWindow, listWindows } from 'skry';

import { assert, finish, skip, spawnServer } from './_harness';

const marker = `STALE_MARKER_${Date.now()}`;
const before = new Set(
  listWindows({ includeUntitled: true })
    .filter((window) => window.className === 'Notepad')
    .map((window) => window.hWnd),
);
const { call, kill, textOf } = spawnServer({ SKRY_PROFILE: 'full' });

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'launch-app-new-window', version: '1' } });

  // Pre-open a Notepad (the "stale" window the user already had open) and stamp a unique marker into its document.
  const seed = await call('tools/call', { name: 'launch_app', arguments: { command: 'notepad', className: 'Notepad', timeout: 8000 } });
  if (seed.result?.isError === true) {
    skip('classic Notepad (className=Notepad) not available on this host — cannot exercise the stale-window scenario');
  } else {
    const seedWindows = listWindows({ includeUntitled: true }).filter((window) => window.className === 'Notepad' && !before.has(window.hWnd));
    assert(seedWindows.length >= 1, 'the seed Notepad opened as a fresh top-level window');
    // Pull the document/edit ref out of the seed snapshot (e.g. `Document "Text editor" [ref=e1#3]`) so set_value can stamp it.
    const editRef = (textOf(seed).match(/(?:Document|Edit)[^\n]*\[ref=(e\d+#\d+)\]/) ?? [])[1];
    if (editRef === undefined) {
      skip('no Document/Edit ref in the seed Notepad snapshot — cannot stamp a marker to prove the scenario');
    } else {
      const stamp = await call('tools/call', { name: 'set_value', arguments: { ref: editRef, value: marker } });
      assert(textOf(stamp).includes(marker) || stamp.result?.isError !== true, 'stamped a unique marker into the seed Notepad document (set_value)');

      // Now launch a SECOND Notepad with the same substring title. The old impl would re-grab the marked seed window.
      const launch = await call('tools/call', { name: 'launch_app', arguments: { command: 'notepad', title: 'Notepad', timeout: 8000 } });
      assert(launch.result?.isError !== true && /attached to/.test(textOf(launch)), 'launch_app reported launched + attached');
      assert(!textOf(launch).includes(marker), 'launch_app attached to the freshly-spawned window — its snapshot does NOT carry the stale marker');
    }
  }
} finally {
  kill();
  // Close every Notepad this test created (anything not present before the test) — dispose != close; never flood the user.
  for (const window of listWindows({ includeUntitled: true })) if (window.className === 'Notepad' && !before.has(window.hWnd)) closeWindow(window.hWnd);
}

finish('PASS — launch_app attaches to the NEW window it spawned, never a stale same-titled window already open.');
