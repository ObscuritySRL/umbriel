/**
 * scheduled-tasks — list_scheduled_tasks enumerates every Windows scheduled task NATIVELY via COM (CLSID_TaskScheduler
 * → ITaskService → ITaskFolder → IRegisteredTask), driven entirely through umbriel's OWN vcall/guid/comRelease — no
 * @bun-win32/taskschd package and no schtasks/Get-ScheduledTask shell. THE #1 autorun/persistence surface: path, name,
 * state, enabled, last + next run, and last result code, recursively across all task folders (hidden included).
 * category 'read'. Every vtable slot is verified live AND against taskschd.h (test/slot-gate.test.ts) — a wrong slot
 * segfaults, and the get+put Enabled property shifts get_LastRunTime to slot 15, the off-by-one this proves correct.
 *
 * Proof over the real stdio MCP server (read-only — no task created/run/modified): hundreds of tasks render in
 * "path\name — state, last … (0x…), next …" form; a {folder} prefix filters to that subtree; {enabledOnly} drops the
 * disabled ones; and list_scheduled_tasks is available under the readonly profile.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/scheduled-tasks.integration.test.ts
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
const TASK_LINE = /^(?:\[disabled\] )?\\.+ — (ready|disabled|running|queued|unknown), last .+ \(0x[0-9a-f]+\), next /m;

const readonly = connect('readonly');
try {
  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'tasks', version: '1' } });

  const all = textOf(await readonly.call('tools/call', { name: 'list_scheduled_tasks', arguments: {} }));
  const allCount = Number(/^(\d+) scheduled tasks:/.exec(all)?.[1] ?? '0');
  console.log(`  list_scheduled_tasks → ${allCount} tasks; first: ${JSON.stringify(all.split('\n')[1])}`);
  assert(allCount > 10 && TASK_LINE.test(all), 'list_scheduled_tasks returns many tasks in "path\\name — state, last … (0x…), next …" form');

  const microsoft = textOf(await readonly.call('tools/call', { name: 'list_scheduled_tasks', arguments: { folder: '\\Microsoft' } }));
  const microsoftLines = microsoft.split('\n').slice(1);
  assert(microsoftLines.length > 0 && microsoftLines.every((line) => line.replace(/^\[disabled\] /, '').startsWith('\\Microsoft')), 'a {folder:"\\\\Microsoft"} prefix filters to that subtree');
  assert(Number(/^(\d+)/.exec(microsoft)?.[1] ?? '0') < allCount, 'the folder filter returns fewer tasks than the unfiltered list');

  const enabled = textOf(await readonly.call('tools/call', { name: 'list_scheduled_tasks', arguments: { enabledOnly: true } }));
  assert(!enabled.includes('[disabled]'), '{enabledOnly:true} drops disabled tasks');

  const list = await readonly.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('list_scheduled_tasks'), 'list_scheduled_tasks IS exposed under the readonly profile (category read)');
} finally {
  readonly.kill();
}

console.log(failures === 0 ? '\nPASS — list_scheduled_tasks enumerates the scheduler tree natively via COM (slots verified), read-only.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
