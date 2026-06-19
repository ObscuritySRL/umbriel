/**
 * attach-title-no-match — a mistyped/stale/guessed title is the dominant attach failure (titles are volatile; a cold
 * model types the app name it remembers). Every OTHER attach refusal teaches recovery (className no-match steers to
 * list_windows; ambiguous title/class/process paths LIST candidate windows with hWnds), but attach-by-title NO-match
 * used to fall through to the library's bare "no window found for {…}" — echoing the agent's own JSON with zero next
 * step. Now (when windows WERE enumerated) it throws the same list_windows-steering, candidate-listing error its
 * siblings use, so the agent's next call is the deterministic attach-by-hWnd instead of a re-guess loop.
 *
 * Proof over the real stdio MCP server (read-only, no GUI launched, nothing to close): attach {title:<bogus>} returns
 * an isError that steers to list_windows AND lists visible windows with hWnds — and is NOT the bare library echo.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess only):
 * Run: bun run example/attach-title-no-match.integration.test.ts
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'attach-title-no-match', version: '1' } });
  const result = await call('tools/call', { name: 'attach', arguments: { title: 'ZzNoSuchWindowTitleXyz123' } });
  const t = textOf(result);
  assert(result.result?.isError === true, 'attach to a bogus title is an isError');
  assert(/list_windows/.test(t) && /Visible windows:/.test(t), `the refusal steers to list_windows AND lists visible windows (got: ${JSON.stringify(t.slice(0, 90))})`);
  assert(/\[hWnd=0x[0-9a-f]+\]/.test(t), 'the listed candidates carry their hWnds (so the next attach-by-hWnd is deterministic)');
  assert(!/no window found for/.test(t), 'it is NOT the bare library echo "no window found for {…}"');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — attach-by-title no-match steers to list_windows and lists candidate windows with hWnds.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
