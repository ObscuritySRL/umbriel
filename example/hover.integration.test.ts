/**
 * hover — the `hover` tool moves the REAL mouse pointer onto a control (by {ref}) or a raw {x,y} and leaves it there
 * WITHOUT clicking (Playwright locator.hover() / page.mouse.move()), the only way to reveal hover-only UI: a tooltip
 * that renders on WM_MOUSEMOVE, a hover-expand submenu/flyout, a hover-revealed row/tab button. It moves the real
 * cursor (SetCursorPos), so it is NOT cursor-free and is refused under UMBRIEL_CURSOR=never — every other rival
 * (Playwright/nut.js/FlaUI/Windows-MCP) exposes a move/hover; this closes that parity gap without weakening the
 * cursor-free guarantee.
 *
 * Proof over the real stdio MCP server (no GUI launched — moves the cursor to an empty point): hover {x,y} leaves the
 * cursor at that point (verified via GetCursorPos); a second server with UMBRIEL_CURSOR=never REFUSES the hover.
 *
 * bun test is broken repo-wide; runnable harness (MCP subprocess only):
 * Run: bun run example/hover.integration.test.ts
 */
import User32 from '@bun-win32/user32';

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function cursorXY(): [number, number] {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return [point.readInt32LE(0), point.readInt32LE(4)];
}

function connect(cursorEnv?: string): { call: (method: string, params: unknown) => Promise<Rpc>; kill: () => void; ready: Promise<void> } {
  const env = { ...Bun.env, UMBRIEL_PROFILE: 'safe', ...(cursorEnv !== undefined ? { UMBRIEL_CURSOR: cursorEnv } : {}) };
  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env });
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
  const ready = call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hover', version: '1' } }).then(() => undefined);
  return { call, kill: () => proc.kill(), ready };
}
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

const enabled = connect();
const denied = connect('never');
try {
  await enabled.ready;
  await enabled.call('tools/call', { name: 'hover', arguments: { x: 437, y: 521 } });
  await Bun.sleep(120);
  const [cx, cy] = cursorXY();
  assert(Math.abs(cx - 437) <= 2 && Math.abs(cy - 521) <= 2, `hover {x:437,y:521} parked the real cursor there (now at ${cx},${cy})`);

  await denied.ready;
  const refused = await denied.call('tools/call', { name: 'hover', arguments: { x: 100, y: 100 } });
  assert(refused.result?.isError === true && /UMBRIEL_CURSOR=never/.test(textOf(refused)), `hover is refused under UMBRIEL_CURSOR=never (got: ${JSON.stringify(textOf(refused).slice(0, 70))})`);
} finally {
  enabled.kill();
  denied.kill();
}

console.log(failures === 0 ? '\nPASS — hover parks the real cursor on a target (and is refused under UMBRIEL_CURSOR=never).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
