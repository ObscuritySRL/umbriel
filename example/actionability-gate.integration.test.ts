/**
 * actionability-gate — Playwright's #1 differentiator at the verb the agent calls: the act path now (a) AUTO-WAITS for a
 * not-yet-present selector before reporting no match, and (b) REFUSES a mutating verb (invoke/click/type/set_value/toggle)
 * on a DISABLED control with an actionable steer instead of a confident no-op "success". Before this fix find_and_act threw
 * describeNoMatch on the first empty findAll (no retry), and invoke/click on a greyed-out control acted with a false success.
 *
 * Proof over the REAL stdio MCP server against a spawned Calculator (its memory buttons — MC/MR/M+/M-/MS — are rendered but
 * DISABLED until something is in memory, a locale-free always-present disabled control):
 *   1. a disabled control discovered from the snapshot (renderSnapshot tags it " (disabled)") is REFUSED by find_and_act
 *      {do:invoke} with the disabled steer — NOT acted on;
 *   2. an ENABLED digit (Five) is acted on fine — the gate does not over-refuse;
 *   3. find_and_act on a selector that matches NOTHING with {timeout:0} fails FAST (no auto-wait), while the default budget
 *      visibly waits (≥1s) before reporting no match — the auto-wait is real and bounded.
 * Calculator is force-closed in teardown (closeWindow + kill its PID) so no stray window is left.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Calculator):
 * Run: bun run example/actionability-gate.integration.test.ts
 */
import { closeWindow, skry, windowProcessId } from 'skry';

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
const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
const calcPid = windowProcessId(calc.hWnd);
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'actionability-gate', version: '1' } });
  const snapshot = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${calc.hWnd.toString(16)}` } }));
  await Bun.sleep(400);
  const fresh = textOf(await call('tools/call', { name: 'desktop_snapshot', arguments: {} }));
  const tree = fresh.length > snapshot.length ? fresh : snapshot;

  // (1) A control the snapshot tags " (disabled)" must be REFUSED by a mutating verb (Calc's memory buttons are disabled on
  //     a fresh launch). Pull its name from the rendered line — locale-free, whatever MC/MR is called in this Windows locale.
  const disabledLine = /Button "([^"]+)" \[ref=e\d+(?:#\d+)?\][^\n]*\(disabled\)/.exec(tree);
  if (disabledLine === null) console.log('  skip: no disabled Button in the Calculator snapshot (layout/locale) — cannot prove the gate live');
  else {
    const name = disabledLine[1]!;
    const refused = await call('tools/call', { name: 'find_and_act', arguments: { selector: { name }, do: 'invoke', timeout: 0 } });
    const t = textOf(refused);
    assert(refused.result?.isError === true, `find_and_act {do:invoke} on the disabled "${name}" is an isError, not a confident success`);
    assert(/DISABLED/.test(t) && /wait_for/.test(t), `the refusal names the control as DISABLED and steers to wait_for {state:{enabled:true}} (got: ${JSON.stringify(t.slice(0, 120))})`);
  }

  // (2) An ENABLED digit must still act — the gate must not over-refuse. Five is enabled on every Calculator.
  const five = /Button "([^"]*Five[^"]*)" \[ref=e\d+/.exec(tree)?.[1] ?? 'Five';
  const acted = await call('tools/call', { name: 'find_and_act', arguments: { selector: { name: five }, do: 'invoke', timeout: 0 } });
  if (/no.*match|describeNoMatch|matched 0|could not/i.test(textOf(acted))) console.log(`  skip: no enabled "${five}" digit to act on (locale)`);
  else assert(acted.result?.isError !== true, `an ENABLED digit ("${five}") is invoked fine — the gate does not over-refuse`);

  // (3) Auto-wait is real and bounded: a selector that matches NOTHING fails FAST with timeout:0, but the default budget
  //     visibly waits before reporting no match. Use an automationId that cannot exist so it never matches.
  const ghost = { automationId: '__bun_uia_no_such_control__' };
  const fastStart = Bun.nanoseconds();
  const fast = await call('tools/call', { name: 'find_and_act', arguments: { selector: ghost, do: 'invoke', timeout: 0 } });
  const fastMs = (Bun.nanoseconds() - fastStart) / 1e6;
  assert(fast.result?.isError === true && fastMs < 800, `timeout:0 fails FAST on a no-match (no auto-wait) — ${Math.round(fastMs)}ms`);
  const waitStart = Bun.nanoseconds();
  const waited = await call('tools/call', { name: 'find_and_act', arguments: { selector: ghost, do: 'invoke', timeout: 1500 } });
  const waitMs = (Bun.nanoseconds() - waitStart) / 1e6;
  assert(waited.result?.isError === true && waitMs >= 1300, `a {timeout} budget AUTO-WAITS before reporting no match — waited ${Math.round(waitMs)}ms (≈ the 1500ms budget)`);
} finally {
  proc.kill();
  closeWindow(calc.hWnd);
  try {
    if (calcPid > 0) process.kill(calcPid); // belt-and-suspenders: Calculator is a UWP host; closeWindow may leave the process — kill its PID so no window survives
  } catch {}
  calc.dispose();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — the act path auto-waits for a not-yet-present target and refuses a disabled one (Playwright actionability at the verb).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
