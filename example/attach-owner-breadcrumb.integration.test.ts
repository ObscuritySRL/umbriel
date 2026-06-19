/**
 * attach-owner-breadcrumb — when the attached window is an OWNED dialog/picker, attach's success message now names
 * its PARENT and hands back the exact call to return to it. Before, every target switch did attached?.dispose() with
 * zero memory of where it came from, and attach's text named only the dialog — so the canonical "open a dialog, act,
 * return to the parent" flow (file picker, Save-As, options, color picker, confirm) had no breadcrumb: the agent had
 * to recall a parent hWnd seen turns earlier (now evicted from context) or re-run list_windows and re-identify the
 * parent among look-alikes. Now the owner hWnd (GetWindow GW_OWNER) is surfaced inline; non-owned windows get nothing
 * (~0 tokens — GW_OWNER is 0n).
 *
 * Proof, deterministic + self-contained: create an owner window + an OWNED popup (hWndParent=owner) in-process, drive
 * the REAL stdio MCP attach tool over each, and assert the popup attach names the parent (with a ready attach {hWnd})
 * while the parent attach carries no breadcrumb. Our own windows — DestroyWindow + UnregisterClass teardown.
 *
 * bun test is broken repo-wide for FFI; runnable harness (MCP subprocess + two in-process windows):
 * Run: bun run example/attach-owner-breadcrumb.integration.test.ts
 */
import { JSCallback } from 'bun:ffi';

import { umbriel } from 'umbriel';
import User32 from '@bun-win32/user32';

type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const WS_VISIBLE = 0x1000_0000;
const WS_POPUP = 0x8000_0000;
const WS_CAPTION = 0x00c0_0000;
const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const PM_REMOVE = 0x0001;
const GW_OWNER = 0x0004;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

umbriel.initialize();
let owner = 0n;
let dialog = 0n;
let className: Buffer | null = null;
let wndProc: JSCallback | null = null;
let pump: ReturnType<typeof setInterval> | null = null;
const msg = Buffer.alloc(48);
const pumpOnce = (): void => {
  while (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, PM_REMOVE) !== 0) {
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
};

try {
  wndProc = new JSCallback((h: bigint, m: number, w: bigint, l: bigint): bigint => BigInt(User32.DefWindowProcW(h, m, w, l)), { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' });
  className = wide(`UmbrielOwnerBreadcrumb_${process.pid}`);
  const wndClass = Buffer.alloc(80);
  wndClass.writeUInt32LE(80, 0);
  wndClass.writeBigUInt64LE(BigInt(wndProc.ptr!), 8);
  wndClass.writeBigUInt64LE(BigInt(className.ptr!), 64);
  if (!User32.RegisterClassExW(wndClass.ptr!)) throw new Error('RegisterClassExW failed');

  owner = User32.CreateWindowExW(0, className.ptr!, wide('UmbrielParentXYZ').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 500, 360, 0n, 0n, 0n, null);
  dialog = User32.CreateWindowExW(0, className.ptr!, wide('UmbrielChildDlg').ptr!, WS_POPUP | WS_CAPTION | WS_VISIBLE, 120, 120, 320, 200, owner, 0n, 0n, null); // hWndParent=owner ⇒ OWNED
  if (owner === 0n || dialog === 0n) throw new Error('CreateWindowExW failed (no interactive desktop?)');
  if (User32.GetWindow(dialog, GW_OWNER) !== owner) {
    console.log('  skip: the dialog did not register as owned on this desktop');
  } else {
    for (let frame = 0; frame < 8; frame += 1) {
      pumpOnce();
      Bun.sleepSync(40);
    }
    pump = setInterval(pumpOnce, 16); // keep BOTH windows responsive while the MCP subprocess attaches them cross-process

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
    const firstLine = (m: Rpc): string => (m.result?.content?.[0]?.text ?? '').split('\n')[0] ?? '';

    await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'attach-owner-breadcrumb', version: '1' } });
    const dialogText = firstLine(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${dialog.toString(16)}` } }));
    const ownerText = firstLine(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${owner.toString(16)}` } }));
    proc.kill();

    assert(new RegExp(`owned by 0x${owner.toString(16)} "UmbrielParentXYZ"`).test(dialogText) && new RegExp(`attach \\{hWnd:0x${owner.toString(16)}\\}`).test(dialogText), `attaching the OWNED dialog names its parent + the return call (got: ${JSON.stringify(dialogText.slice(0, 120))})`);
    assert(!/owned by/.test(ownerText), `attaching the non-owned PARENT carries no breadcrumb (got: ${JSON.stringify(ownerText.slice(0, 80))})`);
  }
} finally {
  if (pump !== null) clearInterval(pump);
  if (dialog !== 0n) User32.DestroyWindow(dialog);
  if (owner !== 0n) User32.DestroyWindow(owner);
  if (className !== null) User32.UnregisterClassW(className.ptr!, 0n);
  wndProc?.close();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — attach names an owned dialog’s parent (with a ready return call); non-owned windows get no breadcrumb.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
