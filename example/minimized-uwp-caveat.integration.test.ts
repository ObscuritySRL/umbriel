/**
 * minimized-uwp-caveat — every "works on a minimized window" claim was unqualified, but a UWP/WinUI store app SUSPENDS
 * its UI thread + a11y tree when minimized or fully backgrounded (its tree reads empty, posted actions don't land until
 * restored) — only classic Win32/HWND apps stay drivable minimized. The doctrine sites (mcp.ts INSTRUCTIONS, AI.md, both
 * package READMEs) now carry the UWP/WinUI-suspend caveat; the rank4 hold_key {ref} cursor-free path is reflected too.
 *
 * Proof (pure-text): the live tools/list instructions AND AI.md / both READMEs all mention the UWP/WinUI suspend caveat;
 * AI.md no longer lists hold_key flatly among the never-refused tools and lists hold_key {ref} among the cursor-free ones.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess for the live instructions + the doc files):
 * Run: bun run example/minimized-uwp-caveat.integration.test.ts
 */
type Rpc = { id?: number; result?: { instructions?: string } };
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

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const caveat = /UWP\/WinUI[\s\S]*?suspends?[\s\S]*?(tree|UI)/i;

try {
  const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'uwp-caveat', version: '1' } });
  const instructions = init.result?.instructions ?? '';
  assert(caveat.test(instructions), 'the live MCP instructions carry the UWP/WinUI-suspend caveat');

  const aimd = await Bun.file(`${import.meta.dir}/../AI.md`).text();
  assert(caveat.test(aimd), 'AI.md carries the UWP/WinUI-suspend caveat');
  assert(/hold_key`? WITHOUT an own-HWND/.test(aimd), 'AI.md no longer lists hold_key flatly among the never-refused tools (rank4 doc-fidelity)');
  assert(/hold_key \{ref\}/.test(aimd), 'AI.md lists hold_key {ref} among the cursor-free paths');

  const readme = await Bun.file(`${import.meta.dir}/../README.md`).text();
  assert(caveat.test(readme), 'skry README carries the UWP/WinUI-suspend caveat');

  const aliasReadme = await Bun.file(`${import.meta.dir}/../../skry/README.md`).text();
  assert(caveat.test(aliasReadme), 'skry README carries the UWP/WinUI-suspend caveat');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — the minimized-window claims carry the UWP/WinUI-suspend caveat across instructions + AI.md + both READMEs.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
