/**
 * launch-app-fallback — launch_app spawned the command on $PATH only, so an App-Paths registry entry or a Store
 * execution alias (winword, excel, wt, …) that a bare CreateProcess can't find failed with no recovery path. It now
 * falls back to ShellExecuteW (which resolves App-Paths + aliases), then polls for the window and attaches.
 *
 * Proof: (1) a normal on-PATH app (notepad) launches + attaches; (2) a nonexistent command returns a CLEAR isError
 * steering to a full path / run_program, not a crash; (3) opportunistically, Windows Terminal `wt` (a Store alias
 * Bun.spawn cannot start but ShellExecuteW can) launches "(via shell)" — skipped if Terminal isn't installed.
 *
 * bun test is broken repo-wide — runnable harness (MCP subprocess, full profile for the os category):
 * Run: bun run example/launch-app-fallback.integration.test.ts
 */
import { closeWindow, findWindow } from 'skry';

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'full' } });
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

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'launch-app-fallback', version: '1' } });

  const notepad = await call('tools/call', { name: 'launch_app', arguments: { command: 'notepad', className: 'Notepad' } });
  assert(notepad.result?.isError !== true && /attached to/.test(textOf(notepad)), 'launch_app starts + attaches an on-PATH app (notepad)');
  const npHwnd = findWindow({ className: 'Notepad' });
  if (npHwnd !== 0n) closeWindow(npHwnd);

  const bogus = await call('tools/call', { name: 'launch_app', arguments: { command: '__no_such_exe_7421__' } });
  assert(bogus.result?.isError === true && /could not launch/.test(textOf(bogus)) && /run_program|full path/.test(textOf(bogus)), 'a nonexistent command returns a clear isError with a recovery path (no crash)');

  // Store execution alias: Bun.spawn can't run the WindowsApps reparse alias, but ShellExecuteW can.
  const wt = await call('tools/call', { name: 'launch_app', arguments: { command: 'wt', className: 'CASCADIA_HOSTING_WINDOW_CLASS', timeout: 6000 } });
  if (wt.result?.isError === true) console.log('  skip: Windows Terminal (wt) not installed — cannot exercise the ShellExecuteW alias fallback');
  else {
    assert(/via shell/.test(textOf(wt)), 'launch_app starts a Store-alias exe (wt) via the ShellExecuteW fallback');
    const wtHwnd = findWindow({ className: 'CASCADIA_HOSTING_WINDOW_CLASS' });
    if (wtHwnd !== 0n) closeWindow(wtHwnd);
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — launch_app resolves App-Paths/alias exes via ShellExecuteW and errors clearly on a bad name.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
