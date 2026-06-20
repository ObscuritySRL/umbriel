/**
 * service-config-read — control_service {action:"config"} / readServiceConfig reports a service's static config (how it
 * starts, the binary/command line it runs, the account) via QueryServiceConfigW — what list_services (name/state) and
 * control_service query (state/pid) omit, so an AI can see WHAT a service runs and HOW it autoloads without `sc qc`.
 *
 * Proof: read the config of a core always-present service and assert a decoded start-type, a real exe command line, and
 * an account. No GUI, no COM apartment — pure advapi32 read.
 *
 * Run: bun run example/service-config-read.integration.test.ts
 */
import { readServiceConfig } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const candidates = ['RpcSs', 'EventLog', 'Schedule', 'Winmgmt', 'Dnscache', 'Spooler'];
let found: { name: string; startType: string; binaryPath: string; account: string } | null = null;
for (const name of candidates) {
  const config = readServiceConfig(name);
  if (config !== null) {
    found = { name, ...config };
    break;
  }
}

assert(found !== null, `readServiceConfig resolved a core service's config (tried ${candidates.join(', ')})`);
if (found !== null) {
  console.log(`  ${found.name}: start=${found.startType}, account=${found.account}\n    ${found.binaryPath}`);
  assert(/\.exe/i.test(found.binaryPath), `binaryPath is a real command line with an exe (${found.binaryPath.slice(0, 50)})`);
  assert(found.startType.length > 0 && !found.startType.startsWith('start-'), `startType decoded to a known value (${found.startType})`);
  assert(found.account.length > 0, `account decoded (${found.account})`);
}

console.log(failures === 0 ? '\nPASS — control_service config reports a service start-type / binary / account natively.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
