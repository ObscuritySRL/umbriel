/**
 * presskey-cursorfree-steer — under SKRY_CURSOR=never, press_key on a control with NO native window handle (a WinUI/
 * Electron sub-control) used to steer "focus {ref} first then press_key" — a DEAD LOOP, since SetFocus adds no native
 * HWND so the retry re-refuses forever. The steer (and the act() type steer + the focus-tool description) now state
 * honestly that a raw key has no cursor-free path for such a control and route BY INTENT: Enter/Space → invoke, a tab/
 * list/menu choice → select, text → set_value.
 *
 * Proof (live, under never): press_key {ref} on a no-own-HWND taskbar Button errors WITHOUT re-suggesting press_key, and
 * names invoke + select + set_value; the focus tool description carries the cursor=never caveat.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess started with SKRY_CURSOR=never; taskbar, nothing to close):
 * Run: bun run example/presskey-cursorfree-steer.integration.test.ts
 */
type Tool = { name: string; description?: string };
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[]; tools?: Tool[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe', SKRY_CURSOR: 'never' } });
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'presskey-steer', version: '1' } });

  // DOC: the focus tool no longer promises "focus then press_key lands on it" unconditionally.
  const tools = (await call('tools/list', {})).result?.tools ?? [];
  const focusDesc = tools.find((tool) => tool.name === 'focus')?.description ?? '';
  assert(/no key path|by intent|invoke \/ select \/ set_value/i.test(focusDesc) && /SKRY_CURSOR=never/.test(focusDesc), `focus description carries the cursor=never no-key-path caveat (got: ${JSON.stringify(focusDesc.slice(-140))})`);

  const snap = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const buttonRef = /(?:Start|Search)"? \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /Button "[^"]*" \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
  if (buttonRef === undefined) console.log('  skip: no no-handle taskbar Button ref to exercise the steer');
  else {
    const pressed = await call('tools/call', { name: 'press_key', arguments: { ref: buttonRef, key: 'Enter' } });
    const text = textOf(pressed);
    assert(pressed.result?.isError === true && /SKRY_CURSOR=never/.test(text), 'press_key on a no-handle control is refused under never');
    assert(!/then press_key/.test(text), `the steer no longer says "then press_key" (no dead loop) (got: ${JSON.stringify(text.slice(0, 120))})`);
    assert(/invoke/.test(text) && /select/.test(text) && /set_value/.test(text), 'the steer routes by intent: invoke / select / set_value');
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — the cursor=never no-handle key steer routes by intent (invoke/select/set_value), not a press_key dead-loop.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
