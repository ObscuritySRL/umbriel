/**
 * snapshot-hscroll-signal — the snapshot signalled VERTICAL scroll position only ("scroll N% — more below"), so a
 * horizontally-scrollable container (a wide DataGrid, Gantt/timeline, carousel, a no-wrap log/Edit) gave the agent NO
 * "more to the right" cue — it could not tell content extended past the right edge. nodeState now also emits a symmetric
 * horizontal signal ("scroll-x N% — more right" / "scroll-x 100% (right end)") for a ScrollPattern container that reports
 * HorizontallyScrollable, riding the existing single BuildUpdatedCache round-trip (SDK-verified PropertyIds
 * ScrollHorizontalScrollPercent=30053 / ScrollHorizontallyScrollable=30057).
 *
 * Proof (deterministic): a synthetic no-wrap Edit with WS_HSCROLL + a 600-char line is horizontally scrollable; its MCP
 * snapshot line carries "scroll-x 0% — more right". Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic horizontally-scrollable Edit):
 * Run: bun run example/snapshot-hscroll-signal.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
const WS_HSCROLL = 0x0010_0000;
const ES_MULTILINE = 0x0004;
const ES_AUTOHSCROLL = 0x0080;
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-hscroll-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 140, 140, 300, 160, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER | WS_HSCROLL | ES_MULTILINE | ES_AUTOHSCROLL, 8, 8, 180, 40, parent, 0n, BigInt(hInstance), null);
if (edit !== 0n) User32.SendMessageW(edit, WM_SETTEXT, 0n, BigInt(wide('x'.repeat(600)).ptr!));
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hscroll', version: '1' } });
  if (parent === 0n || edit === 0n) console.log('  skip: could not create the synthetic Edit');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const editLine = snap.split('\n').find((line) => /Edit[^\n]*\[ref=/.test(line)) ?? '';
    assert(/scroll-x \d+% — more right|scroll-x 100% \(right end\)/.test(editLine), `the horizontally-scrollable Edit carries the scroll-x signal (got: ${JSON.stringify(editLine.trim().slice(0, 110))})`);
    assert(!/ scroll \d+% — more below/.test(editLine), 'a horizontal-only container does NOT get a spurious vertical signal');
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — the snapshot signals a horizontally-scrollable container has content to the right.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
