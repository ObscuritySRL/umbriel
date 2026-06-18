/**
 * launch-cold-winui-settle — launch_app took its snapshot the instant waitForWindow resolved, but a COLD WinUI/UWP store
 * app (Settings/Photos/Store/Mail) surfaces only its title-bar chrome at that instant and renders its real content
 * ~0.6-1.5s LATER on a separate thread (live-measured: cold Settings = 4 actionable refs when the window appears, 49 by
 * +585ms, plateauing at 51 by ~865ms). So the agent got a content-LESS tree that LOOKS complete and acted on near-nothing.
 * launch_app now returns withLaunchSettledSnapshot, which polls the rebuild until the ref count GROWS past the first
 * reading and then holds steady (grow-then-plateau — a bare plateau breaks early because the cold chrome frame is itself
 * stable for ~300ms before content lands), bounded by a ~2.5s cap; a warm/instant app pays one extra tick.
 *
 * NOTE: this is the scoped re-raise REFLECT #38 missed — #38 tested only calc (+33ms, no race) and notepad (0-forever,
 * a provider gap), never a cold WinUI store app, so it wrongly refuted the whole class. #39's completeness critic + a
 * 2x live repro restored it.
 *
 * Proof (live): cold-kill Settings, MCP launch_app {ms-settings:, title:Settings} → the returned snapshot carries the
 * settled content (>>4 refs), not the title-bar chrome alone. Settings is taskkill'd in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a cold Settings launch):
 * Run: bun run example/launch-cold-winui-settle.integration.test.ts
 */
Bun.spawnSync(['taskkill', '/IM', 'SystemSettings.exe', '/F']); // ensure the launch is genuinely cold
await Bun.sleep(1200);

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_OS: '1' } });
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'launch-settle', version: '1' } });
  const launched = await call('tools/call', { name: 'launch_app', arguments: { command: 'ms-settings:', title: 'Settings' } });
  const text = textOf(launched);
  if (launched.result?.isError === true && /no window matching/.test(text)) {
    console.log('  skip: Settings did not open (headless/locked session)');
  } else {
    const refs = (text.match(/\[ref=/g) ?? []).length;
    assert(launched.result?.isError !== true, 'launch_app returned a snapshot (not an error)');
    assert(refs > 15, `the settled launch snapshot carries the cold-WinUI content (${refs} refs — a bare snapshot would show only ~4 title-bar controls)`);
  }

  // Warm/instant classic app: the settle loop stabilizes on the first tick. This is the case the cycle-145 settle SHIPPED
  // BROKEN (REFLECT #40 rank1) — every settle-loop withSnapshot after the first saw body===lastSnapshotBody and returned
  // the content-LESS "no UI change" line, so launch_app handed back a ref-less tree for EVERY app, not just cold WinUI.
  // The fix forces one final full render after the loop; this asserts a warm launch carries content too.
  const warm = await call('tools/call', { name: 'launch_app', arguments: { command: 'charmap.exe', title: 'Character Map' } });
  const warmText = textOf(warm);
  if (warm.result?.isError === true && /no window matching/.test(warmText)) {
    console.log('  skip: Character Map did not launch');
  } else {
    const warmRefs = (warmText.match(/\[ref=/g) ?? []).length;
    assert(!warmText.includes('(no UI change since the last snapshot'), 'a warm launch does NOT return the content-less "no UI change" line');
    assert(warmRefs > 5, `a warm classic launch (Character Map) carries content too (${warmRefs} refs)`);
  }
} finally {
  await call('tools/call', { name: 'manage_window', arguments: { action: 'close' } }).catch(() => {});
  proc.kill();
  Bun.spawnSync(['taskkill', '/IM', 'SystemSettings.exe', '/F']);
  Bun.spawnSync(['taskkill', '/IM', 'charmap.exe', '/F']);
}

console.log(failures === 0 ? '\nPASS — launch_app settles a cold WinUI store app so its late-rendered content is in the launch snapshot.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
