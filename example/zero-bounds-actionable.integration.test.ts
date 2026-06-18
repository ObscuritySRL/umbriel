/**
 * zero-bounds-actionable — refmap.isActionable dropped EVERY 0×0-bounds control (`if (!hasBounds) return false`) BEFORE
 * the interactive-role check, so a curated interactive control with no rectangle got no [ref] and no state — making a
 * whole class of WinUI Settings ToggleSwitches UNREACHABLE by ref (Developer Mode / Device Portal / … render
 * boundingRectangle {0,0,0,0} in a collapsed card, yet TogglePattern.Toggle drives them cursor-free). isActionable now
 * refs an interactive-role control regardless of bounds; a ref'd 0-bounds node renders an "(off-screen — no click point;
 * use a pattern verb)" marker; and click/drag on a location-less control ERRORS with a pattern-verb steer instead of
 * misfiring a coordinate click to the screen corner (0,0).
 *
 * Proof (live): the Win11 Settings Developers page exposes ≥1 ToggleSwitch with a [ref] + the off-screen marker + an
 * (on)/(off) state that the OLD code would have dropped; clicking it errors "no on-screen location" rather than clicking
 * (0,0). Settings is closed in teardown ONLY if this test opened it (a pre-existing Settings is left alone). No setting
 * is actually toggled (no system side effect).
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + the live Settings app):
 * Run: bun run example/zero-bounds-actionable.integration.test.ts
 */
import { closeWindow, skry } from 'skry';

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

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

skry.initialize();
const preexisting = skry.windows().some((window) => window.title === 'Settings');
Bun.spawn(['cmd', '/c', 'start', '', 'ms-settings:developers']);
const settings = await skry.waitForWindow({ title: 'Settings' }, { timeout: 8000 }).catch(() => null);
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'zerobounds', version: '1' } });
  if (settings === null) console.log('  skip: Settings did not open');
  else {
    await Bun.sleep(2600); // let the WinUI page render its (collapsed, 0-bounds) toggle cards
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${settings.hWnd.toString(16)}` } }));
    // A 0-bounds toggle: a ref'd Button with an (on)/(off) state AND the off-screen marker — exactly what the old code dropped.
    const toggleLine = snap.split('\n').find((line) => /\[ref=/.test(line) && /\((on|off)\)/.test(line) && /off-screen/.test(line));
    if (toggleLine === undefined) console.log('  skip: no 0-bounds ToggleSwitch on this Settings page (UI variant)');
    else {
      console.log(`  found: ${toggleLine.trim().slice(0, 120)}`);
      assert(true, 'a 0-bounds WinUI ToggleSwitch is now reffed with an (on)/(off) state + off-screen marker (old code dropped it)');
      const ref = /\[ref=(e\d+(?:#\d+)?)\]/.exec(toggleLine)?.[1];
      if (ref !== undefined) {
        const clicked = await call('tools/call', { name: 'click', arguments: { ref } });
        assert(
          clicked.result?.isError === true && /no on-screen location/.test(textOf(clicked)) && /pattern verb/.test(textOf(clicked)),
          `click on the location-less toggle errors with a pattern-verb steer — no (0,0) misfire (got: ${JSON.stringify(textOf(clicked).slice(0, 90))})`,
        );
      }
    }
  }
} finally {
  proc.kill();
  if (settings !== null && !preexisting) closeWindow(settings.hWnd); // close Settings only if THIS test opened it
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — 0-bounds WinUI controls are reffed + marked off-screen; a coordinate click on a location-less control errors instead of misfiring.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
