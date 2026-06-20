/**
 * process-info-image-path — process_info / processInfo() now reports the on-disk image path (the exe a pid is really
 * running), the "what IS this process" datum it omitted, so an AI can disambiguate two same-named processes without a
 * shell (tasklist/Get-Process/wmic). Read via QueryFullProcessImageNameW on the same OpenProcess(QUERY_LIMITED_INFORMATION)
 * handle processInfo already opens — no new binding.
 *
 * Proof: introspect THIS process (pid = process.pid) and assert imagePath is a real .exe path. No GUI, deterministic.
 *
 * Run: bun run example/process-info-image-path.integration.test.ts
 */
import { processInfo } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const info = processInfo(process.pid);
assert(info !== null, `processInfo resolves the current process (pid ${process.pid})`);
if (info !== null) {
  assert(info.imagePath !== '', `imagePath is populated: ${info.imagePath}`);
  assert(/\.exe$/i.test(info.imagePath), 'imagePath is a real on-disk .exe path');
  assert(/[/\\]/.test(info.imagePath), 'imagePath is a full path (has a directory separator), not just a name');
}

console.log(failures === 0 ? '\nPASS — process_info reports the on-disk image path of a process.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
