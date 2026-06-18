/**
 * Shared test harness for the skry integration tests (example/<name>.integration.test.ts).
 *
 * Each test file is a standalone `bun run` script (bun test is broken repo-wide), so before this
 * module every file inlined three identical primitives. This factors them out without changing any
 * assertion: the MCP stdio JSON-RPC client (spawnServer), the pass/fail reporter (assert/finish),
 * and the JSON-RPC message type (Rpc). It deliberately imports nothing from the package so a pure
 * MCP-client test does not pull the FFI/COM surface into its own process; app-launching files keep
 * their own `skry.launch` / `closeWindow` lines, which vary per target and are not boilerplate.
 *
 * Run any test: bun run example/<name>.integration.test.ts
 */
export type Rpc = {
  error?: unknown;
  id?: number;
  result?: {
    content?: { text?: string; type?: string }[];
    instructions?: string;
    isError?: boolean;
    serverInfo?: { name?: string; version?: string };
    tools?: { description?: string; name: string }[];
  };
};

export type Server = {
  call: (method: string, params: unknown) => Promise<Rpc>;
  endInput: () => void;
  kill: () => void;
  textOf: (message: Rpc) => string;
};

/** Spawn the MCP server over stdio and return a newline-framed JSON-RPC client. `env` is merged onto Bun.env (default profile=safe). */
export function spawnServer(env: Record<string, string> = { SKRY_PROFILE: 'safe' }): Server {
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
  const textOf = (message: Rpc): string => message.result?.content?.[0]?.text ?? '';
  return { call, endInput: (): void => void proc.stdin.end(), kill: (): void => void proc.kill(), textOf };
}

let asserted = 0;
let failures = 0;

/** Record one truth check: log `ok:`/`FAIL:` and bump the module assertion/failure counters that finish() reads. */
export function assert(condition: boolean, message: string): void {
  asserted += 1;
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

/** Number of failed assertions so far — for the rare file that branches on its own running tally. */
export function failureCount(): number {
  return failures;
}

/** Print the final status line and exit. A run that asserted nothing (every path skipped) is INCONCLUSIVE (exit 2), never a vacuous PASS. */
export function finish(passMessage: string): never {
  if (failures > 0) {
    console.log(`\nFAILED — ${failures} assertion(s)`);
    process.exit(1);
  }
  if (asserted === 0) {
    console.log('\nINCONCLUSIVE — 0 assertions ran (scenario not exercised)');
    process.exit(2);
  }
  console.log(`\n${passMessage}`);
  process.exit(0);
}

/** Log a skipped scenario without recording an assertion — so a run that only skips finishes INCONCLUSIVE, not a green PASS. */
export function skip(reason: string): void {
  console.log(`  skip: ${reason}`);
}
