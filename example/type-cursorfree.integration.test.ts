/**
 * type-cursorfree — the computer-use `type` / `key` / `hold_key` actions ignored the cursorless option and ALWAYS used
 * SendInput (system focus), unlike every click/scroll verb (which honor cursorless and post messages). So a client
 * driving via dispatch() could not type / press a key cursor-free even though input.ts already exports postText /
 * postKey / postHoldKey (the same primitives the MCP type/press_key tools use). dispatch() now mirrors that path:
 * when cursorless and the FOCUSED control (or its nearest window-owning ancestor) owns a real HWND it POSTS WM_CHAR /
 * WM_KEYDOWN to it (cursor-free), and only falls to SendInput otherwise. With cursorless:false the contract is unchanged.
 *
 * CUA key/type semantically target AMBIENT (global) keyboard focus — there is NO element ref — and UIA's
 * GetFocusedElement is system-global. A background test process cannot legitimately steal global focus
 * (SetForegroundWindow is blocked by the OS foreground lock), and posting real text/keys to whatever DOES own focus
 * would inject into the user's foreground app. So this proves the routing without injecting anything:
 *   • a cursorless `type` of the EMPTY string posts ZERO WM_CHARs yet still takes the cursor-free branch (postText
 *     returns true for a non-zero HWND) — reported "(cursor-free)" only WITH the fix (old code unconditionally
 *     SendInput'd and never said cursor-free), and the real mouse never moves; gated on the ambient focus owning an
 *     HWND (read-only probe), since a HWND-less focus correctly falls back.
 *   • a cursorless:false `type` reports the SendInput path (the unchanged fallback contract) — and SendInput with no
 *     foregrounded editor is a harmless no-op.
 * Nothing is spawned and nothing is typed into any window.
 *
 * bun test is broken repo-wide — runnable script:
 * Run: bun run example/type-cursorfree.integration.test.ts
 */
import { dispatch, focused, ownerHwnd, skry } from 'skry';
import User32 from '@bun-win32/user32';

const cursor = (): { x: number; y: number } => {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
};

/** The HWND that owns the ambient keyboard focus (read-only — exactly what dispatch's cursor-free routing consults), or 0n. */
function ambientFocusHandle(): bigint {
  try {
    const element = focused();
    try {
      return ownerHwnd(element);
    } finally {
      element.release();
    }
  } catch {
    return 0n;
  }
}

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
// dispatch() needs a Window; the `type` action never reads it. Attach (read-only) to whatever is ALREADY foreground —
// nothing is spawned, shown, or focus-stolen.
const foreground = User32.GetForegroundWindow();
const window = skry.attach(foreground !== 0n ? foreground : 'Program Manager');
try {
  const focusHandle = ambientFocusHandle();
  console.log(`  ambient focus owner -> 0x${focusHandle.toString(16)}`);

  // cursorless:false ALWAYS uses SendInput — proves the default contract is preserved as the fallback (posts nothing
  // into a foreground editor here, so it is a harmless no-op). Empty text keeps even the SendInput path a no-op.
  const fallback = await dispatch(window, { action: 'type', text: '' }, { cursorless: false });
  console.log(`  type cursorless:false -> ${JSON.stringify(fallback.output ?? fallback.error)}`);
  assert(fallback.ok && !/cursor-free/.test(fallback.output ?? ''), `cursorless:false type uses SendInput (no "cursor-free") — fallback contract intact (got: ${JSON.stringify(fallback.output ?? fallback.error)})`);

  if (focusHandle === 0n) {
    console.log('  skip(live): ambient focus owns no HWND on this desktop — the cursor-free posted path correctly falls back; cannot assert cursor-free here without a postable focus');
  } else {
    const before = cursor();
    const typed = await dispatch(window, { action: 'type', text: '' }, { cursorless: true }); // empty → posts ZERO chars, injects nothing
    const after = cursor();
    console.log(`  type cursorless:true  -> ${JSON.stringify(typed.output ?? typed.error)}`);
    assert(typed.ok && /cursor-free/.test(typed.output ?? ''), `cursorless type to an own-HWND focus is reported cursor-free — the posted path, not SendInput (got: ${JSON.stringify(typed.output ?? typed.error)})`);
    assert(Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2, `the cursor-free type never moved the real mouse (before ${before.x},${before.y} → after ${after.x},${after.y})`);
  }
} finally {
  window.release();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — type honors cursorless (posted-message routing when focus owns an HWND, SendInput fallback intact, real mouse unmoved).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
