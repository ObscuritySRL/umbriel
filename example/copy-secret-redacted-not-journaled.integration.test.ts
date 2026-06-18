/**
 * copy-secret-redacted-not-journaled — the clipboard secret-redaction floor read_clipboard advertises must be
 * PATH-INDEPENDENT: copy / cut / press_key Ctrl+C echo the clipboard too, and that echo also becomes the on-disk
 * SKRY_TRACE observation. A copied AWS-key shape (AKIA…) must come back «redacted» from EVERY clipboard-reflecting
 * tool — not just read_clipboard — and must NOT be persisted verbatim into the trace JSONL. Without this an agent under
 * prompt-injection deterministically chooses `copy {ref}` over `read_clipboard` to defeat the masking floor.
 *
 * Proof: spawn Notepad, minimize it (forces a fresh re-grounded snapshot), type an AKIA… secret into its Edit
 * cursor-free, select it with find_text, then copy {ref} and cut {ref} over the MCP wire. Asserts each result returns
 * «redacted» (NOT the raw key) AND the trace journal's observations never contain the secret. Skips on a WinUI Notepad
 * with no per-control HWND. Teardown clears the modify flag, kills the Notepad, and removes the trace file.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Notepad):
 * Run: bun run example/copy-secret-redacted-not-journaled.integration.test.ts
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import User32 from '@bun-win32/user32';
import { closeWindow, skry, windowProcessId } from 'skry';
import { assert, finish, skip, spawnServer } from './_harness';

const EM_SETMODIFY = 0x00b9;
const SECRET = 'AKIAIOSFODNN7EXAMPLE'; // an AWS access-key-id shape the default redaction masks
const tracePath = join(tmpdir(), `skry-copyredact-${process.pid}-${Date.now()}.jsonl`);
await rm(tracePath, { force: true });

const { call, kill, textOf } = spawnServer({ SKRY_PROFILE: 'safe', SKRY_TRACE: tracePath });
// The current-generation Edit/Document ref from a FRESH snapshot (a no-change delta carries no refs — only re-extract
// when the tree actually re-grounded). The probed ref is then REUSED across type/find_text/copy/cut without an
// intervening snapshot, which would otherwise bump the generation and stale the ref.
const editRef = async (): Promise<string | undefined> => {
  const snap = textOf(await call('tools/call', { name: 'desktop_snapshot', arguments: {} }));
  return /(?:Document|Edit|Text)[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i.exec(snap)?.[1];
};

skry.initialize();
const notepad = await skry.launch(['notepad.exe'], { className: 'Notepad' });
const editor = notepad.find({ controlType: 50004 /* Edit */ }) ?? notepad.find({ controlType: 50030 /* Document */ });
const editHwnd = editor?.nativeWindowHandle ?? 0n;
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'copy-redact', version: '1' } });
  await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${notepad.hWnd.toString(16)}` } });
  await call('tools/call', { name: 'manage_window', arguments: { hWnd: `0x${notepad.hWnd.toString(16)}`, action: 'minimize' } });
  await Bun.sleep(300);
  const ref = await editRef();
  if (ref === undefined) skip('no Edit/Document ref in the snapshot — text-control path N/A');
  else {
    // Overwrite any session-restored text so the secret is the ONLY content (a restored title bleeding into the
    // post-action snapshot would otherwise mask whether the COPY/CUT echo itself leaked).
    await call('tools/call', { name: 'press_key', arguments: { ref, key: 'Control+A' } });
    await Bun.sleep(80);
    await call('tools/call', { name: 'type', arguments: { ref, text: SECRET } });
    await Bun.sleep(150);
    const selected = textOf(await call('tools/call', { name: 'find_text', arguments: { ref, text: SECRET } }));
    if (!/selected/i.test(selected)) skip('the control did not honor find_text selection — copy/cut echo path N/A');
    else {
      // Take only the FIRST line of each result (the tool's own echo) — a withSnapshot result appends a tree whose
      // window title may carry restored session text, which is not the clipboard echo under test.
      const echo = (text: string): string => text.split('\n', 1)[0] ?? '';
      const copied = echo(textOf(await call('tools/call', { name: 'copy', arguments: { ref } })));
      assert(!copied.includes(SECRET) && /«redacted»/.test(copied), `copy {ref} MASKS the AKIA… secret instead of echoing it (got: ${JSON.stringify(copied.slice(0, 60))})`);

      const cut = echo(textOf(await call('tools/call', { name: 'cut', arguments: { ref } })));
      assert(!cut.includes(SECRET) && /«redacted»/.test(cut), `cut {ref} MASKS the AKIA… secret in its cursor-free echo (got: ${JSON.stringify(cut.slice(0, 60))})`);

      await Bun.sleep(250); // let the trace appendFile flush every observation
      const trace = await Bun.file(tracePath)
        .text()
        .catch(() => '');
      // The journal `observation` is the result's first line (traceCall slices it). The copy/cut observations — the
      // echo this slice fixes — must be «redacted», never the verbatim secret. (find_text echoes the AGENT-SUPPLIED
      // search term, a separate concern outside the clipboard-echo floor; assert only the copy/cut observations here.)
      const observations = trace
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { tool?: string; observation?: string })
        .filter((entry) => entry.tool === 'copy' || entry.tool === 'cut');
      assert(
        observations.length >= 2 && observations.every((entry) => !(entry.observation ?? '').includes(SECRET) && /«redacted»/.test(entry.observation ?? '')),
        `the copy/cut TRACE observations are «redacted», never the verbatim secret (got: ${JSON.stringify(observations.map((entry) => entry.observation))})`,
      );
    }
  }
} finally {
  const notepadPid = notepad.hWnd !== 0n ? windowProcessId(notepad.hWnd) : 0;
  if (notepadPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(notepadPid)]);
  if (editHwnd !== 0n) User32.SendMessageW(editHwnd, EM_SETMODIFY, 0n, 0n);
  kill();
  editor?.release();
  notepad.dispose();
  closeWindow(notepad.hWnd);
  skry.uninitialize();
  await rm(tracePath, { force: true });
}

finish('PASS — copy / cut mask a copied AKIA secret AND never journal it verbatim (the redaction floor is path-independent).');
