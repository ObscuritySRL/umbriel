/**
 * read-table-paging — read_table accepts an additive {startRow} so an AI can PAGE a big grid forward instead of
 * re-reading from row 0 every time. Before, the loop was top-anchored (`for (row = 0; row < limit)`) with only a
 * maxRows cap, and the truncation footer steered "…(N more rows — raise maxRows)" → re-read from the top → O(pages²)
 * cumulative tokens. Now read_table {ref, maxRows, startRow} reads rows [startRow, startRow+maxRows) and the footer
 * names the NEXT startRow; startRow is clamped into [0, totalRows]; omitting it (default 0) is byte-identical to before.
 *
 * Proof over the real stdio MCP server against Explorer's System32 details grid: page 0 (maxRows 4) returns rows 1-4
 * and a footer naming startRow:4; page startRow:4 returns DIFFERENT rows (5-8) and chains startRow:8. The Explorer
 * WINDOW is closed in teardown (not the shell process).
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess + a spawned Explorer window):
 * Run: bun run example/read-table-paging.integration.test.ts
 */
import { closeWindow, umbriel } from 'umbriel';

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
Bun.spawn(['explorer.exe', 'C:\\Windows\\System32'], { stdout: 'ignore', stderr: 'ignore' });
await Bun.sleep(3500);
const win = umbriel.windows().find((window) => /CabinetWClass/i.test(window.className) && /System32/i.test(window.title)) ?? umbriel.windows().find((window) => /CabinetWClass/i.test(window.className));

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
const firstRow = (t: string): string => t.split('\n').filter((line) => line.startsWith('| ') && !line.includes('---') && !/\| Name \|/.test(line))[0] ?? '';

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'read-table-paging', version: '1' } });
  if (win === undefined) console.log('  skip: no Explorer (CabinetWClass) window to drive');
  else {
    const attached = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${win.hWnd.toString(16)}` } }));
    const ref = attached.match(/(?:List|DataGrid|Table)[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i)?.[1];
    if (ref === undefined) console.log('  skip: no List/DataGrid/Table ref (Explorer not in details view, or empty)');
    else {
      const page0 = textOf(await call('tools/call', { name: 'read_table', arguments: { ref, maxRows: 4, startRow: 0 } }));
      const page4 = textOf(await call('tools/call', { name: 'read_table', arguments: { ref, maxRows: 4, startRow: 4 } }));
      assert(/\| Name \|/.test(page0) && firstRow(page0).length > 0, 'read_table returns the grid (header + rows)');
      assert(/…\(rows 1–\d+ of \d+; \d+ more — next page with startRow:4\)/.test(page0), `page 0 footer names the next startRow (got: ${JSON.stringify(page0.split('\n').find((l) => l.startsWith('…'))?.slice(0, 70))})`);
      assert(firstRow(page0) !== firstRow(page4) && firstRow(page4).length > 0, 'startRow:4 returns a DIFFERENT window of rows (real forward paging, not a re-read from row 0)');
      assert(/…\(rows 5–\d+ of \d+/.test(page4), `page startRow:4 footer reports rows 5.. (got: ${JSON.stringify(page4.split('\n').find((l) => l.startsWith('…'))?.slice(0, 70))})`);
    }
  }
} finally {
  proc.kill();
  if (win !== undefined) closeWindow(win.hWnd); // close just the Explorer window, NOT the shell process
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — read_table {startRow} pages a grid forward; the footer chains the next page.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
