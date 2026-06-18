/**
 * unknown-action-lists-verbs — a bad "do"/"action" gave a dead-end error ("unknown action: nope") that named neither the
 * valid verbs nor that select/focus exist, and find_and_act/reveal descriptions advertised a SHORTER verb list than their
 * own enums (they hid select + focus). act() and manage_window now enumerate their valid verbs in the error, and both
 * descriptions list select + focus.
 *
 * Proof: find_and_act {do:'nope'} errors with the full verb list incl. select + focus; manage_window {action:'nope'}
 * errors with the full action list; and tools/list shows select + focus in the find_and_act and reveal descriptions.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic window with a Button):
 * Run: bun run example/unknown-action-lists-verbs.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const PM_REMOVE = 0x0001;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const pumpMsg = Buffer.alloc(48);
const pump = (): void => {
  for (let i = 0; i < 200; i += 1) {
    if (User32.PeekMessageW(pumpMsg.ptr!, 0n, 0, 0, PM_REMOVE) === 0) break;
    User32.TranslateMessage(pumpMsg.ptr!);
    User32.DispatchMessageW(pumpMsg.ptr!);
  }
};

type Tool = { name: string; description?: string };
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[]; tools?: Tool[] } };
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

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-verbs-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 120, 120, 320, 180, 0n, 0n, BigInt(hInstance), null);
const button = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Button').ptr!, wide('Press Me').ptr!, WS_CHILD | WS_VISIBLE, 20, 20, 160, 32, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verbs', version: '1' } });

  // DOC: tools/list descriptions surface select + focus (they previously listed a shorter verb set than their enums).
  const tools = (await call('tools/list', {})).result?.tools ?? [];
  const fa = tools.find((tool) => tool.name === 'find_and_act')?.description ?? '';
  const rv = tools.find((tool) => tool.name === 'reveal')?.description ?? '';
  assert(/select/.test(fa) && /focus/.test(fa), 'find_and_act description lists select + focus');
  assert(/select/.test(rv) && /focus/.test(rv), 'reveal description lists select + focus');

  if (parent === 0n || button === 0n) console.log('  skip: could not create the synthetic window');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const ref = /\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log('  skip: no ref in the synthetic snapshot');
    else {
      const badDo = await call('tools/call', { name: 'find_and_act', arguments: { ref, do: 'nope' } });
      assert(
        badDo.result?.isError === true && /unknown action/.test(textOf(badDo)) && /select/.test(textOf(badDo)) && /focus/.test(textOf(badDo)) && /toggle/.test(textOf(badDo)),
        `find_and_act {do:'nope'} lists the valid verbs (got: ${JSON.stringify(textOf(badDo).slice(0, 120))})`,
      );
    }
    const badAction = await call('tools/call', { name: 'manage_window', arguments: { hWnd: `0x${parent.toString(16)}`, action: 'nope' } });
    assert(
      badAction.result?.isError === true && /unknown manage_window action/.test(textOf(badAction)) && /minimize/.test(textOf(badAction)) && /snap/.test(textOf(badAction)),
      `manage_window {action:'nope'} lists the valid actions (got: ${JSON.stringify(textOf(badAction).slice(0, 120))})`,
    );
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (button !== 0n) User32.DestroyWindow(button);
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — unknown verbs/actions enumerate the valid set; find_and_act/reveal advertise select + focus.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
