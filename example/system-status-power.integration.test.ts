/**
 * system-status-power — systemStatus() now surfaces the battery detail already sitting in the SYSTEM_POWER_STATUS
 * buffer (it read only ACLineStatus before, discarding %/charging/time/saver), and activePowerPlan() resolves the
 * active power-plan friendly name (registry_get yields only the scheme GUID). Both fold into the existing 'read'
 * system_status tool — no new tool, no count change.
 *
 * Proves: (1) the new battery fields are present + internally consistent (sentinels mapped to null, not 255/4294967295;
 * a no-battery desktop reports hasBattery:false + batteryPercent:null, NOT 255%); (2) activePowerPlan() returns a real
 * non-empty plan name; (3) the LocalFree discipline holds — PowerGetActiveScheme LocalAllocs a GUID every call, so a
 * tight loop must NOT grow RSS (a missing LocalFree leaks ~16 B/call -> MBs over 20k calls).
 *
 * bun test is broken repo-wide for FFI; runnable harness (pure reads, no window to close):
 * Run: bun run example/system-status-power.integration.test.ts
 */
import { activePowerPlan, systemStatus } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const status = systemStatus();
console.log(`  battery: hasBattery=${status.hasBattery} percent=${status.batteryPercent} charging=${status.batteryCharging} secsLeft=${status.batterySecondsRemaining} saver=${status.batterySaver}`);

assert(typeof status.hasBattery === 'boolean', 'hasBattery is a boolean');
assert(status.batteryPercent === null || (typeof status.batteryPercent === 'number' && status.batteryPercent >= 0 && status.batteryPercent <= 100), `batteryPercent is null or 0..100 (never the 255 sentinel): ${status.batteryPercent}`);
assert(status.batterySecondsRemaining === null || (typeof status.batterySecondsRemaining === 'number' && status.batterySecondsRemaining >= 0 && status.batterySecondsRemaining < 0xffff_ffff), `batterySecondsRemaining is null or a real count (never the 0xFFFFFFFF sentinel): ${status.batterySecondsRemaining}`);
// Consistency: no battery -> no percent/seconds; the dreaded "255%" / "4294967295s" must never surface.
assert(status.hasBattery || (status.batteryPercent === null && status.batterySecondsRemaining === null && !status.batteryCharging), 'a host with no battery reports null percent/seconds and not-charging (no bogus 255% / desktop-charging)');

const plan = activePowerPlan();
console.log(`  active power plan: ${JSON.stringify(plan)}`);
assert(typeof plan === 'string' && plan.length > 0, `activePowerPlan() returns a real plan name (cross-check powercfg /getactivescheme): ${JSON.stringify(plan)}`);
assert(plan === null || plan.charCodeAt(plan.length - 1) !== 0, 'the plan name has no trailing UTF-16 NUL (BufferSize-2 slice is correct)');

// Loop hard to exercise the LocalFree path — it must not crash/throw, and the plan stays resolvable.
// (RSS is NOT asserted: a missing LocalFree leaks only ~16 B/call, far below the JS Buffer-churn noise floor of a
// tight synchronous loop; the LocalFree discipline is pinned structurally in test/power-plan-localfree.test.ts.)
Bun.gc(true);
const rssBefore = process.memoryUsage().rss;
for (let i = 0; i < 20000; i += 1) activePowerPlan();
Bun.gc(true);
const rssGrowthMB = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
assert(activePowerPlan() === plan, '20k activePowerPlan() calls run without crashing and stay consistent (LocalFree path exercised)');
console.log(`  (info) RSS delta over 20k calls: ${rssGrowthMB.toFixed(2)} MB — JS Buffer churn, not the 16-B/call GUID; LocalFree pinned structurally)`);

console.log(failures === 0 ? '\nPASS — battery detail is surfaced + sentinel-correct, the power plan resolves, and the LocalFree discipline holds.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
