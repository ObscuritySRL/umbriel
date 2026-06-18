/**
 * calc-delta-stable — the headline "smallest faithful re-grounding": in steady state a Calculator digit click only
 * renames the result Text, so the action must return a compact Δ ("other refs unchanged") and the digit's ref must
 * stay valid — NOT a full re-dump that bumps the epoch and rejects the ref the agent just used. automationId-anchored
 * diff keys (diff.ts flatten) keep a sibling insert/rename from cascading every aid-bearing control's ref.
 *
 * (The FIRST digit on a fresh calc legitimately swaps Clear→Clear entry — real ref churn, a correct re-dump — so the
 * test settles past it, re-grounds, then asserts the steady-state click is a clean Δ with the ref surviving.)
 *
 * Proof: over the MCP wire, settle the calc, re-ground the Five ref, click it; the action returns a Δ delta, and the
 * SAME ref still works on the next click (not "from an earlier snapshot generation"). Calc closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Calculator):
 * Run: bun run example/calc-delta-stable.integration.test.ts
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
const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'calc-delta', version: '1' } });
  await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${calc.hWnd.toString(16)}` } });
  await Bun.sleep(400);
  const fiveOf = async (): Promise<string | undefined> => /Button "Five" \[ref=(e\d+(?:#\d+)?)\]/.exec(textOf(await call('tools/call', { name: 'desktop_snapshot', arguments: {} })))?.[1];
  // Settle past the one-time Clear→Clear entry swap (legitimate ref churn → re-dump), then re-ground.
  let five = await fiveOf();
  if (five !== undefined) await call('tools/call', { name: 'invoke', arguments: { ref: five } });
  await Bun.sleep(300);
  five = await fiveOf();
  if (five === undefined) console.log('  skip: no "Five" ref (Calculator locale/layout)');
  else {
    const click = await call('tools/call', { name: 'invoke', arguments: { ref: five } });
    const t = textOf(click);
    assert(click.result?.isError !== true, 'steady-state click on Five succeeds');
    assert(/Δ \d+ change/.test(t) && /other refs unchanged/.test(t), `a steady-state digit click returns a compact Δ delta, not a full re-dump (got: ${JSON.stringify(/(— Δ[^\n]*)/.exec(t)?.[1]?.slice(0, 60) ?? t.slice(0, 60))})`);
    // The SAME ref must still resolve — proof the result-text rename did NOT renumber/reject it.
    const again = await call('tools/call', { name: 'invoke', arguments: { ref: five } });
    assert(again.result?.isError !== true && !/earlier snapshot generation|not in the current snapshot/.test(textOf(again)), 'the SAME Five ref still works on the next click (refs survived the result-text update)');
  }
} finally {
  proc.kill();
  closeWindow(calc.hWnd);
  calc.dispose();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a result-updating click keeps refs valid and returns a compact Δ (snapshot economy restored).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
