/**
 * act-batch — the act_batch tool: run N act steps against the attached window in ONE MCP call, rebuilding the
 * snapshot just ONCE at the end. Selector-only (each step re-resolves against the live window), per-step
 * actionability auto-wait + ambiguity refusal, and stopOnError (halt-then-snapshot, default true).
 *
 * Proof (live, Calculator): one act_batch invokes Five, Plus, Three, Equals — all four land (4× ✓) and the single
 * returned snapshot shows the computed result "Display is 8" (real behavior, not a count). stopOnError default:
 * a batch with a non-matching middle step (timeout:0) halts — the 3rd step is NOT attempted. stopOnError:false:
 * the same batch attempts all three. Calculator's window is closed (closeWindow) in finally.
 *
 * APIs demonstrated:
 * - act_batch (selector-only multi-step act with one deferred snapshot, stopOnError)
 * - umbriel.launch / closeWindow (Calculator), the stdio MCP server (attach + act_batch)
 *
 * bun test is broken repo-wide for FFI — runnable harness (MCP subprocess + Calculator):
 * Run: bun run example/act-batch.integration.test.ts
 */
import { closeWindow, umbriel } from 'umbriel';

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

umbriel.initialize();
const calc = await umbriel.launch(['calc.exe'], { title: 'Calculator' }).catch(() => null);
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'act-batch', version: '1' } });
  if (calc === null) console.log('  skip: Calculator did not launch');
  else {
    await Bun.sleep(1200); // cold UWP render
    await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${calc.hWnd.toString(16)}` } });

    const sum = textOf(await call('tools/call', { name: 'act_batch', arguments: { steps: [{ selector: { name: 'Five' }, do: 'invoke' }, { selector: { name: 'Plus' }, do: 'invoke' }, { selector: { name: 'Three' }, do: 'invoke' }, { selector: { name: 'Equals' }, do: 'invoke' }] } }));
    const ticks = (sum.match(/\d+\. ✓/g) ?? []).length;
    assert(ticks === 4, `all four invokes landed in one call (${ticks}/4 ✓) — ${JSON.stringify(sum.split('\n').slice(0, 6))}`);
    // REAL behavior (not just a count): the calc actually computed 8. The result is a non-actionable Text node that
    // the rendered snapshot prunes, so READ it directly (after a settle — its UIA name updates just after Equals).
    await Bun.sleep(300);
    const display = textOf(await call('tools/call', { name: 'find_and_act', arguments: { do: 'read', selector: { nameContains: 'Display is' } } }));
    assert(/Display is 8\b/.test(display), `5 + 3 = 8 really computed (read of the result display) — ${JSON.stringify(display.slice(0, 140))}`);

    const halted = textOf(await call('tools/call', { name: 'act_batch', arguments: { steps: [{ selector: { name: 'Five' }, do: 'invoke' }, { selector: { name: 'ZZZ_NoSuchButton' }, do: 'invoke', timeout: 0 }, { selector: { name: 'Three' }, do: 'invoke' }] } }));
    assert(/1\. ✓/.test(halted) && /2\. ✗/.test(halted) && !/3\. /.test(halted) && /halted/.test(halted), `stopOnError (default) halts at the first failure — step 3 not attempted — ${JSON.stringify(halted.split('\n').slice(0, 5))}`);

    const all = textOf(await call('tools/call', { name: 'act_batch', arguments: { stopOnError: false, steps: [{ selector: { name: 'Five' }, do: 'invoke' }, { selector: { name: 'ZZZ_NoSuchButton' }, do: 'invoke', timeout: 0 }, { selector: { name: 'Three' }, do: 'invoke' }] } }));
    assert(/3\. ✓/.test(all), `stopOnError:false attempts every step — step 3 ran despite step 2 failing — ${JSON.stringify(all.split('\n').slice(0, 5))}`);
  }
} finally {
  proc.kill();
  if (calc !== null) {
    closeWindow(calc.hWnd);
    calc.dispose();
  }
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — act_batch runs N steps in one call with a single deferred snapshot; stopOnError gates the sequence.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
