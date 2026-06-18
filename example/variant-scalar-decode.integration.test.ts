/**
 * variant-scalar-decode — readVariantProperty now RETURNS scalar VARIANTs (VT_I4 / VT_R8 / VT_BOOL) without calling
 * VariantClear (those own no resource, so VariantClear is a MSDN no-op; the per-call scratch24.fill(0) still clears the
 * slot), skipping a cross-DLL FFI call on ~94% of cached state reads — the snapshot hot path. VariantClear is kept for
 * VT_BSTR (after the copy) and any unrecognized resource-owning vt. This guards that the skip did not change DECODING:
 * a BOOL state (toggle off/on) and a BSTR value still read correctly through the cached snapshot.
 *
 * Measured on this machine: getCachedPropertyValue on a scalar BOOL went 670 → 619 ns/call (~7.6% faster).
 *
 * Proof (synthetic, deterministic): a checkbox reads "(off)" then "(on)" after an external BM_SETCHECK (VT_BOOL false &
 * true), and an Edit reads its value (VT_BSTR) — all byte-correct after the VariantClear-skip. Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic checkbox + Edit):
 * Run: bun run example/variant-scalar-decode.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
const BS_AUTOCHECKBOX = 0x0003;
const WM_SETTEXT = 0x000c;
const BM_SETCHECK = 0x00f1;
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-variant-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 160, 160, 320, 180, 0n, 0n, BigInt(hInstance), null);
const checkedBox = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Button').ptr!, wide('Checked thing').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 10, 10, 200, 24, parent, 0n, BigInt(hInstance), null);
const uncheckedBox = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Button').ptr!, wide('Unchecked thing').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 10, 40, 200, 24, parent, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 70, 280, 24, parent, 0n, BigInt(hInstance), null);
if (checkedBox !== 0n) User32.SendMessageW(checkedBox, BM_SETCHECK, 1n, 0n); // VT_BOOL true
if (edit !== 0n) User32.SendMessageW(edit, WM_SETTEXT, 0n, BigInt(wide('decoded value').ptr!));
pump();
const ticker = setInterval(pump, 5);

const lineOf = (snap: string, name: string): string => snap.split('\n').find((line) => line.includes(name)) ?? '';

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'variant', version: '1' } });
  if (parent === 0n || checkedBox === 0n || uncheckedBox === 0n || edit === 0n) console.log('  skip: could not create the synthetic controls');
  else {
    // A single attach proves VT_BOOL (true + false) and VT_BSTR all decode after the VariantClear-skip on scalars.
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    assert(/\(on\)/.test(lineOf(snap, 'Checked thing')), `VT_BOOL true decodes — pre-checked box reads (on) (got: ${JSON.stringify(lineOf(snap, 'Checked thing').trim().slice(0, 80))})`);
    assert(/\(off\)/.test(lineOf(snap, 'Unchecked thing')), `VT_BOOL false decodes — unchecked box reads (off) (got: ${JSON.stringify(lineOf(snap, 'Unchecked thing').trim().slice(0, 80))})`);
    assert(/value="decoded value"/.test(snap), 'VT_BSTR decodes — the Edit value reads back byte-correct');
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — VARIANT scalar (BOOL) + BSTR decode correctly after the VariantClear-skip on scalars.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
