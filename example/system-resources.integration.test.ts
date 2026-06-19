/**
 * system-resources — the `system_resources` tool answers "how much memory / CPU are we using?" NATIVELY, so an AI
 * never shells out to PowerShell (Get-Counter / Get-Process). RAM (GlobalMemoryStatusEx), system-wide CPU % (two
 * GetSystemTimes samples), uptime (GetTickCount64), process count. Benchmark-chosen FFI over node:os
 * (GlobalMemoryStatusEx 1.3x faster than os.freemem; GetSystemTimes 12.3x faster than os.cpus()).
 *
 * Proof over the real stdio MCP server (read-only, no GUI): system_resources returns a CPU %, a total/used RAM, a
 * process count, and an uptime — all in sane ranges.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/system-resources.integration.test.ts
 */
import { systemResources } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// (1) facade — values in sane ranges
const r = await systemResources(150);
console.log(`  systemResources() → CPU ${r.cpuPercent}% · RAM ${r.memoryAvailableMB}/${r.memoryTotalMB} MB free · ${r.processes} procs · ${r.uptimeSeconds}s up`);
assert(r.memoryTotalMB > 256 && r.memoryAvailableMB > 0 && r.memoryAvailableMB <= r.memoryTotalMB, 'reports total RAM and a 0<avail<=total available RAM');
assert(r.cpuPercent >= 0 && r.cpuPercent <= 100, 'CPU % is in [0,100]');
assert(r.memoryLoadPercent >= 0 && r.memoryLoadPercent <= 100, 'memory load % is in [0,100]');
assert(r.processes > 10 && r.uptimeSeconds > 0, 'reports a plausible process count and uptime');

// (2) over the real MCP tool
type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'readonly' } });
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
try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'system-resources', version: '1' } });
  const text = (await call('tools/call', { name: 'system_resources', arguments: { sampleMs: 120 } })).result?.content?.[0]?.text ?? '';
  console.log(`  system_resources → ${JSON.stringify(text)}`);
  assert(/CPU \d+% · RAM .* GB used .* · \d+ processes · up \d+h\d+m/.test(text), 'the MCP tool renders CPU / RAM / processes / uptime');
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — system_resources reports CPU / memory / uptime / process count natively (no shell).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
