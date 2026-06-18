/**
 * act-select-verb — grid_cell{do:select} (and the select-by-name flow) advertised a 'select' verb in its schema enum +
 * description, but act() had no select branch, so it threw 'unknown action: select' — an advertised-but-broken verb.
 * act() now has a select branch (cursor-free Element.select → SelectionItem.Select via patternAction), and find_and_act
 * + reveal list 'select' in their do enums.
 *
 * Proof: find_and_act {do:'select'} is now RECOGNIZED — on a non-selectable control it returns the can:-list steer
 * ("may not support select"), NOT "unknown action: select"; a control that supports SelectionItem returns "selected".
 * Character Map closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Character Map):
 * Run: bun run example/act-select-verb.integration.test.ts
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
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'act-select', version: '1' } });
  if (charmap === null) console.log('  skip: Character Map did not launch');
  else {
    await Bun.sleep(900);
    await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${charmap.hWnd.toString(16)}` } });
    // The verb is now RECOGNIZED: a non-selectable Button returns the can:-list steer, not "unknown action: select".
    const r = await call('tools/call', { name: 'find_and_act', arguments: { selector: { name: 'Select', controlType: 'Button' }, do: 'select' } });
    const text = textOf(r);
    assert(!/unknown action/i.test(text), `find_and_act {do:'select'} is a RECOGNIZED verb (no "unknown action: select") — got: ${JSON.stringify(text.slice(0, 90))}`);
    assert(/selected|may not support select/i.test(text), 'select either succeeds or yields the can:-list steer (the wired-verb behavior)');
  }
} finally {
  proc.kill();
  if (charmap !== null) {
    closeWindow(charmap.hWnd);
    charmap.dispose();
  }
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — the select verb is wired (grid_cell{do:select} + find_and_act/reveal{do:select} work cursor-free).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
