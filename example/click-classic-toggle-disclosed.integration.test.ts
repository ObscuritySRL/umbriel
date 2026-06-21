/**
 * click-classic-toggle-disclosed — the MCP `click` tool's cursor-free fallback ran element.invoke()/toggle()/select()
 * RAW (clickElement), so on a classic own-HWND control (whose UIA pattern routes through the MSAA bridge's SetFocus and
 * STEALS foreground) it reported a flat "(cursor-free)" — while the dedicated invoke/toggle/select VERBS disclose that
 * steal via disclosingPatternAct. clickElement now routes those three acts through disclosingPatternAct too, so a `click`
 * that moves the foreground says so (⚠), at exact parity with the verbs; a no-steal control stays byte-identical.
 *
 * Proof (deterministic, synthetic): a classic BS_AUTOCHECKBOX (class "BUTTON", own HWND, TogglePattern but no Invoke) in
 * a MINIMIZED popup. Drive the MCP `click` tool on its ref: the checkbox MUST actually toggle (BM_GETCHECK flips), the
 * parent MUST stay minimized (never raised — the parity claim), and WHEN the act moves foreground to the checkbox's OWN
 * HWND (the bridge wall) the result MUST carry the ⚠ disclosure (not a bare "cursor-free"). Window DestroyWindow'd in
 * teardown (dispose≠close — no leak).
 *
 * bun test is broken repo-wide — runnable harness (synthetic classic checkbox + spawned MCP server):
 * Run: bun run example/click-classic-toggle-disclosed.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

import { spawnServer, type Rpc } from './_harness';

const WS_POPUP = 0x8000_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_CAPTION = 0x00c0_0000;
const WS_TABSTOP = 0x0001_0000;
const BS_AUTOCHECKBOX = 0x0003;
const BM_GETCHECK = 0x00f0;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

const msg = Buffer.alloc(48);
function pump(): void {
  for (let i = 0; i < 256; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break;
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}
const checked = (hWnd: bigint): bigint => User32.SendMessageW(hWnd, BM_GETCHECK, 0n, 0n);

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('ClickDiscloseParent').ptr!, WS_POPUP | WS_CAPTION | WS_VISIBLE, 200, 200, 280, 120, 0n, 0n, BigInt(hInstance), null);
const checkbox = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('BUTTON').ptr!, wide('Enable feature').ptr!, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX, 15, 20, 240, 28, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);
const server = spawnServer({ UMBRIEL_PROFILE: 'safe' });
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

try {
  await server.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'click-disclose', version: '1' } });
  if (parent === 0n || checkbox === 0n) console.log('  skip: could not create the synthetic classic checkbox');
  else {
    // Attach to the checkbox's OWN hWnd (a classic BUTTON has its own HWND) — its cross-process child does not always
    // enumerate under the synthetic dialog, but ElementFromHandle on the control itself resolves it as the snapshot root.
    const snap = textOf(await server.call('tools/call', { name: 'attach', arguments: { hWnd: `0x${checkbox.toString(16)}` } }));
    const ref = /CheckBox[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log(`  skip: no checkbox ref in the synthetic snapshot (${JSON.stringify(snap.slice(0, 120))})`);
    else {
      User32.ShowWindow(parent, SW_MINIMIZE);
      await Bun.sleep(250);
      pump();
      assert(User32.IsIconic(parent) !== 0, 'parent popup is minimized before the click');
      const before = User32.GetForegroundWindow();
      const wasChecked = checked(checkbox);

      const result = await server.call('tools/call', { name: 'click', arguments: { ref } });
      await Bun.sleep(200);
      pump();
      const text = textOf(result);
      const after = User32.GetForegroundWindow();
      console.log(`  click -> ${JSON.stringify(text.split('\n')[0])}`);

      assert(/\(cursor-free/.test(text), 'click reports the cursor-free pattern act (prefix intact)');
      assert(checked(checkbox) !== wasChecked, 'the checkbox ACTUALLY toggled (BM_GETCHECK flipped) — not a silent no-op');
      assert(User32.IsIconic(parent) !== 0, 'the parent popup STAYS minimized (the act never raised the app window — the parity claim)');
      // The honest outcome: foreground unchanged, OR moved only to the checkbox's OWN HWND (the bridge wall). When it
      // moved (the steal), the result MUST disclose it — the exact gap this fix closes.
      if (after === checkbox) {
        assert(/⚠/.test(text) && /raised\/focused/.test(text), 'click DISCLOSES the foreground steal to the checkbox own HWND (⚠) — parity with the toggle/select verbs, not a bare cursor-free claim');
      } else if (after === before) {
        assert(!/⚠/.test(text), 'no foreground steal occurred → the result is byte-identical (no ⚠ note)');
      } else {
        console.log(`  note: foreground moved elsewhere (before=0x${before.toString(16)} after=0x${after.toString(16)}) — not the checkbox HWND; disclosure presence=${/⚠/.test(text)}`);
      }
    }
  }
} finally {
  clearInterval(ticker);
  server.kill();
  if (parent !== 0n) User32.ShowWindow(parent, SW_RESTORE);
  if (checkbox !== 0n) User32.DestroyWindow(checkbox);
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — the MCP click tool discloses the foreground steal on a classic own-HWND control (parity with the toggle/select verbs); the act lands and never raises the parent.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
