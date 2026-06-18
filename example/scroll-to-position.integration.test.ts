/**
 * scroll-to-position — the scroll tool only looped SmallIncrement/SmallDecrement for up/down/left/right, so an agent
 * could not jump to the top/bottom of a long list/log/document or page through it in one call — it had to spam small
 * steps and guess when it arrived. scroll now accepts direction top/bottom (setScrollPercent 0/100), page-up/page-down/
 * page-left/page-right (LargeIncrement/Decrement ×amount), and `to` 0-100 (scroll-to-percent) — all cursor-free via the
 * UIA ScrollPattern (works minimized/background/locked); a ScrollPattern-less control gets an honest steer.
 *
 * Proof (synthetic, deterministic): a 200-line multiline Edit (ScrollPattern, vScrollable) reports "scroll 100% (end)"
 * after {direction:'bottom'}, "scroll 0%" after {direction:'top'}, and "scroll 50%" after {to:50}, read back from the
 * snapshot's scroll suffix. Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic scrollable Edit):
 * Run: bun run example/scroll-to-position.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import { ControlType, skry } from 'skry';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_VSCROLL = 0x0020_0000;
const WS_BORDER = 0x0080_0000;
const ES_MULTILINE = 0x0004;
const ES_AUTOVSCROLL = 0x0040;
const WM_SETTEXT = 0x000c;
const PM_REMOVE = 0x0001;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');
const pumpMsg = Buffer.alloc(48);
const pump = (): void => {
  for (let i = 0; i < 300; i += 1) {
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-scroll-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 220, 220, 360, 300, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL, 10, 10, 320, 240, parent, 0n, BigInt(hInstance), null);
if (edit !== 0n) User32.SendMessageW(edit, WM_SETTEXT, 0n, BigInt(wide(Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\r\n')).ptr!));
pump();
const ticker = setInterval(pump, 5);

skry.initialize();
// An independent UIA client (this process) reads the Edit's TRUE vertical percent back after each MCP scroll — robust to
// the snapshot/Δ economy of the action's own reply.
const probeWindow = parent === 0n ? null : skry.attach(parent);
const probeEdit = probeWindow?.find({ controlType: ControlType.Edit }) ?? null;
const vpct = (): number => probeEdit?.scrollInfo?.verticalPercent ?? -1;

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'scroll-pos', version: '1' } });
  if (parent === 0n || edit === 0n || probeEdit === null) console.log('  skip: could not create / read the synthetic Edit');
  else {
    const firstSnap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    // A scroll re-grounds the tree, so re-ATTACH before EACH scroll for a current ref (attach always returns the full
    // tree, never the byte-identical "no UI change" one-liner that desktop_snapshot can short-circuit to).
    const freshRef = async (): Promise<string | undefined> => /Edit[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } })))?.[1];
    if (!/Edit[^\n]*?\[ref=/.test(firstSnap)) console.log('  skip: no Edit ref in the snapshot');
    else {
      const scroll = async (extra: object): Promise<Rpc> => call('tools/call', { name: 'scroll', arguments: { ref: await freshRef(), ...extra } });

      const bottom = await scroll({ direction: 'bottom' });
      await Bun.sleep(120);
      assert(bottom.result?.isError !== true && /to bottom/.test(textOf(bottom)) && vpct() > 95, `direction:'bottom' jumps to ~100% (vpct=${vpct().toFixed(0)})`);

      const top = await scroll({ direction: 'top' });
      await Bun.sleep(120);
      assert(top.result?.isError !== true && /to top/.test(textOf(top)) && vpct() < 5, `direction:'top' jumps to ~0% (vpct=${vpct().toFixed(0)})`);

      const half = await scroll({ to: 50 });
      await Bun.sleep(120);
      assert(half.result?.isError !== true && /to 50%/.test(textOf(half)) && vpct() > 25 && vpct() < 75, `to:50 jumps to ~50% (vpct=${vpct().toFixed(0)})`);

      const beforePage = vpct();
      const page = await scroll({ direction: 'page-down' });
      await Bun.sleep(120);
      assert(page.result?.isError !== true && /page-down/.test(textOf(page)) && vpct() > beforePage, `page-down advances the position (${beforePage.toFixed(0)}% → ${vpct().toFixed(0)}%)`);
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  probeEdit?.release();
  probeWindow?.dispose();
  skry.uninitialize();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — scroll supports top/bottom/page/percent (cursor-free scroll-to-position).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
