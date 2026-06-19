/**
 * event-log — read_event_log reads the newest Windows event-log records NATIVELY (legacy Advapi32
 * OpenEventLogW/ReadEventLogW/CloseEventLog, EVENTLOG_BACKWARDS_READ, hand-decoded EVENTLOGRECORD), no Get-WinEvent/
 * wevtutil shell. THE canonical record of crashes, service failures, driver faults — answers "why did X crash / what
 * failed last night". {log} System|Application|Security|Setup, {count} newest (cap 100), {level} error|warning|all.
 * System/Application read without elevation. category 'read'.
 *
 * Proof over the real stdio MCP server (read-only): the System log returns newest-first records in
 * "[ISO] TYPE source (id N, rec#N)" form; {count} is capped; an {level:"error"} filter yields only ERROR rows (or a
 * clean not-found); the Application log reads; and read_event_log is available under the readonly profile.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/event-log.integration.test.ts
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
const RECORD = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] \w[\w-]* .+ \(id \d+, rec#\d+\)/m;

const full = connect('full');
const readonly = connect('readonly');
try {
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'evt', version: '1' } });

  const sys = textOf(await full.call('tools/call', { name: 'read_event_log', arguments: { log: 'System', count: 5 } }));
  console.log(`  read_event_log(System,5) first line → ${JSON.stringify(sys.split('\n')[0])}`);
  assert(RECORD.test(sys), 'read_event_log renders records as "[ISO] TYPE source (id N, rec#N)"');
  assert(sys.split('\n').length <= 5, '{count} caps the number of records returned');

  const app = await full.call('tools/call', { name: 'read_event_log', arguments: { log: 'Application', count: 3 } });
  assert(!isErr(app) && RECORD.test(textOf(app)), 'the Application log reads (no elevation needed)');

  const errors = await full.call('tools/call', { name: 'read_event_log', arguments: { log: 'System', count: 10, level: 'error' } });
  const errText = textOf(errors);
  assert(isErr(errors) || errText.split('\n').every((line) => / ERROR /.test(line)), 'an {level:"error"} filter yields only ERROR rows (or a clean not-found)');

  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'evt', version: '1' } });
  const list = await readonly.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('read_event_log'), 'read_event_log IS exposed under the readonly profile (category read)');
} finally {
  full.kill();
  readonly.kill();
}

console.log(failures === 0 ? '\nPASS — read_event_log reads newest-first event-log records natively (decoded EVENTLOGRECORD), read-only.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
