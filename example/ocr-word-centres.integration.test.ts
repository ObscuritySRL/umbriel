/**
 * ocr-word-centres — the MCP `ocr` tool now hands back a click_point centre PER WORD on a multi-word line, not just
 * the line box. Before, the handler rendered only line.bounds and told the agent to "click via click_point at a box
 * centre" — but a multi-word line's box centre lands on whitespace or the wrong token, so clicking a specific word
 * (a username, a badge, an OK inside a sentence) missed by tens of pixels and forced a second full OCR via click_text.
 * Now each multi-word line also lists `"word"@cx,cy` per word (the per-word boxes the OCR engine already computed).
 *
 * Proof, deterministic + self-contained: paint a known multi-word phrase into an in-process throwaway window (the
 * ocr-window harness), drive the REAL stdio MCP `ocr` tool over that window's hWnd while pumping the window's messages
 * so WGC can compose it, and assert the tool output carries a "word centres:" line with DISTINCT per-word x centres.
 * Our own window — DestroyWindow + UnregisterClass teardown. Skips cleanly with no OCR pack / no WGC.
 *
 * bun test is broken repo-wide for FFI; runnable harness (MCP subprocess + an in-process painted window):
 * Run: bun run example/ocr-word-centres.integration.test.ts
 */
import { JSCallback } from 'bun:ffi';

import Gdi32 from '@bun-win32/gdi32';
import { ocrAvailable, umbriel, wgcAvailable } from 'umbriel';
import User32 from '@bun-win32/user32';
import { ShowWindowCommand, WindowStyles } from '@bun-win32/user32';

type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const WIDTH = 900;
const HEIGHT = 160;
const PHRASE = 'The quick brown fox 2026';
const WHITE_BRUSH = 0;
const CS_HREDRAW = 0x0002;
const CS_VREDRAW = 0x0001;
const PM_REMOVE = 0x0001;
const ETO_OPAQUE = 0x0002;
const encodeWide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

function paintPhrase(hWnd: bigint): void {
  const dc = User32.GetDC(hWnd);
  const faceName = encodeWide('Segoe UI');
  const font = Gdi32.CreateFontW(-72, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 4, 0, faceName.ptr!);
  const previousFont = Gdi32.SelectObject(dc, font);
  Gdi32.SetBkColor(dc, 0x00ff_ffff);
  Gdi32.SetTextColor(dc, 0x0000_0000);
  const rect = Buffer.alloc(16);
  rect.writeInt32LE(WIDTH, 8);
  rect.writeInt32LE(HEIGHT, 12);
  const text = encodeWide(PHRASE);
  Gdi32.ExtTextOutW(dc, 20, 40, ETO_OPAQUE, rect.ptr!, text.ptr!, PHRASE.length, null);
  Gdi32.GdiFlush();
  Gdi32.SelectObject(dc, previousFont);
  Gdi32.DeleteObject(font);
  User32.ReleaseDC(hWnd, dc);
}

umbriel.initialize();
let hWnd = 0n;
let className: Buffer | null = null;
let wndProc: JSCallback | null = null;
let pump: ReturnType<typeof setInterval> | null = null;
const msgBuffer = Buffer.alloc(48);
const pumpOnce = (): void => {
  if (hWnd === 0n) return;
  paintPhrase(hWnd);
  while (User32.PeekMessageW(msgBuffer.ptr!, 0n, 0, 0, PM_REMOVE) !== 0) {
    User32.TranslateMessage(msgBuffer.ptr!);
    User32.DispatchMessageW(msgBuffer.ptr!);
  }
};

try {
  if (!ocrAvailable()) {
    console.log('  (no OCR language pack — skipping)\nSKIPPED — Windows.Media.Ocr has no language pack.');
    process.exit(0);
  }
  if (!wgcAvailable()) {
    console.log('  (WGC unavailable — locked/headless — skipping)\nSKIPPED — Windows.Graphics.Capture not usable.');
    process.exit(0);
  }

  wndProc = new JSCallback((handle: bigint, msg: number, wParam: bigint, lParam: bigint): bigint => BigInt(User32.DefWindowProcW(handle, msg, wParam, lParam)), { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' });
  className = encodeWide(`UmbrielOcrWords_${process.pid}`);
  const wndClass = Buffer.alloc(80);
  wndClass.writeUInt32LE(80, 0);
  wndClass.writeUInt32LE(CS_HREDRAW | CS_VREDRAW, 4);
  wndClass.writeBigUInt64LE(BigInt(wndProc.ptr!), 8);
  wndClass.writeBigUInt64LE(BigInt(Gdi32.GetStockObject(WHITE_BRUSH)), 48);
  wndClass.writeBigUInt64LE(BigInt(className.ptr!), 64);
  if (!User32.RegisterClassExW(wndClass.ptr!)) throw new Error('RegisterClassExW failed');
  hWnd = User32.CreateWindowExW(0, className.ptr!, encodeWide('').ptr!, WindowStyles.WS_POPUP | WindowStyles.WS_VISIBLE, 0, 0, WIDTH, HEIGHT, 0n, 0n, 0n, null);
  if (hWnd === 0n) throw new Error('CreateWindowExW failed (no interactive desktop?)');
  User32.ShowWindow(hWnd, ShowWindowCommand.SW_SHOWNOACTIVATE);
  User32.UpdateWindow(hWnd);
  for (let frame = 0; frame < 12; frame += 1) {
    pumpOnce();
    Bun.sleepSync(30);
  }
  pump = setInterval(pumpOnce, 16); // keep composing + repainting while the MCP subprocess captures the window

  // Drive the real MCP ocr tool over the window's hWnd.
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
  const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ocr-word-centres', version: '1' } });
  const out = textOf(await call('tools/call', { name: 'ocr', arguments: { hWnd: `0x${hWnd.toString(16)}` } }));
  proc.kill();

  const wordLine = out.split('\n').find((line) => line.includes('word centres:')) ?? '';
  const xs = [...wordLine.matchAll(/@(\d+),\d+/g)].map((match) => Number(match[1]));
  assert(/single WORD at its listed word@x,y/.test(out), 'the OCR steer offers per-WORD click_point centres');
  assert(wordLine.length > 0 && xs.length >= 2, `a multi-word line lists per-word centres (got ${xs.length}: ${wordLine.trim().slice(0, 90)})`);
  assert(new Set(xs).size >= 2, 'the per-word x centres are DISTINCT (each word, not the one line centre)');
} finally {
  if (pump !== null) clearInterval(pump);
  if (hWnd !== 0n) User32.DestroyWindow(hWnd);
  if (className !== null) User32.UnregisterClassW(className.ptr!, 0n);
  wndProc?.close();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — the MCP ocr tool hands back a click_point centre per word on a multi-word line.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
