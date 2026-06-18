/**
 * harness-asserted-guard — _harness.ts finish() must make a zero-assertion run NON-GREEN. A test whose every truth
 * check sits behind a skip branch (skip(reason) records no assertion) used to print the PASS line and exit 0, so a
 * guard that silently stopped being exercised masqueraded as proof. finish() now exits 2 (INCONCLUSIVE) when no
 * assert() ran, 1 when any assert() failed, and 0 only when at least one assert() ran and all passed.
 *
 * Proof: spawn three throwaway scripts that import the real _harness and drive each branch — skip-only, one passing
 * assert, one failing assert — and check the exit code + the headline line of each. No app window is launched.
 *
 * bun test is broken repo-wide — runnable harness (three child `bun run` scripts importing _harness):
 * Run: bun run example/harness-asserted-guard.integration.test.ts
 */
import { assert, finish } from './_harness';

const dir = import.meta.dir.replaceAll('\\', '/');
const harness = `${dir}/_harness`;

async function runScenario(body: string): Promise<{ exitCode: number; stdout: string }> {
  const path = `${dir}/.harness-guard-${Bun.nanoseconds()}.ts`;
  await Bun.write(path, `import { assert, finish, skip } from '${harness}';\n${body}\n`);
  try {
    const proc = Bun.spawn(['bun', 'run', path], { stdout: 'pipe', stderr: 'ignore' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout };
  } finally {
    await Bun.file(path).delete();
  }
}

const skipOnly = await runScenario(`skip('scenario not reachable here');\nfinish('PASS — should never print');`);
const onePass = await runScenario(`assert(true, 'the headline effect held');\nfinish('PASS — real check ran');`);
const oneFail = await runScenario(`assert(false, 'the headline effect did NOT hold');\nfinish('PASS — should never print');`);

assert(skipOnly.exitCode === 2 && /INCONCLUSIVE — 0 assertions ran/.test(skipOnly.stdout) && !/PASS/.test(skipOnly.stdout), `a skip-only run exits 2 INCONCLUSIVE, not a vacuous PASS (exit=${skipOnly.exitCode})`);
assert(onePass.exitCode === 0 && /PASS — real check ran/.test(onePass.stdout), `a run with one passing assert exits 0 PASS (exit=${onePass.exitCode})`);
assert(oneFail.exitCode === 1 && /FAILED — 1 assertion/.test(oneFail.stdout) && !/PASS/.test(oneFail.stdout), `a run with one failing assert exits 1 FAILED, never PASS (exit=${oneFail.exitCode})`);

finish('PASS — finish() makes a zero-assertion run INCONCLUSIVE (exit 2), so a guard that stops being exercised can never masquerade as green.');
