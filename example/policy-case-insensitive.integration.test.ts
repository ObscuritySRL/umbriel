/**
 * policy-case-insensitive — UMBRIEL_ALLOW / UMBRIEL_DENY must match tool names + categories case-INSENSITIVELY.
 * Every tool name and all 5 categories (read/input/window/os/fs) are lowercase, so before envSet lowercased its
 * entries a case variant never matched — and DENY failing to match fails OPEN: a deployer who sets UMBRIEL_DENY=OS
 * to forbid the destructive os category would still get those tools served by tools/list, silently defeating the
 * documented deny-wins guarantee. (ALLOW failing on case is harmless — it fails closed.)
 *
 * Proof (live, MCP subprocess — no desktop):
 *  - UMBRIEL_PROFILE=full + UMBRIEL_DENY=OS (UPPERCASE): an os tool (kill_process) must be ABSENT from tools/list
 *    (deny wins, case-insensitively); a non-denied fs tool (read_file) must still be present (deny is scoped).
 *  - UMBRIEL_PROFILE=readonly + UMBRIEL_ALLOW=Input (Capitalized): an input tool (click) must be PRESENT (allow
 *    grants it case-insensitively, over the read-only profile).
 *
 * bun test is broken repo-wide for FFI — runnable harness (only the MCP subprocess):
 * Run: bun run example/policy-case-insensitive.integration.test.ts
 */
type Rpc = { id?: number; result?: { tools?: { name?: string }[] } };

async function toolsUnder(env: Record<string, string>): Promise<string[]> {
  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, ...env } });
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
  try {
    await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'policy-case', version: '1' } });
    const list = await call('tools/list', {});
    return (list.result?.tools ?? []).map((tool) => tool.name ?? '');
  } finally {
    proc.kill();
  }
}

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const denied = await toolsUnder({ UMBRIEL_PROFILE: 'full', UMBRIEL_OS: '1', UMBRIEL_DENY: 'OS' });
assert(!denied.includes('kill_process'), 'UMBRIEL_DENY=OS (uppercase) denies the os tool kill_process — deny wins case-insensitively (was: stayed reachable)');
assert(denied.includes('read_file'), 'UMBRIEL_DENY=OS does not over-deny — the fs tool read_file is still served (deny is scoped to the os category)');

const allowed = await toolsUnder({ UMBRIEL_PROFILE: 'readonly', UMBRIEL_ALLOW: 'Input' });
assert(allowed.includes('click'), 'UMBRIEL_ALLOW=Input (capitalized) grants the input tool click over the readonly profile — allow matches case-insensitively');
assert(!allowed.includes('kill_process'), 'UMBRIEL_ALLOW=Input does not leak unrelated categories — the os tool kill_process stays gated');

console.log(failures === 0 ? '\nPASS — UMBRIEL_ALLOW/UMBRIEL_DENY match tool names + categories case-insensitively; deny-wins holds.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
