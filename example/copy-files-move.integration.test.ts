/**
 * copy-files-move — copy_files used to promise "copy/move" in its description AND success message, but
 * writeClipboardFiles placed ONLY CF_HDROP on the clipboard. Per Windows shell semantics a bare CF_HDROP defaults
 * to DROPEFFECT_COPY, so Ctrl+V always COPIED — a "move X into Archive" task silently left the original behind. Now
 * {move:true} also stages a "Preferred DropEffect" = DROPEFFECT_MOVE (2) format (exactly what Explorer's Cut writes),
 * so the paste MOVES; omitting move (default) stays a pure COPY (byte-identical to before).
 *
 * Proof against the REAL Windows clipboard (no app, nothing to close): move=true → CF_HDROP present AND Preferred
 * DropEffect == 2; move=false/default → CF_HDROP present, no DropEffect format; readClipboardFiles round-trips both.
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/copy-files-move.integration.test.ts
 */
import { toArrayBuffer } from 'bun:ffi';

import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

import { readClipboardFiles, writeClipboardFiles } from 'umbriel';

const CF_HDROP = 15;
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

/** The "Preferred DropEffect" DWORD currently on the clipboard, or -1 if that format is absent. */
function dropEffect(): number {
  if (User32.OpenClipboard(0n) === 0) return -2;
  try {
    const name = Buffer.from('Preferred DropEffect\0', 'utf16le');
    const id = User32.RegisterClipboardFormatW(name.ptr!);
    if (id === 0 || User32.IsClipboardFormatAvailable(id) === 0) return -1;
    const handle = User32.GetClipboardData(id);
    if (handle === 0n) return -1;
    const pointer = Kernel32.GlobalLock(handle);
    if (pointer === null) return -1;
    try {
      return new DataView(toArrayBuffer(pointer, 0, 4)).getUint32(0, true);
    } finally {
      Kernel32.GlobalUnlock(handle);
    }
  } finally {
    User32.CloseClipboard();
  }
}
function hasHdrop(): boolean {
  if (User32.OpenClipboard(0n) === 0) return false;
  try {
    return User32.IsClipboardFormatAvailable(CF_HDROP) !== 0;
  } finally {
    User32.CloseClipboard();
  }
}

const paths = ['C:\\Windows\\notepad.exe', 'C:\\Windows\\write.exe'];

writeClipboardFiles(paths, true);
assert(hasHdrop() && dropEffect() === 2, `move=true stages CF_HDROP + Preferred DropEffect=2 (DROPEFFECT_MOVE) — got HDROP=${hasHdrop()} effect=${dropEffect()}`);
assert(readClipboardFiles().length === paths.length, 'the file paths still round-trip on a move');

writeClipboardFiles(paths, false);
assert(hasHdrop() && dropEffect() === -1, `move=false stages CF_HDROP only, no DropEffect (pure COPY) — got HDROP=${hasHdrop()} effect=${dropEffect()}`);

writeClipboardFiles(paths); // default arg
assert(hasHdrop() && dropEffect() === -1, 'omitting move defaults to COPY (back-compat) — no DropEffect format');

console.log(failures === 0 ? '\nPASS — copy_files {move:true} stages a real MOVE drop effect; default stays COPY.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
