/**
 * manage-process — manage_process controls a live process by pid WITHOUT killing it: suspend freezes EVERY thread
 * (toolhelp thread snapshot → OpenThread(THREAD_SUSPEND_RESUME) → SuspendThread), resume thaws it, priority renices it
 * (OpenProcess(PROCESS_SET_INFORMATION) → SetPriorityClass). Fills the kill-but-can't-pause gap — freeze a runaway,
 * drop a CPU hog to idle — natively, no pssuspend/PowerShell. FFI-only (ntdll's NtSuspendProcess isn't bound); os-gated;
 * never targets this server or its host (the kill_process security lesson).
 *
 * Proof: against a self-spawned `ping`, suspend reports threads frozen and the process stays ALIVE (not killed), resume
 * thaws it, priority sets idle; the server refuses to suspend its OWN pid; a missing pid is not-found; a bad action and
 * the safe profile (os-gated) both refuse.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/manage-process.integration.test.ts
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
const isErr = (m: Rpc): boolean => m.result?.isError === true;
const act = (full: ReturnType<typeof connect>, args: unknown) => full.call('tools/call', { name: 'manage_process', arguments: args });

const ping = Bun.spawn(['ping', '-n', '30', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
const pingPid = ping.pid;
const full = connect('full');
const safe = connect('safe');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'manage', version: '1' } });
  await Bun.sleep(250);

  const suspended = await act(full, { pid: pingPid, action: 'suspend' });
  console.log(`  suspend → ${JSON.stringify(textOf(suspended))}`);
  assert(/suspended pid \d+ \(\d+ threads?\)/.test(textOf(suspended)), 'manage_process suspend freezes the process threads');
  const listText = textOf(await full.call('tools/call', { name: 'list_processes', arguments: {} }));
  assert(new RegExp(`\\b${pingPid}\\b`).test(listText), 'the suspended process is still ALIVE (suspend ≠ kill)');
  assert(/resumed pid \d+/.test(textOf(await act(full, { pid: pingPid, action: 'resume' }))), 'manage_process resume thaws the process');
  assert(/priority to idle/.test(textOf(await act(full, { pid: pingPid, action: 'priority', priority: 'idle' }))), 'manage_process priority renices the process (idle)');

  const self = await act(full, { pid: full.pid, action: 'suspend' });
  assert(isErr(self) && /refusing/.test(textOf(self)), 'manage_process refuses to suspend its OWN server pid (self/host protection)');
  const missing = await act(full, { pid: 999_999, action: 'suspend' });
  assert(isErr(missing) && /no such process/.test(textOf(missing)), 'manage_process on a missing pid reports not-found');
  const badAction = await act(full, { pid: pingPid, action: 'frobnicate' });
  assert(isErr(badAction) && /action must be/.test(textOf(badAction)), 'manage_process rejects an unknown action');

  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'manage', version: '1' } });
  const list = await safe.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(!names.includes('manage_process'), 'manage_process is NOT exposed under the safe profile (os-gated)');
} finally {
  ping.kill();
  full.kill();
  safe.kill();
}

console.log(failures === 0 ? '\nPASS — manage_process suspends/resumes/reprioritizes a process natively, self-protected, os-gated.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
