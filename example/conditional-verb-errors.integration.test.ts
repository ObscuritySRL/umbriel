/**
 * conditional-verb-errors — a conditional multi-coord verb that is missing its coordinates must name the FULL
 * per-action param set, not emit a bare "missing required number argument: x" that hides the other 3 coords. This
 * mirrors the accepted A8-digestion pattern (commit 350c75e) for manage_window move/set_opacity + manage_element
 * move/resize/rotate. Happy path is byte-identical (the guard is a no-op when the params are present); only the
 * error path improves.
 *
 * Proof: (live, MCP subprocess) manage_window {action:"move"} with no coords names all of {x, y, width, height};
 * {action:"set_opacity"} names {alpha}. (source) manage_element's move/resize/rotate guards name their param sets
 * (manage_element needs a live ref to reach the guard, so its messages are pinned at the source level).
 *
 * bun test is broken repo-wide for FFI — runnable harness (MCP subprocess; no window spawned):
 * Run: bun run example/conditional-verb-errors.integration.test.ts
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cve', version: '1' } });

  const move = await call('tools/call', { name: 'manage_window', arguments: { hWnd: 0, action: 'move' } });
  const moveText = textOf(move);
  assert(move.result?.isError === true && /\bx\b/.test(moveText) && /\by\b/.test(moveText) && /width/.test(moveText) && /height/.test(moveText), `manage_window move names all of {x, y, width, height} — got ${JSON.stringify(moveText)}`);

  const opacity = await call('tools/call', { name: 'manage_window', arguments: { hWnd: 0, action: 'set_opacity' } });
  const opacityText = textOf(opacity);
  assert(opacity.result?.isError === true && /alpha/.test(opacityText) && !/missing required number argument: alpha\b\s*$/.test(opacityText), `manage_window set_opacity names {alpha} (with the 0–255 range) — got ${JSON.stringify(opacityText)}`);

  // manage_element needs a live ref to reach its action guard — pin its enumerated messages at the source level.
  const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();
  assert(/manage_element action:"move" needs \{x, y\}/.test(mcp), 'manage_element move guard names {x, y}');
  assert(/manage_element action:"resize" needs \{width, height\}/.test(mcp), 'manage_element resize guard names {width, height}');
  assert(/manage_element action:"rotate" needs \{degrees\}/.test(mcp), 'manage_element rotate guard names {degrees}');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — conditional multi-coord verbs name their full per-action param set on a missing-arg error.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
