/**
 * kill-process — the `kill_process` tool terminates a process by {pid} or {name} NATIVELY (TerminateProcess via an
 * OpenProcess(PROCESS_TERMINATE) handle), so an AI never shells to taskkill / Stop-Process. It reports clean
 * granularity the way FFI can and Bun's throwing process.kill can't: killed / access-denied (the process is
 * elevated/protected and this session can't terminate it) / not-found. It's an 'os'-category tool — destructive, so
 * gated behind the `full` profile / UMBRIEL_OS=1.
 *
 * Proof over the real stdio MCP server: under `full`, kill OUR OWN spawned ping by pid and by name (verified gone via
 * the toolhelp snapshot), get access-denied on lsass (still alive), and not-found on a bogus pid. Under `safe`,
 * kill_process is NOT exposed (os-gated). Only ever kills processes this test spawned.
 *
 * bun test is broken repo-wide; runnable harness (MCP subprocess + our own ping sleepers):
 * Run: bun run example/kill-process.integration.test.ts
 */
import { listProcesses } from 'umbriel';

const PING = 'C:\\Windows\\System32\\PING.EXE';
const alive = (pid: number): boolean => listProcesses().some((p) => p.processId === pid);
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
function connect(profile: string): { call: (m: string, p: unknown) => Promise<Rpc>; kill: () => void; pid: number } {
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
  return { call, kill: () => proc.kill(), pid: proc.pid };
}
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

const full = connect('full');
const safe = connect('safe');
const spawned: number[] = [];
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'kill', version: '1' } });

  // (1) by pid
  const p1 = Bun.spawn([PING, '-n', '30', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
  spawned.push(p1.pid);
  await Bun.sleep(400);
  const byPid = textOf(await full.call('tools/call', { name: 'kill_process', arguments: { pid: p1.pid } }));
  await Bun.sleep(200);
  assert(/killed pid/.test(byPid) && !alive(p1.pid), `kill_process {pid} terminates a process and it is gone (${JSON.stringify(byPid)})`);

  // (2) by name
  const p2 = Bun.spawn([PING, '-n', '30', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
  spawned.push(p2.pid);
  await Bun.sleep(400);
  const byName = textOf(await full.call('tools/call', { name: 'kill_process', arguments: { name: 'ping.exe' } }));
  await Bun.sleep(200);
  assert(/killed \d+\/\d+ named/.test(byName) && !alive(p2.pid), `kill_process {name} terminates every exact-name match (${JSON.stringify(byName)})`);

  // (3) access-denied on an elevated process — NOT killed
  const lsass = listProcesses().find((p) => /lsass/i.test(p.name))!;
  const denied = await full.call('tools/call', { name: 'kill_process', arguments: { pid: lsass.processId } });
  assert(denied.result?.isError === true && /access-denied/.test(textOf(denied)) && alive(lsass.processId), 'kill_process on an elevated/protected process is access-denied and does NOT kill it');

  // (4) not-found on a bogus pid
  const notFound = await full.call('tools/call', { name: 'kill_process', arguments: { pid: 999999 } });
  assert(notFound.result?.isError === true && /no such process/.test(textOf(notFound)), 'kill_process on a non-existent pid reports not-found');

  // (5) SECURITY: an empty/whitespace name is rejected (no empty-needle mass-kill)
  const empty = await full.call('tools/call', { name: 'kill_process', arguments: { name: '   ' } });
  assert(empty.result?.isError === true && /non-empty/.test(textOf(empty)), 'kill_process {name:"   "} is rejected (no empty-needle mass-kill)');

  // (6) SECURITY: a short substring matches NO exact image — it cannot fan out to csrss/services/lsass
  const broad = await full.call('tools/call', { name: 'kill_process', arguments: { name: 's' } });
  assert(broad.result?.isError === true && /no process named/.test(textOf(broad)), 'kill_process {name:"s"} matches no EXACT image (no substring fan-out to system processes)');

  // (7) SECURITY: the server cannot be told to terminate itself (or its host)
  const selfKill = await full.call('tools/call', { name: 'kill_process', arguments: { pid: full.pid } });
  assert(selfKill.result?.isError === true && /refusing to terminate this server/.test(textOf(selfKill)), 'kill_process {pid:<own server>} is refused (self/host protection)');

  // (8) os-gated: not exposed under safe
  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'kill', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(!names.includes('kill_process'), 'kill_process is NOT exposed under the safe profile (os-gated)');
} finally {
  full.kill();
  safe.kill();
  for (const pid of spawned) if (alive(pid)) try { process.kill(pid); } catch {}
}

console.log(failures === 0 ? '\nPASS — kill_process terminates by pid/name with killed/denied/not-found granularity, os-gated.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
