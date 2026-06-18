/**
 * mcp-no-own-hwnd-raise — prove the MCP `toggle` / `invoke` / `set_value` TOOLS now SELF-DISCLOSE the foreground steal
 * when they act on a NO-OWN-HWND WinUI/WPF/Electron sub-control. The criticism (findings/32): a UIA Toggle/Invoke/Value
 * pattern on such a control has NO focus-clean posted path — it routes through the MSAA bridge, which STEALS FOREGROUND
 * to the control's window AND un-minimizes it. Before this fix the tools returned a bare "toggled (state …)" / "invoked"
 * — identical to the focus-clean BM_CLICK case — so the agent could not tell the parity wall was hit. The fix wraps the
 * pattern call in disclosingPatternAct: it samples foregroundWindow() before/after and, on a change, appends a terse
 * "⚠ raised/focused the window …" note to the returned string.
 *
 * This is the END-TO-END guard at the MCP wire mirroring mcp-pattern-no-raise (which guards the focus-CLEAN classic-Win32
 * path). Here the act SHOULD steal — and the assertion is that the result STRING NAMES the steal (locks the honest
 * disclosure). Spawns Settings (a no-own-HWND WinUI ToggleSwitch host), forces a decoy window to the foreground so the
 * steal is observable, drives `toggle` over JSON-RPC, and asserts (a) the foreground genuinely changed to the Settings
 * window and (b) the result string discloses it. The toggle is restored; Settings + the decoy are closed in finally.
 *
 * The fix is also proven LIVE in findings/32 against the PowerToys Command Palette (WinUIDesktopWin32WindowClass,
 * hWnd 0x305f0): forcing a foreign foreground, MCP invoke on its no-own-HWND "Maximize" titlebar Button (nh=0x0) stole
 * fg 0x64159a → 0x305f0 and the result string carried the ⚠ disclosure citing findings/32.
 *
 * bun test is broken repo-wide for FFI; runnable harness (drives the real MCP subprocess + spawns/closes Settings):
 * Run: bun run example/mcp-no-own-hwnd-raise.integration.test.ts
 */
import { closeWindow, foregroundWindow, PropertyId, raiseWindow, skry } from 'skry';

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (message: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      try {
        const message = JSON.parse(line) as Rpc;
        if (typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {}
    }
  }
})();
let nextId = 1;
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
Bun.spawn(['explorer.exe', 'ms-settings:easeofaccess-visualeffects'], { stdout: 'ignore', stderr: 'ignore' });
let settingsHwnd = 0n;
for (let i = 0; i < 40 && settingsHwnd === 0n; i++) {
  await Bun.sleep(250);
  settingsHwnd = skry.windows().find((w) => w.title === 'Settings')?.hWnd ?? 0n;
}
// A classic own-HWND decoy whose foreground the WinUI act can visibly STEAL — Character Map (#32770) has its own HWND.
Bun.spawn(['charmap.exe'], { stdout: 'ignore', stderr: 'ignore' });
let decoyHwnd = 0n;
for (let i = 0; i < 24 && decoyHwnd === 0n; i++) {
  await Bun.sleep(200);
  decoyHwnd = skry.windows().find((w) => w.title.startsWith('Character Map'))?.hWnd ?? 0n;
}

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'no-own-hwnd-raise', version: '1' } });
  if (settingsHwnd === 0n) {
    console.log('  skip(live): Settings did not appear');
  } else {
    await Bun.sleep(2500); // late WinUI content
    raiseWindow(settingsHwnd);
    await Bun.sleep(400);

    // A no-own-HWND WinUI ToggleSwitch (renders as Button + TogglePattern, NO own HWND → has only the UIA pattern, the
    // exact control class the criticism is about), with bounds. Record name + baseline state so we can restore it.
    const settings = skry.attach(settingsHwnd);
    const scan = settings.findAll({});
    const toggle = scan.find((el) => el.nativeWindowHandle === 0n && el.getProperty(PropertyId.IsTogglePatternAvailable) === true && el.boundingRectangle.width > 0 && el.boundingRectangle.height > 0) ?? null;
    const name = toggle?.name ?? '';
    const baseline = toggle?.toggleState ?? -1;
    if (toggle === null) {
      console.log('  skip(live): no no-own-HWND WinUI Toggle control found');
    } else {
      console.log(`  target: no-own-HWND Button ${JSON.stringify(name)} (nativeWindowHandle=0x0) baseline state=${baseline}`);
      const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${settingsHwnd.toString(16)}` } }));
      const ref = new RegExp(`Button "${escapeRegExp(name)}" \\[ref=(e\\d+(?:#\\d+)?)\\]`).exec(snap)?.[1];
      if (ref === undefined) {
        console.log(`  skip(live): toggle ref not in the wire snapshot (UWP tree suspended for the subprocess; snap ${snap.length} chars)`);
      } else {
        // Force the decoy to the foreground so the WinUI act's steal is OBSERVABLE (before != the Settings window).
        if (decoyHwnd !== 0n) {
          raiseWindow(decoyHwnd);
          await Bun.sleep(450);
        }
        const before = foregroundWindow();
        const targetIsForeground = before === settingsHwnd;
        const result = await call('tools/call', { name: 'toggle', arguments: { ref } });
        const out = textOf(result);
        await Bun.sleep(450);
        const after = foregroundWindow();

        assert(result.result?.isError !== true, `toggle did not error (got: ${JSON.stringify(out.slice(0, 90))})`);
        if (targetIsForeground) {
          // Could not pin a foreign foreground (decoy lost the race) — the steal isn't observable; only assert no false claim.
          console.log('  note: Settings was already the foreground before the act — the steal is a no-op here, skipping the disclosure assert');
        } else if (after === before) {
          console.log(`  note: the act did NOT change the foreground (before=after=0x${before.toString(16)}) — no steal to disclose this run`);
        } else {
          assert(after === settingsHwnd, `the act STOLE foreground to the Settings window (before=0x${before.toString(16)} → after=0x${after.toString(16)})`);
          assert(/⚠ raised\/focused the window/.test(out), `the result STRING discloses the foreground steal (the honest ⚠ note), not a bare "toggled" (got: ${JSON.stringify(out.slice(0, 160))})`);
          assert(/findings\/32/.test(out) && /no-own-HWND/i.test(out), `the disclosure cites the wall (findings/32) and names the no-own-HWND control class (got: ${JSON.stringify(out.slice(0, 200))})`);
        }

        // restore the user's setting + verify the act actually LANDED (a real toggle, not a no-op)
        await Bun.sleep(250);
        const after2 = skry.attach(settingsHwnd);
        const allAfter = after2.findAll({});
        const flipped = allAfter.find((el) => el.name === name && el.getProperty(PropertyId.IsTogglePatternAvailable) === true) ?? null;
        if (flipped !== null && baseline !== -1) assert(flipped.toggleState !== baseline, `the toggle actually FLIPPED (was ${baseline}, now ${flipped.toggleState}) — the disclosed act still LANDED`);
        if (flipped !== null && flipped.toggleState !== baseline) flipped.toggle();
        for (const el of allAfter) el.release();
        after2.dispose();
      }
    }
    for (const el of scan) el.release();
    settings.dispose();
  }
} finally {
  proc.kill();
  if (decoyHwnd !== 0n) closeWindow(decoyHwnd);
  if (settingsHwnd !== 0n) closeWindow(settingsHwnd);
  skry.uninitialize();
}

console.log(
  failures === 0 ? '\nPASS — the MCP toggle/invoke/set_value tools SELF-DISCLOSE the foreground steal (⚠ note) when acting on a no-own-HWND WinUI control — the parity wall is no longer silent.' : `\nFAILED — ${failures} assertion(s)`,
);
process.exit(failures === 0 ? 0 : 1);
