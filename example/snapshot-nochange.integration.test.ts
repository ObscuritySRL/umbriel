/**
 * snapshot-nochange — a defensive desktop_snapshot re-ground that finds the tree BYTE-IDENTICAL must return a compact
 * "no UI change" line and KEEP the model's refs valid, not re-dump the whole tree and bump the generation (which
 * would reject the very refs the re-ground was meant to confirm). Mirrors the withSnapshot action-path contract for
 * the explicit-snapshot path.
 *
 * Proof (taskbar — static): two back-to-back desktop_snapshots; the second is the "no UI change" line, and a ref
 * from the FIRST still resolves (inspect_element succeeds, not "earlier snapshot generation").
 *
 * bun test is broken repo-wide — runnable harness (only the MCP subprocess):
 * Run: bun run example/snapshot-nochange.integration.test.ts
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'snap-nochange', version: '1' } });
  const snap1 = textOf(await call('tools/call', { name: 'attach', arguments: { className: 'Shell_TrayWnd' } }));
  const ref = /(?:Start|Search)"? \[ref=(e\d+(?:#\d+)?)\]/.exec(snap1)?.[1] ?? /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap1)?.[1];
  const snap2 = textOf(await call('tools/call', { name: 'desktop_snapshot', arguments: {} }));
  assert(/no UI change since the last snapshot/.test(snap2) && !/\[ref=/.test(snap2), 'a byte-identical re-snapshot returns the compact "no UI change" line, not a full re-dump');
  if (ref === undefined) console.log('  skip: no taskbar ref to re-resolve');
  else {
    const inspect = await call('tools/call', { name: 'inspect_element', arguments: { ref } });
    assert(inspect.result?.isError !== true && !/earlier snapshot generation|not in the current snapshot/.test(textOf(inspect)), 'a ref from before the no-change re-snapshot STILL resolves (generation not bumped)');
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — an unchanged re-snapshot is a compact "no change" and keeps refs valid.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
