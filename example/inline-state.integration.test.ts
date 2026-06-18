/**
 * inline-state — live proof that snapshot refs carry their dynamic state inline, so an agent reads
 * `CheckBox "WiFi" [ref=e7] (on)` / `Edit [ref=e9] (value="…")` / `TreeItem (expanded, selected)` directly
 * instead of spending an inspect_element round-trip per ref. State rides the SAME single BuildUpdatedCache
 * round-trip (GetCachedPropertyValue), gated on Is*PatternAvailable so unsupported defaults never show.
 *
 * Asserts:
 *  GATING  — a plain Invoke button (no Toggle/Value/Expand pattern) shows NO state suffix (the key
 *            correctness point: unsupported cached state returns a DEFAULT, not empty).
 *  POSITIVE— Explorer's nav tree shows real (expanded)/(collapsed) and/or (selected) on its TreeItems.
 *  PERF    — the extra state properties cost little: report the cache-marshaling delta + total snapshot ms,
 *            confirm no blow-up.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/inline-state.integration.test.ts
 */
import { AutomationElementMode, closeWindow, ControlType, createCacheRequest, DEFAULT_CACHE_PROPERTIES, PropertyId, pruneRefTree, renderSnapshot, TreeScope, skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}
function median(run: () => void, iterations: number): number {
  for (let i = 0; i < 3; i += 1) run();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) run();
  return (Bun.nanoseconds() - start) / iterations / 1e6;
}

const STATE_IDS = [
  PropertyId.IsTogglePatternAvailable,
  PropertyId.ToggleToggleState,
  PropertyId.IsValuePatternAvailable,
  PropertyId.ValueValue,
  PropertyId.IsExpandCollapsePatternAvailable,
  PropertyId.ExpandCollapseExpandCollapseState,
  PropertyId.IsSelectionItemPatternAvailable,
  PropertyId.SelectionItemIsSelected,
  PropertyId.IsRangeValuePatternAvailable,
  PropertyId.RangeValueValue,
  PropertyId.RangeValueMinimum,
  PropertyId.RangeValueMaximum,
];

skry.initialize();
const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
const priorExplorers = new Set(
  skry
    .windows()
    .filter((window) => window.className === 'CabinetWClass')
    .map((window) => window.hWnd),
);
Bun.spawn(['explorer.exe', 'C:\\Windows\\System32\\drivers\\etc'], { stdout: 'ignore', stderr: 'ignore' }); // a tiny folder — small file list, full nav tree
await Bun.sleep(2500);
const explorerHwnd = skry.windows().find((window) => window.className === 'CabinetWClass' && !priorExplorers.has(window.hWnd))?.hWnd ?? 0n;

try {
  // GATING — Calculator has BOTH plain Invoke buttons (digits → no state) and real toggle buttons
  // (Scientific notation / Trigonometry → on/off), so it proves the gate both ways on one app.
  console.log('\n[GATING] plain buttons show no state; real toggles show (on)/(off)');
  const calcSnap = skry.snapshot(calc);
  const calcText = renderSnapshot(pruneRefTree(calcSnap.tree) ?? calcSnap.tree);
  const line = (match: RegExp): string =>
    calcText
      .split('\n')
      .find((entry) => match.test(entry))
      ?.trim() ?? '';
  const fiveLine = line(/Button "Five" \[ref=e\d+\]/);
  console.log(`  ${fiveLine}`);
  assert(fiveLine.length > 0 && !/\([a-z0-9]/.test(fiveLine), 'the plain Five digit button has NO (state) suffix — unsupported defaults are gated out');
  const togglesWithState = calcText.split('\n').filter((entry) => /Button "(Scientific notation|Trigonometry|Functions|Inverse function)"[^\n]*\((off|on)\)/.test(entry));
  for (const entry of togglesWithState) console.log(`  ${entry.trim()}`);
  assert(togglesWithState.length > 0, 'real toggle buttons DO show (off)/(on) — state appears exactly when the pattern is supported');

  // PERF — cache-marshaling delta (DEFAULT vs DEFAULT+STATE) + total snapshot ms.
  console.log('\n[PERF] cost of the extra state properties (Calculator)');
  const baseReq = createCacheRequest(DEFAULT_CACHE_PROPERTIES, TreeScope.TreeScope_Subtree, AutomationElementMode.Full);
  const stateReq = createCacheRequest([...DEFAULT_CACHE_PROPERTIES, ...STATE_IDS], TreeScope.TreeScope_Subtree, AutomationElementMode.Full);
  const baseMs = median(() => {
    const cached = calc.buildUpdatedCache(baseReq);
    if (cached.ptr !== calc.ptr) cached.release();
  }, 20);
  const stateMs = median(() => {
    const cached = calc.buildUpdatedCache(stateReq);
    if (cached.ptr !== calc.ptr) cached.release();
  }, 20);
  baseReq.release();
  stateReq.release();
  const snapMs = median(() => skry.snapshot(calc).dispose(), 15);
  console.log(`  buildUpdatedCache: DEFAULT ${baseMs.toFixed(2)} ms → DEFAULT+STATE ${stateMs.toFixed(2)} ms (Δ ${(stateMs - baseMs).toFixed(2)} ms for 12 extra props)`);
  console.log(`  full skry.snapshot (cache + walk + inline state reads): ${snapMs.toFixed(2)} ms`);
  assert(snapMs < 200, `snapshot build stays well-bounded (${snapMs.toFixed(2)} ms < 200 ms — no per-node round-trip blow-up)`);
  calcSnap.dispose();

  // POSITIVE — Explorer nav tree shows real expand/select state.
  console.log('\n[POSITIVE] Explorer nav tree carries (expanded)/(collapsed)/(selected)');
  if (explorerHwnd === 0n) {
    console.log('  (could not open Explorer — skipping the positive state assertions)');
  } else {
    const explorer = skry.attach(explorerHwnd);
    const snap = skry.snapshot(explorer);
    const text = renderSnapshot(pruneRefTree(snap.tree) ?? snap.tree);
    const stateLines = text.split('\n').filter((line) => /\[ref=e\d+\].*\((expanded|collapsed|partial|selected|on|off|value=|\d+%)/.test(line));
    console.log(`  sample state-bearing refs (${stateLines.length} total):`);
    for (const line of stateLines.slice(0, 6)) console.log(`    ${line.trim()}`);
    assert(
      stateLines.some((line) => /\((expanded|collapsed)/.test(line)),
      'at least one TreeItem shows an expand/collapse state',
    );
    assert(
      stateLines.some((line) => /\(.*selected/.test(line)),
      'at least one item shows (selected)',
    );
    snap.dispose();
    explorer.dispose();
  }
} finally {
  closeWindow(calc.hWnd);
  calc.dispose();
  if (explorerHwnd !== 0n) closeWindow(explorerHwnd);
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — inline ref state verified (gated, real expand/select state, bounded cost).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
