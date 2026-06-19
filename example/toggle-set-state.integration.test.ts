/**
 * toggle-set-state — the MCP `toggle` tool accepts an optional {state:true|false} to SET a checkbox/switch to a
 * known state IDEMPOTENTLY (no flip if already there), instead of only blindly flipping. This collapses the common
 * "ensure checked" intent from 3 steps (inspect_element to read toggleState → branch → conditional toggle) to ONE
 * declarative call, and makes the verb retry-safe (a re-sent set-to-on never flips back off). Omitting {state}
 * preserves the original flip exactly (backward-compatible).
 *
 * Proof (synthetic classic Win32 BS_AUTOCHECKBOX, driven over the real MCP wire; a setInterval pump drains the
 * checkbox's queue during the awaited cross-process BM_CLICK): set true on an off box checks it; set true again is
 * a no-op (no flip-back); set false unchecks it; a stateless toggle still flips. Ground truth via BM_GETCHECK.
 * The synthetic window is DestroyWindow'd in teardown.
 *
 * bun test is broken repo-wide for FFI — runnable harness (MCP subprocess + a synthetic own-window checkbox):
 * Run: bun run example/toggle-set-state.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { umbriel } from 'umbriel';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const BS_AUTOCHECKBOX = 0x0003;
const BM_GETCHECK = 0x00f0;

type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const staticClass = Buffer.from('Static\0', 'utf16le');
const buttonClass = Buffer.from('BUTTON\0', 'utf16le');
const parent = User32.CreateWindowExW(0, staticClass.ptr!, Buffer.from('ToggleSetWin\0', 'utf16le').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 240, 240, 320, 180, 0n, 0n, 0n, null);
const checkbox = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Airplane mode\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 30, 40, 260, 32, parent, 0n, 0n, null);
const msg = Buffer.alloc(48);
const pump = (): void => { for (let index = 0; index < 64; index += 1) { if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break; User32.TranslateMessage(msg.ptr!); User32.DispatchMessageW(msg.ptr!); } };
const pumpTimer = setInterval(pump, 8); // drains the checkbox's BM_CLICK while we await the MCP call (cross-process)
const checked = (): bigint => User32.SendMessageW(checkbox, BM_GETCHECK, 0n, 0n);

const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'safe' } });
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const pending = new Map<number, (message: Rpc) => void>();
let buffer = '';
let nextId = 1;
void (async () => {
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as Rpc;
          if (typeof message.id === 'number' && pending.has(message.id)) {
            pending.get(message.id)!(message);
            pending.delete(message.id);
          }
        } catch {}
      }
      newline = buffer.indexOf('\n');
    }
  }
})();
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(encoder.encode(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`));
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (message: Rpc): string => message.result?.content?.[0]?.text ?? '';

try {
  await Bun.sleep(200);
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'toggle-set-state', version: '1' } });
  const attached = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
  const ref = attached.match(/(?:CheckBox|Airplane)[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i)?.[1];
  assert(ref !== undefined, `attach surfaced the checkbox ref (${ref})`);
  assert(checked() === 0n, 'baseline: the synthetic checkbox is unchecked');
  if (ref !== undefined) {
    const r1 = textOf(await call('tools/call', { name: 'toggle', arguments: { ref, state: true } }));
    await Bun.sleep(150);
    assert(checked() === 1n && !/already/.test(r1), 'toggle {state:true} SET an unchecked box to checked (one declarative call)');

    const r2 = textOf(await call('tools/call', { name: 'toggle', arguments: { ref, state: true } }));
    await Bun.sleep(150);
    assert(checked() === 1n && /already on/.test(r2), 'toggle {state:true} on an already-checked box is an idempotent no-op — it did NOT flip back off (retry-safe)');

    const r3 = textOf(await call('tools/call', { name: 'toggle', arguments: { ref, state: false } }));
    await Bun.sleep(150);
    assert(checked() === 0n && !/already/.test(r3), 'toggle {state:false} SET it back to unchecked');

    const r4 = textOf(await call('tools/call', { name: 'toggle', arguments: { ref } }));
    await Bun.sleep(150);
    assert(checked() === 1n && !/already/.test(r4), 'toggle with NO state still flips (backward-compatible)');
  }
} finally {
  clearInterval(pumpTimer);
  proc.kill();
  User32.DestroyWindow(checkbox);
  User32.DestroyWindow(parent);
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — toggle {state} sets a checkbox to a known state idempotently; stateless toggle still flips.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
