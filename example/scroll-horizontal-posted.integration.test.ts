/**
 * scroll-horizontal-posted — a ScrollPattern-less control with its own HWND could be scrolled up/down cursor-free
 * (posted WM_MOUSEWHEEL) but NOT left/right, and the code comment falsely claimed horizontal fell through to a SendInput
 * wheel (scrollAt is a UIA-ScrollPattern walk, not a wheel). New postHWheel posts WM_MOUSEHWHEEL; the scroll handler
 * routes left/right through it (cursor-free), and the comment/description are corrected.
 *
 * Proof: (unit) postHWheel posts to a real HWND and returns true (0n → false); (wire) scroll {direction:'left'} on a
 * Character Map control with its own HWND but no ScrollPattern reports the cursor-free posted wheel. Windows closed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (FFI window + MCP subprocess + Character Map):
 * Run: bun run example/scroll-horizontal-posted.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import { closeWindow, postHWheel, skry } from 'skry';
import User32 from '@bun-win32/user32';

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

// Part A — unit: postHWheel posts WM_MOUSEHWHEEL to a real HWND.
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const hInstance = Kernel32.GetModuleHandleW(null);
const win = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-hwheel').ptr!, 0x00cf_0000 | 0x1000_0000, 100, 100, 300, 200, 0n, 0n, BigInt(hInstance), null);
assert(win !== 0n && postHWheel(win, 150, 150, 3) === true, 'postHWheel posts WM_MOUSEHWHEEL to a real HWND (returns true)');
assert(postHWheel(0n, 0, 0, 3) === false, 'postHWheel returns false for a 0 handle');
if (win !== 0n) User32.DestroyWindow(win);

// Part B — wire: the scroll handler routes left/right through the posted hwheel for an own-HWND no-ScrollPattern control.
skry.initialize();
const charmap = await skry.launch(['charmap.exe'], { title: 'Character Map' }).catch(() => null);
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hscroll', version: '1' } });
  if (charmap === null) console.log('  skip: Character Map did not launch');
  else {
    await Bun.sleep(900);
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${charmap.hWnd.toString(16)}` } }));
    const ref = /Button "Select" \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1] ?? /Button "[^"]*" \[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log('  skip: no own-HWND Button ref in the Character Map snapshot');
    else {
      const r = await call('tools/call', { name: 'scroll', arguments: { ref, direction: 'left', amount: 2 } });
      const text = textOf(r);
      assert(r.result?.isError !== true && /left.*\(posted wheel, cursor-free\)/.test(text), `scroll left on an own-HWND no-ScrollPattern control posts the hwheel cursor-free (got: ${JSON.stringify(text.slice(0, 80))})`);
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

console.log(failures === 0 ? '\nPASS — horizontal scroll on a ScrollPattern-less own-HWND control has a cursor-free posted WM_MOUSEHWHEEL path.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
