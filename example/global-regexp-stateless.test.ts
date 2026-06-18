/**
 * global-regexp-stateless — a RegExp selector carrying the g or y flag holds a stateful `lastIndex`; calling `.test()`
 * repeatedly over sibling names (matches()) or tree nodes (redactTree()) advances that index and makes every OTHER
 * match silently fail. In matches() that drops real targets from find_all; in redactTree() it leaks every other secret
 * (fail-open). Both now strip g/y to a stateless copy before testing.
 *
 * Pure-function proof (no UIA, no windows): a /save/gi selector over five "Save…" siblings must match ALL five, and a
 * /secret/gi pattern over a tree of matching names must mask EVERY node. The pre-fix code dropped alternating matches.
 *
 * bun test is broken repo-wide — this is a runnable script:
 * Run: bun run example/global-regexp-stateless.test.ts
 */
import { type ElementProperties, matches, redactTree, type UiaNode } from 'skry';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const element = (name: string): ElementProperties => ({ automationId: '', className: '', controlType: 0, name });

// 1) matches() with a global selector must match EVERY sibling, not every other one.
const siblings = ['Save', 'Save As', 'Save Copy', 'Save All', 'Save and Close'].map(element);
const globalSelector = { name: /save/gi };
const matched = siblings.filter((sibling) => matches(sibling, globalSelector));
assert(matched.length === siblings.length, `matches(): /save/gi matched all ${siblings.length} "Save…" siblings (got ${matched.length})`);

// 2) The same selector object reused again must still match all — proves no residual lastIndex leaked back onto it.
const matchedAgain = siblings.filter((sibling) => matches(sibling, globalSelector));
assert(matchedAgain.length === siblings.length, `matches(): re-running the SAME /save/gi selector still matched all ${siblings.length} (got ${matchedAgain.length})`);

// 3) A non-global selector still behaves exactly as before (regression guard).
assert(matches(element('Save As'), { name: /save/i }) && !matches(element('Open'), { name: /save/i }), 'matches(): plain /save/i still matches "Save As" and rejects "Open"');

// 4) redactTree() with a global pattern must mask EVERY matching node (no fail-open every-other leak).
const tree: UiaNode = {
  role: 'Window',
  name: 'root',
  children: [
    { role: 'Edit', name: 'secret-1', children: [] },
    { role: 'Edit', name: 'secret-2', children: [{ role: 'Edit', name: 'secret-3', children: [] }] },
    { role: 'Edit', name: 'secret-4', children: [] },
    { role: 'Edit', name: 'visible', children: [] },
  ],
};
const redacted = redactTree(tree, /secret/gi);
const names: string[] = [];
(function walk(node: UiaNode): void {
  names.push(node.name);
  for (const child of node.children) walk(child);
})(redacted);
const leaked = names.filter((name) => /secret/i.test(name));
assert(leaked.length === 0, `redactTree(): /secret/gi masked every secret node — none leaked (leaked: ${JSON.stringify(leaked)})`);
assert(names.includes('visible') && names.includes('root'), 'redactTree(): non-matching names ("root", "visible") are left intact');

console.log(failures === 0 ? '\nPASS — global/sticky RegExp selectors are stateless: matches() finds all siblings, redactTree() masks all secrets.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
