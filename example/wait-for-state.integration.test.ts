/**
 * wait-for-state — waitForState (the Playwright expect(locator).toBeChecked()/toHaveValue()/toBeEnabled() analogue)
 * existed in the library (Element.waitForState) but the MCP/agent surface could NOT reach it: the wait_for tool only
 * branched on appear vs gone:true. This wires a `state` object into wait_for so a client can RETRY until a control
 * reaches a state instead of polling appear + re-snapshot + parse by hand.
 *
 * Proof (against a spawned Notepad — its Document "Text editor" is ALWAYS enabled, an on-any-host target the taskbar
 * StartButton was NOT): wait_for {state:{enabled:true}} on the Document RESOLVES with "reached"; {state:{enabled:false}}
 * on the same control TIMES OUT quoting the "last seen" state; an EMPTY state is REJECTED. Before the fix, state was
 * ignored — wait_for returned "matched" (appear) and never timed out on a state mismatch, so every assertion below
 * fails. The Notepad is closed in finally with closeWindow (WM_CLOSE), then force-killed by ITS OWN pid as a backstop
 * (modern WinUI Notepad survives WM_CLOSE) — taskkill /F /PID of the spawned process only, never /IM (which would
 * close a user's other Notepad tabs).
 *
 * This used to gate the headline on the taskbar StartButton + an inline assert/PASS-exit, so a host without that
 * control printed a green PASS having run ONLY the two schema-shape assertions — a vacuous PASS. It now uses _harness
 * (a fully-skipped run is INCONCLUSIVE exit 2, never a green PASS) and an on-any-host Notepad Document target.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Notepad):
 * Run: bun run example/wait-for-state.integration.test.ts
 */
import { closeWindow, windowProcessId } from 'skry';
import { assert, finish, skip, spawnServer } from './_harness';

const { call, kill, textOf } = spawnServer();
const before = new Set<bigint>();

let headlineRan = false;
let notepadHwnd = 0n;

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wait-state', version: '1' } });

  const tools = (await call('tools/list', {})).result as { tools?: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[] } | undefined;
  const waitForTool = tools?.tools?.find((tool) => tool.name === 'wait_for');
  assert(waitForTool !== undefined && waitForTool.inputSchema?.properties?.state !== undefined, 'wait_for advertises a `state` property in its inputSchema (reachable by an MCP client)');
  assert(tools?.tools?.some((tool) => tool.name === 'wait_for_state') !== true, 'there is NO separate wait_for_state tool — state lives on wait_for (tool count unchanged)');

  // Spawn a Notepad and find ITS NEW hWnd through the SAME MCP surface (list_windows), so the headline runs on any
  // host rather than depending on a particular taskbar layout. The Document "Text editor" control is always enabled.
  // before = the Notepad hWnds already open, so we attach + later kill only the one WE spawned, never a user's tab.
  for (const line of textOf(await call('tools/call', { name: 'list_windows', arguments: { includePopups: true } })).split('\n')) {
    if (!/notepad/i.test(line)) continue;
    const hWnd = /\[hWnd=0x([0-9a-f]+)\]/.exec(line)?.[1];
    if (hWnd !== undefined) before.add(BigInt(`0x${hWnd}`));
  }
  Bun.spawn(['notepad.exe'], { stdout: 'ignore', stderr: 'ignore' });
  for (let attempt = 0; attempt < 40 && notepadHwnd === 0n; attempt += 1) {
    await Bun.sleep(250);
    for (const line of textOf(await call('tools/call', { name: 'list_windows', arguments: { includePopups: true } })).split('\n')) {
      if (!/notepad/i.test(line)) continue;
      const hWnd = /\[hWnd=0x([0-9a-f]+)\]/.exec(line)?.[1];
      if (hWnd !== undefined && !before.has(BigInt(`0x${hWnd}`))) {
        notepadHwnd = BigInt(`0x${hWnd}`);
        break;
      }
    }
  }

  if (notepadHwnd === 0n) skip('could not spawn/find a Notepad window on this host');
  else {
    headlineRan = true;
    await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${notepadHwnd.toString(16)}` } });
    const selector = { controlType: 'Document' };

    // Resolve branch: the Document is always enabled → {enabled:true} reaches the state promptly.
    const reached = await call('tools/call', { name: 'wait_for', arguments: { selector, state: { enabled: true }, timeout: 3000 } });
    assert(reached.result?.isError !== true && /reached .*enabled.*true.* on /.test(textOf(reached)), `wait_for {state:{enabled:true}} RESOLVES with "reached" (got: ${JSON.stringify(textOf(reached).slice(0, 90))})`);

    // Timeout branch: the Document never becomes disabled → {enabled:false} TIMES OUT quoting the last-seen state.
    const stuck = await call('tools/call', { name: 'wait_for', arguments: { selector, state: { enabled: false }, timeout: 800 } });
    assert(stuck.result?.isError === true && /never reached|last seen/.test(textOf(stuck)), `wait_for {state:{enabled:false}} TIMES OUT with the last-seen state (got: ${JSON.stringify(textOf(stuck).slice(0, 90))})`);

    // Guard branch: an EMPTY state matches the first poll vacuously → rejected so no false "reached".
    const empty = await call('tools/call', { name: 'wait_for', arguments: { selector, state: {}, timeout: 800 } });
    assert(empty.result?.isError === true && /empty state/.test(textOf(empty)), `wait_for {state:{}} is REJECTED (got: ${JSON.stringify(textOf(empty).slice(0, 90))})`);
  }
} finally {
  kill();
  const notepadPid = notepadHwnd !== 0n ? windowProcessId(notepadHwnd) : 0;
  if (notepadHwnd !== 0n) closeWindow(notepadHwnd); // WM_CLOSE first (graceful, no save prompt — the doc is untouched)
  if (notepadPid !== 0) Bun.spawnSync(['taskkill', '/F', '/PID', String(notepadPid)]); // backstop: WinUI Notepad survives WM_CLOSE
}

// The two schema-shape assertions ALWAYS run, so finish() alone would print the headline PASS even on a host that
// skipped the resolve/timeout/empty-state branches — exactly the vacuous PASS this file used to ship. Gate the
// headline message on the branches having actually executed: a skipped headline is INCONCLUSIVE (exit 2), not green.
if (!headlineRan) {
  console.log('\nINCONCLUSIVE — schema shape checked but the resolve/timeout/empty-state branches were skipped (no Notepad)');
  process.exit(2);
}
finish('PASS — wait_for reaches a control STATE (resolve / timeout / empty-state-guard) through the MCP surface.');
