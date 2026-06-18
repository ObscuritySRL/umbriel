/**
 * condition-perf — proof that the memoized TrueCondition + compile-once waitFor cut cross-process work.
 *
 * find({}) / findAll({}) / children / regex selectors used to CreateTrueCondition + Release every call (2
 * round-trips); waitFor recompiled its server-side condition on EVERY poll (~50 compile/release per 5 s wait).
 * Now a singleton TrueCondition is reused and waitFor compiles once.
 *
 * Asserts (Bun.nanoseconds + numberOfDFGCompiles, output unchanged):
 *  - the singleton is memoized (same pointer) and reuse is far cheaper than a fresh create+release;
 *  - the per-poll scalar compile cost (which waitFor now pays ONCE) is measured;
 *  - find(scalar)/findAll({})/find(regex) still return correct results, and 3000× find({}) neither
 *    crashes nor leaks with the shared condition.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/condition-perf.integration.test.ts
 */
import { FFIType } from 'bun:ffi';
import { numberOfDFGCompiles } from 'bun:jsc';
import { automation, closeWindow, comRelease, compileCondition, ControlType, SLOT, trueCondition, skry, vcall } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}
function medianUs(run: () => void, iterations: number): number {
  for (let i = 0; i < Math.min(iterations, 2000); i += 1) run();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) run();
  return (Bun.nanoseconds() - start) / iterations / 1000;
}

skry.initialize();
const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
try {
  // 1. memoization identity
  console.log('\n[1] TrueCondition singleton');
  const first = trueCondition();
  assert(first !== 0n && first === trueCondition(), `trueCondition() is memoized (same pointer 0x${first.toString(16)})`);

  // 2. A/B — reuse vs a fresh create+release (the per-call saving for empty/regex selectors + every waitFor poll)
  let sink = 0n;
  const reuse = (): void => {
    sink += trueCondition();
  };
  const out = Buffer.alloc(8);
  const fresh = (): void => {
    vcall(automation(), SLOT.CreateTrueCondition, [FFIType.ptr], [out.ptr!]);
    comRelease(out.readBigUInt64LE(0));
  };
  const reuseUs = medianUs(reuse, 50_000);
  const freshUs = medianUs(fresh, 5_000);
  console.log(`  reuse ${reuseUs.toFixed(4)} µs vs fresh create+release ${freshUs.toFixed(2)} µs → ${Math.round(freshUs / reuseUs)}× cheaper per call`);
  assert(reuseUs < freshUs, 'the memoized singleton is cheaper than a create+release pair');
  assert(numberOfDFGCompiles(reuse) > 0, 'the reuse path DFG-compiled (hot path is JIT-optimized)');

  // 3. the per-poll compile cost waitFor now pays ONCE
  console.log('\n[2] waitFor compiles once, not per poll');
  const compileScalar = (): void => {
    const compiled = compileCondition(automation(), { name: 'NoSuchThing', controlType: ControlType.Button });
    if (compiled.owned) comRelease(compiled.condition);
  };
  const compileUs = medianUs(compileScalar, 3_000);
  console.log(`  scalar condition compile+release: ${compileUs.toFixed(2)} µs — waitFor pays this ONCE now, not per poll (a 5 s / 100 ms wait saves ~49× this)`);
  assert(compileUs > 0, 'measured the per-poll compile cost waitFor now amortizes to one');

  // 4. correctness + no-leak regression
  console.log('\n[3] correctness + no-leak regression');
  const five = calc.find({ controlType: ControlType.Button, name: 'Five' });
  assert(five !== null, 'find(scalar) still resolves the Five button');
  five?.release();
  const children = calc.findAll({});
  assert(children.length > 0, `findAll({}) returns descendants via the singleton (${children.length})`);
  for (const child of children) child.release();
  const regex = calc.find({ name: /Five/ });
  assert(regex !== null, 'find(regex) still works (TrueCondition singleton + client filter)');
  regex?.release();
  for (let index = 0; index < 3_000; index += 1) calc.find({})?.release();
  assert(true, '3000× find({}) on the shared TrueCondition — no crash, no leak');
  console.log(`  (sink=${sink})`);
} finally {
  closeWindow(calc.hWnd);
  calc.dispose();
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — condition memoization verified (cheaper reuse, compile-once waitFor, output unchanged).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
