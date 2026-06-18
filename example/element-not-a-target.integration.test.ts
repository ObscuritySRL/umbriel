/**
 * element-not-a-target — the `element` field appears on 23 tool schemas but is read by ZERO handlers (it is only a
 * label for the permission prompt). An LLM that targeted via natural-language `element` (no ref/selector) hit a generic
 * "empty selector" / "missing ref" error that never named the trap, and looped on the wrong field. ELEMENT_DESC now
 * states it is non-targeting, and find_and_act/reveal throw a self-correcting steer that names the trap.
 *
 * Proof (no window needed — the guard fires before attach): find_and_act / reveal with only `element` (no ref, no
 * selector) error with a message that calls out `element` as a label and points to ref/selector; tools/list ELEMENT_DESC
 * says it does NOT select; a real {selector}/{ref} path is unaffected.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess, no spawned windows):
 * Run: bun run example/element-not-a-target.integration.test.ts
 */
type Tool = { name: string; inputSchema?: { properties?: { element?: { description?: string } } } };
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[]; tools?: Tool[] } };
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

const namesTrap = (t: string): boolean => /`element` is a label/.test(t) && /does NOT select/.test(t) && /ref|selector/.test(t);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'elem', version: '1' } });

  const fa = await call('tools/call', { name: 'find_and_act', arguments: { element: 'the OK button', do: 'click' } });
  assert(fa.result?.isError === true && namesTrap(textOf(fa)), `find_and_act with only \`element\` names the trap, not a generic empty-selector error (got: ${JSON.stringify(textOf(fa).slice(0, 110))})`);

  const rv = await call('tools/call', { name: 'reveal', arguments: { element: 'the OK button' } });
  assert(rv.result?.isError === true && namesTrap(textOf(rv)), 'reveal with only `element` names the trap');

  // DOC: ELEMENT_DESC tells the model `element` does not select.
  const tools = (await call('tools/list', {})).result?.tools ?? [];
  const desc = tools.find((tool) => tool.name === 'find_and_act')?.inputSchema?.properties?.element?.description ?? '';
  assert(/does not select|does NOT select/i.test(desc) && /\bref\b|selector/.test(desc), `ELEMENT_DESC states it is non-targeting (got: ${JSON.stringify(desc.slice(0, 90))})`);

  // No regression: a real selector path still reaches targeting (no attached window → an honest "no window" / no-match,
  // never the element-trap steer).
  const real = await call('tools/call', { name: 'find_and_act', arguments: { selector: { name: 'Nonexistent XYZ' }, do: 'click' } });
  assert(!namesTrap(textOf(real)), 'a real {selector} call does NOT hit the element-trap steer (targeting proceeds)');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — the phantom `element` field is steered (label, not a target); ref/selector targeting unaffected.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
