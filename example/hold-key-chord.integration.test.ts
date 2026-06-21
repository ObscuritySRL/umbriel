/**
 * hold-key-chord — holdKey (the SendInput primitive behind the hold_key tool AND the computer-use adapter) only held a
 * SINGLE key: a chord like "Control+Shift" was fed whole to keyDown→virtualKeyCode, which throws on the "+"-joined name,
 * so an Anthropic computer-use hold of a key COMBINATION (documented action shape) failed with {ok:false, unknown key}.
 * holdKey now splits the chord, validates every part BEFORE pressing any (a bad member throws with no key left stuck),
 * holds all parts for the duration, then releases in reverse order.
 *
 * Proof (no window — SendInput injects system-wide; GetAsyncKeyState reads the live physical key state, the same channel
 * the drag-stroke-modifiers test verifies through): hold "Control+Shift" → both keys read DOWN mid-hold, both UP after;
 * a single key still holds+releases (the byte-identical legacy path); a bad chord member throws and leaves NO key stuck.
 * Holding Control+Shift alone fires no shortcut, so this is desktop-safe and needs no target window or foreground.
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/hold-key-chord.integration.test.ts
 */
import User32 from '@bun-win32/user32';

import { holdKey } from '../index';
import { assert, finish } from './_harness';

const VK_CONTROL = 0x11;
const VK_SHIFT = 0x10;
const down = (vk: number): boolean => (User32.GetAsyncKeyState(vk) & 0x8000) !== 0;

// Sanity: nothing held at the start (a prior run / stuck key would invalidate the reads below).
if (down(VK_CONTROL) || down(VK_SHIFT)) console.log('  skip: a modifier was already down at start (cannot measure)');
else {
  // Chord: hold Control+Shift for 300ms; sample mid-hold (both must be down) and after release (both must be up).
  const holding = holdKey('Control+Shift', 300);
  await Bun.sleep(120);
  const midControl = down(VK_CONTROL);
  const midShift = down(VK_SHIFT);
  await holding;
  await Bun.sleep(60);
  assert(midControl && midShift, `the chord held BOTH keys down mid-hold (Control=${midControl}, Shift=${midShift})`);
  assert(!down(VK_CONTROL) && !down(VK_SHIFT), 'both chord keys released after the hold');

  // Single-key regression: the legacy path (one key held then released) is unchanged.
  const single = holdKey('Control', 200);
  await Bun.sleep(90);
  const midSingle = down(VK_CONTROL);
  await single;
  await Bun.sleep(60);
  assert(midSingle && !down(VK_CONTROL), 'a single key still holds then releases (byte-identical legacy path)');

  // A bad chord member throws BEFORE any press → no key left stuck (the pre-validation guard releases nothing because nothing was pressed).
  let threw = false;
  try {
    await holdKey('Control+Zzqx', 50);
  } catch {
    threw = true;
  }
  assert(threw && !down(VK_CONTROL), 'a bad chord member throws and leaves NO key stuck down');
}

finish('PASS — holdKey holds a chord (Control+Shift) for the duration then releases; single-key path unchanged; a bad member throws with no stuck key.');
