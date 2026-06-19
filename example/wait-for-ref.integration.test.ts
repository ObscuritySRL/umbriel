/**
 * wait-for-ref — wait_for now targets a control by REF, not only a selector. Before, wait_for unconditionally
 * called selectorFrom and threw "empty selector — … or target by ref" (a false promise), AND its three loops use
 * findFirstMatch (first match only) — so a control with a non-unique name/automationId (one of several identical
 * buttons) could not be waited on by the exact ref the agent holds and find_and_act {ref} acts on. Now
 * wait_for {ref, state:{…}} polls THAT exact control's live state (Element.waitForOwnState, no findFirstMatch
 * wrong-sibling hazard); {ref} without {state} gives an actionable steer instead of the misleading empty-selector.
 *
 * Proof over the real stdio MCP server against the always-present taskbar (read-only, no GUI launched, nothing to
 * close): an enabled taskbar button reaches {enabled:true} by ref; {ref} with no state steers to {state}, not
 * "empty selector".
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess only):
 * Run: bun run example/wait-for-ref.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'safe' } });
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

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wait-for-ref', version: '1' } });
  const attached = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const ref = attached.match(/Button[^\n]*?\[ref=(e\d+#\d+)\](?![^\n]*disabled)/)?.[1]; // an ENABLED taskbar button
  if (ref === undefined) console.log('  skip: no enabled Button ref in the taskbar snapshot');
  else {
    const reached = await call('tools/call', { name: 'wait_for', arguments: { ref, state: { enabled: true }, timeout: 2000 } });
    assert(reached.result?.isError !== true && /reached/.test(textOf(reached)), `wait_for {ref, state:{enabled:true}} on an enabled control resolves by REF (got: ${JSON.stringify(textOf(reached).split('\n')[0]?.slice(0, 70))})`);

    const noState = await call('tools/call', { name: 'wait_for', arguments: { ref } });
    const t = textOf(noState);
    assert(noState.result?.isError === true && /needs a \{state\}/.test(t) && !/empty selector/.test(t), `wait_for {ref} with no state steers to {state} (NOT the misleading "empty selector"): ${JSON.stringify(t.slice(0, 80))}`);
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — wait_for targets a control by ref (waits on its exact state), and {ref} without state steers honestly.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
