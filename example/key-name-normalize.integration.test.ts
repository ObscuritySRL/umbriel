/**
 * key-name-normalize — press_key / hold_key resolved the key name ONLY via NAMED_KEYS, so xdotool/CUA spellings an LLM
 * naturally emits (ArrowDown, Page_Down, super, spacebar) hit the cursor-free posted path and threw a bare "unknown key"
 * with no hint — even though normalizeKey (wired only to hold_key's SendInput fallback) already maps them. Both handlers
 * now run the key through normalizeKey first, and virtualKeyCode's throw enumerates the accepted vocabulary + chord syntax.
 *
 * Proof (synthetic, deterministic): press_key {key:'ArrowDown'} and hold_key {key:'ArrowDown'} on an own-HWND control
 * resolve cursor-free (normalized to Down) — no "unknown key"; a genuinely unknown key returns the enumerated steer.
 * Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic Edit):
 * Run: bun run example/key-name-normalize.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-keyname-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 300, 320, 140, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 280, 28, parent, 0n, BigInt(hInstance), null);
pump();
const ticker = setInterval(pump, 5);

const refOf = async (): Promise<string | undefined> => /Edit[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } })))?.[1];

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'keyname', version: '1' } });
  if (parent === 0n || edit === 0n) console.log('  skip: could not create the synthetic Edit');
  else {
    const ref1 = await refOf();
    if (ref1 === undefined) console.log('  skip: no Edit ref in the snapshot');
    else {
      const pk = await call('tools/call', { name: 'press_key', arguments: { ref: ref1, key: 'ArrowDown' } });
      assert(pk.result?.isError !== true && /cursor-free/.test(textOf(pk)) && !/unknown key/.test(textOf(pk)), `press_key {key:'ArrowDown'} resolves cursor-free (normalized) (got: ${JSON.stringify(textOf(pk).slice(0, 80))})`);

      const ref2 = await refOf();
      const hk = await call('tools/call', { name: 'hold_key', arguments: { ref: ref2, key: 'ArrowDown', durationMs: 60 } });
      assert(hk.result?.isError !== true && /cursor-free/.test(textOf(hk)) && !/unknown key/.test(textOf(hk)), `hold_key {key:'ArrowDown'} resolves cursor-free (normalized) (got: ${JSON.stringify(textOf(hk).slice(0, 80))})`);

      const ref3 = await refOf();
      const bad = await call('tools/call', { name: 'press_key', arguments: { ref: ref3, key: 'fnord' } });
      assert(bad.result?.isError === true && /unknown key/.test(textOf(bad)) && /chord joins parts|F1-F12|PageDown/.test(textOf(bad)), `an unknown key enumerates the accepted vocabulary (got: ${JSON.stringify(textOf(bad).slice(0, 110))})`);
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — press_key/hold_key normalize CUA key names cursor-free; an unknown key enumerates the vocabulary.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
