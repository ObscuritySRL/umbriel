/**
 * wait-for-process-gone — wait_for_process gained a {gone} edge. Before, every wait tool had a "negative" edge
 * EXCEPT process exit: wait_for {gone}, wait_for_window {gone} both wait for a thing to DISAPPEAR, but
 * wait_for_process only waited for a process to APPEAR. So "wait until this installer/build/conversion/launched-app
 * FINISHES" forced a hand-rolled poll over list_processes (a full toolhelp32 enumeration of 400+ processes) each
 * tick — and wait_for_window {gone} is NOT a substitute: a windowless process owns no visible window, so it resolves
 * IMMEDIATELY (a false "done"). Now waitForProcessGone opens a SYNCHRONIZE handle to each match and polls the
 * OS-signaled handle (WaitForSingleObject(h,0)) O(1) per tick until the process actually exits.
 *
 * Proof, fully self-contained (spawns a windowless ~3s `ping -n 4`, which exits on its own — nothing to close):
 *   (1) waitForWindowGone on the windowless process returns ≈immediately — the false-positive being fixed;
 *   (2) waitForProcessGone BLOCKS until ping actually exits (waited > 1.5s);
 *   (3) once gone, a second waitForProcessGone returns ≈immediately.
 * Use a SPECIFIC image name ("ping.exe", not "ping") — the needle is a substring match (so "ping" also matches
 * "SnippingTool.exe"), exactly like wait_for_process / list_processes.
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/wait-for-process-gone.integration.test.ts
 */
import { umbriel, waitForProcessGone, waitForWindowGone } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
try {
  const child = Bun.spawn(['C:\\Windows\\System32\\PING.EXE', '-n', '4', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
  await Bun.sleep(400); // let it register in the process table

  const windowGoneStart = Bun.nanoseconds();
  await waitForWindowGone({ title: 'PING.EXE' }, { timeout: 8000 }).catch(() => {});
  const windowGoneMs = (Bun.nanoseconds() - windowGoneStart) / 1e6;
  assert(windowGoneMs < 500, `waitForWindowGone returns ≈immediately for a windowless process (the false "done" being fixed) — ${Math.round(windowGoneMs)}ms`);

  const goneStart = Bun.nanoseconds();
  await waitForProcessGone('ping.exe', { timeout: 12000 });
  const goneMs = (Bun.nanoseconds() - goneStart) / 1e6;
  assert(goneMs > 1500, `waitForProcessGone BLOCKED until ping actually exited (waited for the real exit, not a false-immediate) — ${Math.round(goneMs)}ms`);

  const idempotentStart = Bun.nanoseconds();
  await waitForProcessGone('ping.exe', { timeout: 5000 });
  const idempotentMs = (Bun.nanoseconds() - idempotentStart) / 1e6;
  assert(idempotentMs < 800, `waitForProcessGone returns ≈immediately when nothing matches is running — ${Math.round(idempotentMs)}ms`);

  void child;
} finally {
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — wait_for_process {gone} waits for a windowless process to actually exit (OS-signaled, O(1) per tick).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
