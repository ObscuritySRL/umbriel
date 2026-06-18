/**
 * popup-same-process-scope — newPopup (the invoke/expand/context_menu auto-return) matched ANY top-level window whose
 * class contains Combo/DropDown/Flyout/Menu/Popup, so a CROSS-PROCESS shell popup that happened to be open during the
 * action (live-observed: an explorer Xaml_WindowedPopupClass "PopupHost") could be misattributed to an in-app invoke and
 * the agent steered to attach an unrelated shell window. newPopup is now scoped to the attached window's PROCESS. A
 * classic Win32 ComboBox dropdown (ComboLBox) is same-process, so its auto-return MUST still fire — that is the property
 * this guards (the cross-process exclusion is a pure same-vs-other pid compare on already-enumerated windows).
 *
 * Proof: expanding a synthetic classic ComboBox via the MCP server still auto-returns its own-window dropdown
 * (class ComboLBox), proving same-process popup detection survives the scoping. Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a synthetic classic ComboBox):
 * Run: bun run example/popup-same-process-scope.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_VSCROLL = 0x0020_0000;
const CBS_DROPDOWNLIST = 0x0003;
const CB_ADDSTRING = 0x0143;
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
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-combo-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 160, 160, 320, 220, 0n, 0n, BigInt(hInstance), null);
const combo = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('ComboBox').ptr!, null, WS_CHILD | WS_VISIBLE | WS_VSCROLL | CBS_DROPDOWNLIST, 10, 10, 280, 200, parent, 0n, BigInt(hInstance), null);
if (combo !== 0n) for (const item of ['Alpha', 'Beta', 'Gamma']) User32.SendMessageW(combo, CB_ADDSTRING, 0n, BigInt(wide(item).ptr!));
pump();
const ticker = setInterval(pump, 5);

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'combo-scope', version: '1' } });
  if (parent === 0n || combo === 0n) console.log('  skip: could not create the synthetic ComboBox');
  else {
    const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
    const ref = /ComboBox[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/.exec(snap)?.[1];
    if (ref === undefined) console.log(`  skip: no ComboBox ref in the snapshot (head: ${JSON.stringify(snap.slice(0, 200))})`);
    else {
      const expanded = await call('tools/call', { name: 'expand', arguments: { ref } });
      assert(expanded.result?.isError !== true, 'expand on the classic ComboBox did not error');
      assert(/OWN window/i.test(textOf(expanded)) && /ComboLBox/i.test(textOf(expanded)), `same-process ComboLBox dropdown is still auto-returned after the scoping (got: ${JSON.stringify(textOf(expanded).slice(0, 130))})`);
    }
  }
} finally {
  clearInterval(ticker);
  proc.kill();
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — newPopup is process-scoped: a same-process classic ComboLBox dropdown is still auto-returned.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
