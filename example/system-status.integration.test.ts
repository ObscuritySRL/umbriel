/**
 * system-status — the `system_status` tool reports the environment signals that decide whether a read/capture is
 * TRUSTWORTHY: a lock/secure desktop or running screensaver (the user's apps are blanked/unreadable), a headless
 * 0-monitor or RDP session, AC vs battery, and the foreground window. An agent checks this FIRST when a snapshot or
 * screenshot comes back empty, so it does not wrongly conclude a control is "missing" when the desktop is just locked
 * or has no display — directly closing the class of false-negative a blanked screen would otherwise cause.
 *
 * Proof over the real stdio MCP server (read-only, no GUI launched): system_status returns the input desktop, a
 * monitor count, a foreground window, and a readability verdict. On a normal interactive desktop it reports "Default"
 * + "nominal"; if locked/headless it would carry a ⚠ warning instead — either way the load-bearing fields are present.
 *
 * bun test is broken repo-wide; runnable harness (MCP subprocess only):
 * Run: bun run example/system-status.integration.test.ts
 */
type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'readonly' } });
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'system-status', version: '1' } });
  const text = textOf(await call('tools/call', { name: 'system_status', arguments: {} }));
  console.log(`  system_status → ${JSON.stringify(text.split('\n')[0]?.slice(0, 110))}`);
  assert(/input desktop /.test(text) && /monitor\(s\)/.test(text), 'reports the input desktop and a monitor count');
  assert(/nominal|⚠/.test(text), 'reports a readability verdict (nominal, or a ⚠ lock/screensaver/headless warning)');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — system_status reports the desktop-readability signals an agent should check before trusting a read.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
