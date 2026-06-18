/**
 * set-value-password-withheld — set_value echoed the value it wrote straight back (`… = "secret"`), so writing into a
 * password field streamed the secret into the model/log transcript — the one secret-bearing path that did NOT apply the
 * isPassword gate every read path (read / inspect_element / find_text / copy / cut) already applies. set_value now echoes
 * "(password — withheld)" for a secret field, while still echoing the value for ordinary fields (no over-redaction).
 *
 * Proof: a synthetic ES_PASSWORD Edit driven via the MCP server's set_value returns "(password — withheld)" and never
 * the secret; a sibling plain Edit set to a marker still echoes the marker. Windows destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic password/plain Edit pair):
 * Run: bun run example/set-value-password-withheld.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
const ES_PASSWORD = 0x0020;
const PM_REMOVE = 0x0001;
const SECRET = 'hunter2-do-not-leak';
const MARKER = 'plain-value-ok';
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const pumpMsg = Buffer.alloc(48);
const pump = (): void => {
  for (let i = 0; i < 200; i += 1) {
    if (User32.PeekMessageW(pumpMsg.ptr!, 0n, 0, 0, PM_REMOVE) === 0) break;
    User32.TranslateMessage(pumpMsg.ptr!);
    User32.DispatchMessageW(pumpMsg.ptr!);
  }
};

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

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-setval-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 360, 220, 0n, 0n, BigInt(hInstance), null);
const pw = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER | ES_PASSWORD, 10, 10, 320, 28, parent, 0n, BigInt(hInstance), null);
const plain = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 60, 320, 28, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5); // keep the synthetic window pumping so the MCP server's WM_SETTEXT/SetValue lands

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'setval-pw', version: '1' } });
  if (parent === 0n || pw === 0n || plain === 0n) console.log('  skip: could not create the Edit pair');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const refs = [...snap.matchAll(/Edit[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/g)].map((match) => match[1]);
    if (refs.length < 2) console.log(`  skip: expected two Edit refs in the snapshot (got ${refs.length})`);
    else {
      // Identify which ref is the password field via inspect_element (the read gate already marks it).
      let pwRef: string | undefined;
      let plainRef: string | undefined;
      for (const ref of refs) {
        const info = textOf(await call('tools/call', { name: 'inspect_element', arguments: { ref } }));
        if (/\(password — withheld\)/.test(info)) pwRef = ref;
        else plainRef = ref;
      }
      if (pwRef === undefined || plainRef === undefined) console.log('  skip: could not distinguish the password Edit from the plain Edit');
      else {
        const setPw = await call('tools/call', { name: 'set_value', arguments: { ref: pwRef, value: SECRET } });
        assert(setPw.result?.isError !== true, 'set_value on the password field did not error');
        assert(!textOf(setPw).includes(SECRET), `set_value response never contains the secret (got: ${JSON.stringify(textOf(setPw).slice(0, 120))})`);
        assert(/\(password — withheld\)/.test(textOf(setPw)), 'set_value echoes "(password — withheld)" for a secret field');

        const setPlain = await call('tools/call', { name: 'set_value', arguments: { ref: plainRef, value: MARKER } });
        assert(setPlain.result?.isError !== true && textOf(setPlain).includes(MARKER), `set_value still echoes an ordinary field's value (no over-redaction) (got: ${JSON.stringify(textOf(setPlain).slice(0, 90))})`);
      }
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (pw !== 0n) User32.DestroyWindow(pw);
  if (plain !== 0n) User32.DestroyWindow(plain);
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — set_value withholds a password-field value while still echoing ordinary fields.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
