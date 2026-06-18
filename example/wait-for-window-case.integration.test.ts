/**
 * wait-for-window-case — wait_for_window / launch_app{title} matched the title string CASE-SENSITIVELY (events.ts
 * toPredicate .includes), while attach matches case-INSENSITIVELY — so waiting on a differently-cased title (e.g.
 * 'character map' for the actual 'Character Map', or 'Save As' for 'Save as') silently TIMED OUT with no self-diagnosable
 * cause. toPredicate now lowercases both sides for the string + title-substring branches (className + RegExp untouched).
 *
 * Proof: with Character Map open, skry.waitForWindow resolves for the exact title AND a lowercase / UPPERCASE variant, all
 * to the SAME hWnd. (Pre-fix the lowercase variant timed out.) Character Map closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (the library waitForWindow path that toPredicate drives):
 * Run: bun run example/wait-for-window-case.integration.test.ts
 */
import { closeWindow, skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const charmap = await skry.launch(['charmap.exe'], { title: 'Character Map' }).catch(() => null);
try {
  if (charmap === null) console.log('  skip: Character Map did not launch');
  else {
    await Bun.sleep(600);
    const exact = await skry.waitForWindow({ title: 'Character Map' }, { timeout: 3000 }).catch(() => null);
    assert(exact !== null && exact.hWnd === charmap.hWnd, 'exact-case title resolves to the open window');

    const lower = await skry.waitForWindow({ title: 'character map' }, { timeout: 3000 }).catch(() => null);
    assert(lower !== null && lower.hWnd === charmap.hWnd, 'LOWERCASE title now resolves to the same window (was a silent timeout)');

    const upper = await skry.waitForWindow({ title: 'CHARACTER MAP' }, { timeout: 3000 }).catch(() => null);
    assert(upper !== null && upper.hWnd === charmap.hWnd, 'UPPERCASE title resolves to the same window');

    const bareString = await skry.waitForWindow('character', { timeout: 3000 }).catch(() => null);
    assert(bareString !== null && bareString.hWnd === charmap.hWnd, 'a bare lowercase substring string resolves too');

    const wrong = await skry.waitForWindow({ title: 'no such window xyzzy' }, { timeout: 600 }).catch(() => null);
    assert(wrong === null, 'a genuinely absent title still times out (no false match)');
  }
} finally {
  if (charmap !== null) {
    closeWindow(charmap.hWnd);
    charmap.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — wait_for_window title matching is case-insensitive (mirrors attach); absent titles still time out.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
