/**
 * no-match-deep-candidate — describeNoMatch truncated the candidate set to the first 20 in tree order BEFORE
 * formatNoMatch ranked them, so the relevance ranking + {nameContains} steer (shipped earlier) were silently defeated
 * on any window with >20 descendants: the relevant nearest control, if it sat past position 20, never appeared. The cap
 * is now wide (200 names) so formatNoMatch sees and ranks it; it still renders only the top 8.
 *
 * Proof (taskbar — many descendants, read-only, never closed): pick a distinctive candidate that sits BEYOND tree
 * position 20, then a no-match selector whose name contains it must surface that candidate in the "nearest" list —
 * which is impossible under the old first-20 cap.
 *
 * bun test is broken repo-wide — runnable script (UIA init + read-only taskbar attach):
 * Run: bun run example/no-match-deep-candidate.integration.test.ts
 */
import { skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
try {
  const taskbar = skry.windows({ includeUntitled: true }).find((window) => window.className === 'Shell_TrayWnd');
  if (taskbar === undefined) console.log('  skip: no taskbar (Shell_TrayWnd) found');
  else {
    const window = skry.attach(taskbar.hWnd);
    const candidates = window.findAll({});
    const names = candidates.map((candidate) => candidate.name);
    for (const candidate of candidates) candidate.release();
    const occurrences = (name: string): number => names.filter((other) => other === name).length;
    let lateName: string | undefined;
    let lateIndex = -1;
    for (let index = 21; index < names.length; index += 1) {
      if (names[index]!.trim().length >= 6 && occurrences(names[index]!) === 1) {
        lateName = names[index];
        lateIndex = index;
        break;
      }
    }
    if (lateName === undefined) console.log(`  skip: taskbar has no distinctive candidate beyond position 20 (${names.length} descendants)`);
    else {
      const message = window.describeNoMatch({ name: `${lateName} ZZZ_no_match` });
      assert(message.includes(JSON.stringify(lateName)), `a candidate at tree position ${lateIndex} (>20) surfaces in the no-match 'nearest' list (defeated by the old first-20 cap) — got: ${JSON.stringify(message.slice(0, 120))}`);
    }
    window.dispose();
  }
} finally {
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — no-match ranking sees candidates beyond tree position 20.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
