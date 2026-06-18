/**
 * pattern-recovery-hint — toggle/select/expand/collapse on a control that lacks the pattern must steer the agent to
 * the recovery path (inspect_element's `can:` affordance list), like set_value already does — not surface a bare
 * "element does not support XPattern" dead end.
 *
 * Proof (real MCP server, taskbar): expand a non-expandable Button → isError whose message points at inspect_element.
 *
 * bun test is broken repo-wide — runnable harness (only the MCP subprocess):
 * Run: bun run example/pattern-recovery-hint.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (m: Rpc) => void>();
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
  return new Promise((res) => pending.set(id, res));
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hint-test', version: '1' } });
  const snap = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const ref = /(?:Start|Search)"? \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
  if (ref === undefined) console.log('  skip: no taskbar button ref to exercise');
  else {
    const steer = /inspect_element \{ref\} and pick a verb from its 'can:'/;
    const expanded = await call('tools/call', { name: 'expand', arguments: { ref } });
    assert(expanded.result?.isError === true && steer.test(textOf(expanded)), "expand on a non-expandable control points the agent at inspect_element's can: list");

    // The cycle-49 additions: invoke / set_value AND find_and_act {do} must carry the SAME steer (previously a
    // bare "does not support X" dead-end). A taskbar Button has no ValuePattern → set_value exhausts and steers.
    const setVal = await call('tools/call', { name: 'set_value', arguments: { ref, value: 'x' } });
    assert(setVal.result?.isError === true && steer.test(textOf(setVal)), 'set_value on a no-ValuePattern control carries the can: steer (not a bare ValuePattern dead-end)');

    const faa = await call('tools/call', { name: 'find_and_act', arguments: { ref, do: 'set_value', text: 'x' } });
    assert(faa.result?.isError === true && steer.test(textOf(faa)), 'find_and_act {do:set_value} routes through act() and carries the can: steer too');
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — pattern-not-supported errors carry a can:-list recovery hint.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
