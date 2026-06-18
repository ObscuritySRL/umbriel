/**
 * filter-not — negated/exclusion Selector predicates (FlaUI .Not() / Playwright filter({hasNot, hasNotText})).
 *
 * The Selector could say "the Button NAMED Five" but had NO way to say its inverse — "the Button NOT named Close",
 * "the Group that does NOT contain Five", "the row that does NOT have the text X". FlaUI exposes `.Not()`; Playwright
 * `locator.filter({hasNot, hasNotText})`. Selector now carries client-side `nameNot?: RegExp | string` (reject when the
 * Name matches — exact or regex), `hasNot?: Selector` and `hasNotText?: string` (reject when a descendant matches),
 * mirroring the proven name / has / hasText machinery. nameNot rejects in matches(); hasNot/hasNotText reject in
 * element.ts subtreeMatches() (one Subtree find each, off the hot server path); compileCondition forces the client pass
 * and NEVER weakens the server AND of positives.
 *
 * Proof (drives the real Notepad tree — title-bar Buttons Close/Minimize/Settings; a formatting Pane that HAS
 *  "Bold (Ctrl+B)" but NOT "Close Tab", vs the tab-strip Pane that HAS "Close Tab"):
 *  - findAll({controlType:Button, nameNot:'Close'}) returns the buttons but EXCLUDES Close (and includes Minimize);
 *  - find({controlType:Button, name:/Close/}) with nameNot:/Close/ → null (regex negation rejects its own positive);
 *  - findAll({controlType:Pane, hasNot:{name:'Close Tab'}}) EXCLUDES the tab-strip Pane (its subtree HAS Close Tab);
 *  - findAll({controlType:Pane, hasNotText:'Close Tab'}) likewise EXCLUDES the tab-strip Pane;
 *  - and the pure layer (matches rejects on nameNot / ignores hasNot|hasNotText; needsSubtreeFilter true for both;
 *    compileCondition forces the client filter for nameNot; selectorToString renders all three) without a window.
 *
 * WITHOUT the fix every live assertion fails: nameNot/hasNot/hasNotText are unknown keys, so the selector ignores the
 * exclusion and Close survives the filter.
 *
 * bun test is broken repo-wide for FFI; runnable harness (launches + force-closes one Notepad):
 * Run: bun run example/filter-not.integration.test.ts
 */
import { automation, closeWindow, comRelease, compileCondition, ControlType, matches, needsSubtreeFilter, selectorToString, skry, windowProcessId } from 'skry';

import { assert, finish } from './_harness';

console.log('\n[1] pure layer');
const closeProps = { name: 'Close', controlType: ControlType.Button, automationId: 'Close', className: 'Button' };
assert(matches(closeProps, { controlType: ControlType.Button, nameNot: 'Minimize' }) === true, 'matches() keeps a Button whose name is NOT the excluded one');
assert(matches(closeProps, { controlType: ControlType.Button, nameNot: 'Close' }) === false, 'matches() rejects when nameNot equals the name (exact)');
assert(matches(closeProps, { controlType: ControlType.Button, nameNot: /^Clo/ }) === false, 'matches() rejects when nameNot regex matches the name');
assert(matches(closeProps, { controlType: ControlType.Button, nameNot: /^Zzz/ }) === true, 'matches() keeps when nameNot regex does not match');
// hasNot/hasNotText need the live element — matches() must IGNORE them (the caller folds them in via the subtree find).
assert(matches(closeProps, { controlType: ControlType.Button, hasNot: { name: 'whatever' } }) === true, 'matches() ignores hasNot (does not reject on it)');
assert(matches(closeProps, { controlType: ControlType.Button, hasNotText: 'whatever' }) === true, 'matches() ignores hasNotText (does not reject on it)');
assert(needsSubtreeFilter({ hasNot: { name: 'Close' } }) === true, 'needsSubtreeFilter true for { hasNot }');
assert(needsSubtreeFilter({ hasNotText: 'Close' }) === true, 'needsSubtreeFilter true for { hasNotText }');
assert(needsSubtreeFilter({ nameNot: 'Close' }) === false, 'needsSubtreeFilter false for nameNot (decided in matches(), not a subtree find)');
const rendered = selectorToString({ controlType: ControlType.Button, nameNot: 'Close', hasNot: { name: 'Five' }, hasNotText: 'pad' });
assert(/nameNot: "Close"/.test(rendered) && /hasNot: \{.*name: "Five".*\}/.test(rendered) && /hasNotText: "pad"/.test(rendered), `selectorToString renders nameNot + hasNot + hasNotText (${rendered})`);

skry.initialize();
const compiled = compileCondition(automation(), { controlType: ControlType.Button, nameNot: 'Close' });
assert(compiled.needsClientFilter === true, 'compileCondition forces needsClientFilter for a { nameNot } selector');
if (compiled.owned) comRelease(compiled.condition);

const notepad = await skry.launch(['notepad.exe'], { title: 'Untitled - Notepad' }, 8000).catch(() => skry.launch(['notepad.exe'], { className: 'Notepad' }, 8000));
try {
  let anchor = null;
  for (let attempt = 0; attempt < 50 && anchor === null; attempt += 1) {
    anchor = notepad.find({ controlType: ControlType.Button, name: 'Close' });
    if (anchor === null) Bun.sleepSync(200);
  }
  anchor?.release();
  assert(anchor !== null, 'Notepad content realized (Close button present)');

  console.log('\n[2] nameNot — exclude one button by exact name');
  const allButtons = notepad.findAll({ controlType: ControlType.Button });
  const allNames = new Set(allButtons.map((button) => button.name));
  for (const button of allButtons) button.release();
  assert(allNames.has('Close') && allNames.has('Minimize'), `baseline: Close AND Minimize are both present (${JSON.stringify([...allNames])})`);

  const notClose = notepad.findAll({ controlType: ControlType.Button, nameNot: 'Close' });
  const notCloseNames = new Set(notClose.map((button) => button.name));
  for (const button of notClose) button.release();
  assert(!notCloseNames.has('Close'), 'findAll(Button nameNot:"Close") EXCLUDES the Close button');
  assert(notCloseNames.has('Minimize'), 'findAll(Button nameNot:"Close") still INCLUDES the Minimize button (only Close is excluded)');
  assert(notClose.length < allButtons.length, `nameNot trimmed the set (${notClose.length} of ${allButtons.length})`);

  console.log('\n[3] nameNot regex — reject its own positive');
  const closeByRegex = notepad.find({ controlType: ControlType.Button, name: /^Close$/, nameNot: /^Close$/ });
  assert(closeByRegex === null, 'find(Button name:/^Close$/ nameNot:/^Close$/) → null (nameNot rejects the very element name matches)');
  closeByRegex?.release();

  console.log('\n[4] hasNot / hasNotText — exclude a Pane whose subtree CONTAINS "Close Tab"');
  const allPanes = notepad.findAll({ controlType: ControlType.Pane, has: { name: 'Close Tab' } });
  const panesWithCloseTab = allPanes.length;
  for (const pane of allPanes) pane.release();
  assert(panesWithCloseTab > 0, `baseline: at least one Pane HAS a "Close Tab" descendant (${panesWithCloseTab})`);

  const totalPanesList = notepad.findAll({ controlType: ControlType.Pane });
  const totalPanes = totalPanesList.length;
  for (const pane of totalPanesList) pane.release();

  const panesWithout = notepad.findAll({ controlType: ControlType.Pane, hasNot: { name: 'Close Tab' } });
  const withoutCount = panesWithout.length;
  // every surviving Pane must indeed LACK a Close Tab descendant
  let everyLacks = true;
  for (const pane of panesWithout) {
    const inner = pane.find({ name: 'Close Tab', controlType: ControlType.Button });
    if (inner !== null) {
      everyLacks = false;
      inner.release();
    }
    pane.release();
  }
  assert(everyLacks, 'findAll(Pane hasNot:{name:"Close Tab"}) — every surviving Pane LACKS a Close Tab descendant');
  assert(withoutCount === totalPanes - panesWithCloseTab, `hasNot is the exact complement of has (${withoutCount} = ${totalPanes} total − ${panesWithCloseTab} with)`);

  const panesWithoutText = notepad.findAll({ controlType: ControlType.Pane, hasNotText: 'Close Tab' });
  const withoutTextCount = panesWithoutText.length;
  for (const pane of panesWithoutText) pane.release();
  assert(withoutTextCount === totalPanes - panesWithCloseTab, `hasNotText:"Close Tab" is the same complement as hasNot (${withoutTextCount})`);
} finally {
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  notepad.dispose();
  if (pid) Bun.spawnSync(['taskkill', '/F', '/PID', String(pid)]);
  skry.uninitialize();
}

finish('PASS — nameNot / hasNot / hasNotText exclusion predicates drop the matching candidate and keep the rest.');
