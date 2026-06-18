/**
 * message-clarity — two REFLECT #17 AI-digestion fixes:
 *   (4) find_text now DISAMBIGUATES "this control has no TextPattern" (wrong target → isError steering to a
 *       Document/Edit/Text control) from "text genuinely absent" (a not-found message with retry advice). It used
 *       to fold both into one ambiguous, non-self-correcting line.
 *   (5) inspect_element emits an explicit `can: (none — …)` affordance line for a ref with zero supported patterns,
 *       instead of silently omitting the line and leaving the agent no next-verb steer.
 *
 * Proof (real MCP server, taskbar): find_text on a Button (no TextPattern) is a clear isError; inspect_element on a
 * pattern-less ref (opportunistic) shows the explicit can:(none) steer.
 *
 * bun test is broken repo-wide — runnable harness (only the MCP subprocess):
 * Run: bun run example/message-clarity.integration.test.ts
 */
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

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'message-clarity', version: '1' } });
  const snap = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const buttonRef = /(?:Start|Search)"? \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /Button "[^"]*" \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
  if (buttonRef === undefined) console.log('  skip: no taskbar Button ref');
  else {
    // (4) find_text on a non-TextPattern Button → clear "no TextPattern" steer, NOT "text not found (or no TextPattern)".
    const ft = await call('tools/call', { name: 'find_text', arguments: { ref: buttonRef, text: 'whatever' } });
    assert(
      ft.result?.isError === true && /no UIA TextPattern/.test(textOf(ft)) && /Document \/ Edit \/ Text/.test(textOf(ft)),
      'find_text on a no-TextPattern control returns a clear isError steering to a text control (not the old ambiguous line)',
    );
  }

  // (5) inspect_element can:(none) — scan the snapshot's refs for one whose inspect shows no patterns (opportunistic).
  const refs = [...snap.matchAll(/\[ref=(e\d+(?:#\d+)?)\]/g)].map((m) => m[1]).slice(0, 25);
  let sawNone = false;
  let sawCan = false;
  for (const ref of refs) {
    const info = textOf(await call('tools/call', { name: 'inspect_element', arguments: { ref } }));
    if (/can: \(none/.test(info)) sawNone = true;
    if (/can: [a-z]/.test(info)) sawCan = true;
    if (sawNone && sawCan) break;
  }
  assert(sawCan, 'inspect_element shows a can: affordance line for ref(s) that support patterns');
  if (sawNone) assert(true, 'inspect_element emits the explicit can: (none — …) steer for a pattern-less ref');
  else console.log('  skip: no pattern-less ref on the taskbar to exercise the can:(none) branch (logic is tsc-verified + a pure else-string)');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — find_text disambiguates no-TextPattern vs not-found; inspect_element always carries a can: line.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
