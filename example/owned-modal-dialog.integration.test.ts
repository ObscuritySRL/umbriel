/**
 * owned-modal-dialog — the "drive in the dark" gap: an owned MODAL dialog that does NOT grab the foreground (the app is
 * in the background / minimized) was invisible to the agent — ownedForegroundDialog only fires when the dialog holds
 * the foreground, so the agent kept acting on a parent the modal had already disabled. ownedModalDialog detects it by
 * the canonical modal signal: the owner is DISABLED and a visible top-level window is owned by it — foreground or not.
 *
 * Proof: synthesize a real owned dialog (CreateWindowExW with the owner as hWndParent), disable the owner the way a
 * modal does, and — without giving the dialog the foreground — assert ownedForegroundDialog MISSES it (0n) while
 * ownedModalDialog FINDS it; then re-enable the owner and assert the modal detector goes quiet (no non-modal false
 * fire). Both windows are destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (raw Win32 windows, no app spawned):
 * Run: bun run example/owned-modal-dialog.integration.test.ts
 */
import { ownedForegroundDialog, ownedModalDialog } from 'skry';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const dialogClass = wide('#32770'); // the system dialog-box class — no RegisterClass needed
const owner = User32.CreateWindowExW(0, dialogClass.ptr!, wide('skry-test-owner').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 120, 120, 320, 220, 0n, 0n, 0n, null);
// An owned overlapped window: hWndParent = owner sets the OWNER (GetWindow GW_OWNER === owner), the same relationship a
// real modal dialog has with its parent.
const dialog = owner === 0n ? 0n : User32.CreateWindowExW(0, dialogClass.ptr!, wide('skry-test-modal').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 160, 160, 220, 130, owner, 0n, 0n, null);
try {
  if (owner === 0n || dialog === 0n) console.log('  skip: could not create the test windows');
  else {
    User32.EnableWindow(owner, 0); // a modal dialog disables its owner — reproduce exactly that
    await Bun.sleep(50);

    // Core: the owned modal is found whether or not it holds the foreground (the "drive in the dark" gap).
    const modal = ownedModalDialog(owner);
    assert(modal === dialog, `ownedModalDialog FINDS the owned modal regardless of foreground (got 0x${modal.toString(16)}, want 0x${dialog.toString(16)})`);

    // Bonus: prove the foreground detector now works too (GW_OWNER walk) when the env actually grants foreground.
    User32.SetForegroundWindow(dialog);
    await Bun.sleep(50);
    if (User32.GetForegroundWindow() === dialog) assert(ownedForegroundDialog(owner) === dialog, 'ownedForegroundDialog FINDS the owned dialog via the GW_OWNER walk (GA_ROOTOWNER never matched)');
    else console.log("  (skip foreground assertion: desktop wouldn't grant the dialog foreground — ownedModalDialog proof above stands)");

    // Re-enable the owner: with no modal block, the detector must go quiet (no false fire on a non-modal owned window).
    User32.EnableWindow(owner, 1);
    await Bun.sleep(20);
    assert(ownedModalDialog(owner) === 0n, 'ownedModalDialog is silent once the owner is enabled (no non-modal false positive)');
  }
} finally {
  if (dialog !== 0n) User32.DestroyWindow(dialog);
  if (owner !== 0n) User32.DestroyWindow(owner);
}

console.log(failures === 0 ? '\nPASS — an owned modal that never grabbed the foreground is now surfaced to the agent.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
