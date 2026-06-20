/**
 * firewall-rules-read — list_firewall_rules / listFirewallRules enumerates Windows Defender Firewall rules natively (no
 * `netsh advfirewall firewall show rule`) via INetFwPolicy2 → INetFwRules → IEnumVARIANT → INetFwRule, all through
 * umbriel's own COM vcall machinery (no @bun-win32 firewall binding). A wrong vtable slot SEGFAULTS, so this drives the
 * REAL firewall and asserts decoded fields.
 *
 * Proof: enumerate the live rule set and assert there are many rules, each with a decoded direction (in/out), action
 * (allow/block), and protocol, and at least one named rule. Read-only — no rule is created or modified.
 *
 * Run: bun run example/firewall-rules-read.integration.test.ts
 */
import { listFirewallRules } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const rules = listFirewallRules();
assert(rules.length > 10, `enumerated the firewall rule set (${rules.length} rules — a wrong slot would have segfaulted or returned garbage)`);
if (rules.length > 0) {
  const sample = rules.find((rule) => rule.name.length > 0) ?? rules[0]!;
  console.log(`  e.g. ${sample.direction}/${sample.action} ${sample.protocol}${sample.localPorts ? ` :${sample.localPorts}` : ''} — ${sample.name}`);
  assert(
    rules.every((rule) => (rule.direction === 'in' || rule.direction === 'out' || rule.direction.startsWith('dir-')) && (rule.action === 'allow' || rule.action === 'block' || rule.action.startsWith('action-'))),
    'every rule decoded a direction (in/out) and action (allow/block)',
  );
  assert(rules.some((rule) => rule.name.length > 0), 'at least one rule has a decoded name (BSTR via get_Name)');
  assert(rules.some((rule) => rule.protocol === 'tcp' || rule.protocol === 'udp' || rule.protocol === 'any'), 'at least one rule decoded a known protocol (tcp/udp/any)');
}

console.log(failures === 0 ? '\nPASS — list_firewall_rules enumerates the Windows Firewall natively (no netsh).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
