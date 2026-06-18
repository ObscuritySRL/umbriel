/**
 * open-path-safe — open_path must NOT be command-injectable.
 *
 * The handler used `cmd /c start "" <path>`, and cmd re-parses its arguments, so a path containing shell
 * metacharacters (`"` `&` `%VAR%`) injected arbitrary commands — behind a benign "open with the default handler"
 * label, grantable in isolation via SKRY_ALLOW=open_path. openPath() now uses ShellExecuteW: the path is a real
 * lpFile string, no shell, no command-line re-parse.
 *
 * Proof (side-effect-free): a path crafted to drop a sentinel file IF re-parsed by a shell opens nothing and the
 * sentinel is NEVER created; openPath returns false (ShellExecuteW HINSTANCE <= 32 for the bogus filename).
 *
 * bun test is broken repo-wide — runnable harness (spawns no app/window; ShellExecuteW on a bogus file just errors):
 * Run: bun run example/open-path-safe.integration.test.ts
 */
import { openPath, skry } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const sentinel = `${import.meta.dir}/../.scratch/openpath-injection-sentinel.txt`;
await Bun.$`rm -f ${sentinel}`.quiet().nothrow();
// If any shell re-parses this, the embedded command drops the sentinel; ShellExecuteW must treat it as one filename.
const injection = `zzz_nonexistent" & cmd /c echo pwned > "${sentinel}" & echo "`;

skry.initialize();
try {
  const opened = openPath(injection);
  await Bun.sleep(500); // give any (wrongly) spawned command time to run
  const pwned = await Bun.file(sentinel).exists();
  assert(!pwned, 'a path with shell metacharacters executes NO command (the sentinel was never written) — no injection');
  assert(opened === false, 'openPath returns false for the bogus/injection path (ShellExecuteW could not open it)');
} finally {
  await Bun.$`rm -f ${sentinel}`.quiet().nothrow();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — open_path uses ShellExecuteW: no shell, no command-line re-parse, no injection.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
