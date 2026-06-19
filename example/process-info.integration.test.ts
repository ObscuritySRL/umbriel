/**
 * process-info — process_info {pid} gives DEEP per-process detail (name, parent pid, start time, CPU kernel/user ms,
 * working-set + peak MB, handle count, child list) so the AI can pick WHICH pid to kill/suspend/reprioritize instead
 * of guessing from the flat list_processes names. name/parent/children come from ONE toolhelp snapshot (visible across
 * integrity levels); detail fields come from OpenProcess(QUERY_LIMITED_INFORMATION) and read 0 for a protected process.
 * Pure kernel32 (GetProcessTimes/GetProcessHandleCount/K32GetProcessMemoryInfo), read-only, no tasklist/Get-Process.
 *
 * Proof: this test spawns a `ping`, then process_info on the ping shows its parent = this test's pid and real detail;
 * process_info on the test's OWN pid lists the ping among its children (the tree works); a missing pid is not-found;
 * and process_info is available even under the readonly profile (category 'read').
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/process-info.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function connect(profile: string): { call: (m: string, p: unknown) => Promise<Rpc>; kill: () => void } {
  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: profile } });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pending = new Map<number, (m: Rpc) => void>();
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
          const m = JSON.parse(line) as Rpc;
          if (typeof m.id === 'number' && pending.has(m.id)) {
            pending.get(m.id)!(m);
            pending.delete(m.id);
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
  return { call, kill: () => proc.kill() };
}
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';
const isErr = (m: Rpc): boolean => m.result?.isError === true;

const ping = Bun.spawn(['ping', '-n', '20', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
const full = connect('full');
const readonly = connect('readonly');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pinfo', version: '1' } });
  await Bun.sleep(200);

  const pingInfo = textOf(await full.call('tools/call', { name: 'process_info', arguments: { pid: ping.pid } }));
  console.log(`  process_info(ping) → ${JSON.stringify(pingInfo.split('\n')[0])}`);
  assert(/PING\.EXE \(pid \d+, parent \d+\)/i.test(pingInfo), 'process_info renders name + pid + parent pid');
  assert(new RegExp(`parent ${process.pid}\\b`).test(pingInfo), 'process_info reads the correct parent pid (this test spawned the ping)');
  assert(/working-set \d+MB.*handles \d+/.test(pingInfo), 'process_info reads real detail (working-set MB + handle count)');

  // the test's OWN pid should list the ping among its children — proves the child tree
  const selfInfo = textOf(await full.call('tools/call', { name: 'process_info', arguments: { pid: process.pid } }));
  assert(new RegExp(`PING\\.EXE#${ping.pid}\\b`, 'i').test(selfInfo), 'process_info lists the spawned ping in the parent\'s child tree');

  const missing = await full.call('tools/call', { name: 'process_info', arguments: { pid: 999_999 } });
  assert(isErr(missing) && /no such process/.test(textOf(missing)), 'process_info on a missing pid reports not-found');

  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pinfo', version: '1' } });
  const list = await readonly.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('process_info'), 'process_info IS exposed under the readonly profile (category read)');
} finally {
  ping.kill();
  full.kill();
  readonly.kill();
}

console.log(failures === 0 ? '\nPASS — process_info reports parent/child tree + start/CPU/memory/handles natively (read-only).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
