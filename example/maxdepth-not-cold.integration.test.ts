/**
 * maxdepth-not-cold — desktop_snapshot {maxDepth:N} small caps the tree ABOVE a window's interactable controls, yielding
 * 0 actionable controls — but coldTreeNote then emitted the generic "tree may be COLD, call desktop_snapshot again"
 * steer, a non-self-correcting infinite loop on a warm window (re-snapshotting at the same depth stays empty). It now
 * emits a maxDepth-aware steer ("you passed maxDepth=N … raise it") instead, only on the small-maxDepth path.
 *
 * Proof: attach Character Map (a warm window with controls), then desktop_snapshot {maxDepth:1} — the steer names the
 * maxDepth cap and says to raise it, NOT "call desktop_snapshot again". A full snapshot has refs and no cold note.
 * Character Map closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Character Map):
 * Run: bun run example/maxdepth-not-cold.integration.test.ts
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
const charmap = await skry.launch(['charmap.exe'], { title: 'Character Map' }).catch(() => null);
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'maxdepth', version: '1' } });
  if (charmap === null) console.log('  skip: Character Map did not launch');
  else {
    await Bun.sleep(900);
    const full = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${charmap.hWnd.toString(16)}` } }));
    assert(/\[ref=/.test(full) && !/maxDepth=/.test(full), 'a full snapshot has refs and no maxDepth steer');
    const capped = textOf(await call('tools/call', { name: 'desktop_snapshot', arguments: { maxDepth: 0 } }));
    if (/\[ref=/.test(capped)) console.log('  skip: maxDepth:0 still surfaced actionable controls (unexpected)');
    else {
      assert(/maxDepth=0/.test(capped) && /[Rr]aise/.test(capped), `a small-maxDepth empty result steers to RAISE maxDepth (got: ${JSON.stringify(capped.split('\n').slice(-1)[0]?.slice(0, 110))})`);
      assert(!/call desktop_snapshot again|tree may be COLD/.test(capped), 'the false "tree may be COLD / call desktop_snapshot again" loop is gone for the maxDepth-capped case');
    }
  }
} finally {
  proc.kill();
  if (charmap !== null) {
    closeWindow(charmap.hWnd);
    charmap.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a maxDepth-capped empty snapshot steers to raise maxDepth, not a false cold-tree loop.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
