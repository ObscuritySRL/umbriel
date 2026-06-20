/**
 * registry-data-not-journaled — a credential carried in registry_set's `data` PAYLOAD must not land verbatim in either
 * forensic sink. maskArgs masks string values under the TRACE_MASK_KEYS set; that set was {content,text,value}, so
 * registry_set's secret payload (a REG_SZ connection string like `Server=…;Password=…`) — carried in `data`, a key in
 * NONE of those sets — was written in clear to BOTH the stderr [umbriel-audit] line AND the UMBRIEL_TRACE JSONL the
 * deployer treats as trusted forensic output. (Worse, registry_set's `value` arg is the value NAME, not the payload,
 * yet `value` WAS masked — the masking landed on the wrong field.) The fix adds `data` to TRACE_MASK_KEYS so the string
 * payload collapses to its length, exactly like set_env's `value`, while DWORD/QWORD `data` (an integer) stays legible.
 *
 * Proof (live, over the REAL stdio server under UMBRIEL_PROFILE=full + UMBRIEL_TRACE): registry_set with {confirm:false}
 * REFUSES before any registry write (nothing is mutated — no cleanup), yet is still audited with masked args. Asserts a
 * REG_SZ secret payload appears in NEITHER sink while its length `<N chars>` is recorded (forensic signal survives), and
 * that a REG_DWORD integer payload stays legible (`"data":1234`) — the mask is type-aware, only strings collapse.
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/registry-data-not-journaled.integration.test.ts
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET = 'Server=db;Password=hunter2-TOPSECRET-CONNSTRING'; // a REG_SZ payload shaped like a real connection string
const tracePath = join(tmpdir(), `umbriel-regmask-${process.pid}-${Date.now()}.jsonl`);
await rm(tracePath, { force: true });

let auditText = '';
const server = Bun.spawn(['bun', `${import.meta.dir}/../mcp.ts`], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  env: { ...Bun.env, UMBRIEL_PROFILE: 'full', UMBRIEL_AUDIT: 'on', UMBRIEL_TRACE: tracePath },
});
const decoder = new TextDecoder();
const encoder = new TextEncoder();
void (async () => {
  for await (const chunk of server.stderr) auditText += decoder.decode(chunk);
})();
const pending = new Map<number, (message: { result?: Record<string, unknown> }) => void>();
let buffer = '';
let nextId = 1;
void (async () => {
  for await (const chunk of server.stdout) {
    buffer += decoder.decode(chunk);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        const message = JSON.parse(line);
        if (typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
})();
const call = (method: string, params: unknown): Promise<{ result?: Record<string, unknown> }> => {
  const id = nextId++;
  server.stdin.write(encoder.encode(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`));
  server.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regmask', version: '1' } });
  // {confirm:false} → the handler refuses BEFORE any registrySet() call, so NO registry value is written/changed; the
  // call is still audited (ok:false) with masked args — exactly the sink the payload must never reach verbatim.
  await call('tools/call', { name: 'registry_set', arguments: { hive: 'HKCU', key: 'Software\\UmbrielMaskProbe', value: 'ConnStr', type: 'REG_SZ', data: SECRET, confirm: false } });
  await call('tools/call', { name: 'registry_set', arguments: { hive: 'HKCU', key: 'Software\\UmbrielMaskProbe', value: 'Count', type: 'REG_DWORD', data: 1234, confirm: false } });
  await Bun.sleep(300); // let the trace appendFile + audit flush

  const trace = await Bun.file(tracePath).text().catch(() => '');
  const auditLines = auditText.split('\n').filter((line) => line.includes('[umbriel-audit]'));
  const audit = auditLines.join('\n');

  assert(auditLines.length >= 2, `both registry_set calls were audited (saw ${auditLines.length} audit lines)`);
  assert(!audit.includes(SECRET), 'the REG_SZ data secret is NOT in the stderr audit line');
  assert(!trace.includes(SECRET), 'the REG_SZ data secret is NOT in the trace JSONL');
  assert(audit.includes(`"data":"<${SECRET.length} chars>"`), `the REG_SZ data is recorded as its length (<${SECRET.length} chars> — forensic signal survives)`);
  // The integer DWORD payload is not a free-text secret — it stays legible (type-aware mask: only string `data` collapses).
  assert(audit.includes('"data":1234'), 'the REG_DWORD integer data stays legible in the audit line (only string data is masked)');
} finally {
  server.kill();
  await rm(tracePath, { force: true });
}

console.log(failures === 0 ? '\nPASS — a credential in registry_set.data is masked to its length in BOTH the audit and the trace; the DWORD integer stays legible; no verbatim leak.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
