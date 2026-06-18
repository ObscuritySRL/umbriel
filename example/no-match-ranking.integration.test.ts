/**
 * no-match-ranking — two AI-digestion fixes for the "no element matched" path: (1) formatNoMatch now de-duplicates the
 * candidate names and ranks them by relevance to the requested name (substring matches first) instead of raw tree order,
 * and steers to {nameContains} when a candidate's name CONTAINS the requested exact name; (2) Element.waitFor prefixes a
 * timeout with "timed out after N ms" so the agent distinguishes a timeout from a genuinely absent match.
 *
 * Proof: a pure formatNoMatch call (deterministic) asserts ranking + dedup + the nameContains steer; a live waitFor on
 * the always-present taskbar (read-only, not closed) for a bogus selector asserts the elapsed-time prefix; a live Notepad
 * (spawned + closed) asserts a controlType:'Edit' miss now names the control types the window exposes (Document) so a cold
 * agent reaching for the universal Edit role on modern WinUI is taught the way out instead of stranded.
 *
 * bun test is broken repo-wide — runnable script:
 * Run: bun run example/no-match-ranking.integration.test.ts
 */
import { ControlType, closeWindow, formatNoMatch, skry, windowProcessId } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// 1) Pure: ranking + dedup + nameContains steer. Candidates are deliberately in a tree order that buries the relevant ones.
const message = formatNoMatch({ name: 'Save' }, 'Editor', ['Cancel', 'Open Recent', 'Save As', 'Print', 'Save As', 'Save a Copy', 'Help']);
const nearestPart = /nearest: (.*?)(?: \(a control|$)/.exec(message)?.[1] ?? '';
assert(/^"Save As", "Save a Copy"/.test(nearestPart), `relevant (substring) candidates rank first — got: ${JSON.stringify(nearestPart.slice(0, 60))}`);
assert((nearestPart.match(/"Save As"/g) ?? []).length === 1, 'duplicate candidate names are de-duplicated');
assert(/retry with \{nameContains:"Save"\}/.test(message), 'a name that only appears as a substring steers to {nameContains}');
assert(!/nearest:.*"Cancel".*"Save As"/.test(message), 'an unrelated candidate (Cancel) does not rank ahead of a substring match');

// 1b) Pure: a controlType miss with no name candidates surfaces the control types the window DOES expose (the cold-start steer).
const typeMiss = formatNoMatch({ controlType: ControlType.Edit }, 'Untitled - Notepad', [], ['Document', 'Text', 'Button']);
assert(/no controlType "Edit" here — this window exposes: Document, Text, Button/.test(typeMiss), `a controlType miss names the available types — got: ${JSON.stringify(typeMiss.slice(-90))}`);

// 2) Live: waitFor timeout carries an elapsed-time prefix (taskbar is always present; read-only, never closed).
skry.initialize();
try {
  const taskbar = skry.windows({ includeUntitled: true }).find((window) => window.className === 'Shell_TrayWnd');
  if (taskbar === undefined) console.log('  skip: no taskbar (Shell_TrayWnd) found');
  else {
    const window = skry.attach(taskbar.hWnd);
    let caught = '';
    try {
      await window.waitFor({ name: '__no_such_control_xyz__' }, { timeout: 400 });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    assert(/timed out after \d+ ms/.test(caught), `waitFor timeout is labelled with elapsed time — got: ${JSON.stringify(caught.slice(0, 60))}`);
    window.dispose();
  }

  // 3) Live: a cold agent's universal reach for controlType:'Edit' on modern Notepad (WinUI exposes Document/Text, no Edit)
  // must now be taught which types ARE here — the same wall the name-miss path already teaches. Spawn + force-kill Notepad.
  const notepad = await skry.launch(['notepad.exe'], { className: 'Notepad' });
  try {
    const editMiss = notepad.describeNoMatch({ controlType: ControlType.Edit });
    assert(/no controlType "Edit" here — this window exposes:/.test(editMiss), `Notepad's Edit miss names the available control types — got: ${JSON.stringify(editMiss.slice(0, 160))}`);
    assert(/\bDocument\b/.test(editMiss), `the steer names Document, the role that actually works on modern Notepad — got: ${JSON.stringify(editMiss.slice(-80))}`);
  } finally {
    const notepadPid = notepad.hWnd !== 0n ? windowProcessId(notepad.hWnd) : 0;
    if (notepadPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(notepadPid)]);
    notepad.dispose();
    closeWindow(notepad.hWnd);
  }
} finally {
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — no-match candidates are ranked + deduped with a nameContains steer; waitFor timeouts are labelled.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
