import { expect, test } from 'bun:test';

// act_batch runs N act() steps but rebuilds the snapshot EXACTLY ONCE at the end (its whole perf premise), is
// SELECTOR-only (no per-step ref → no snapshot-owned Element held → no use-after-free), releases every findAll
// match, redacts caught step errors, and exposes only act()'s input verbs (no os/fs privilege channel). These are
// structural invariants tsc cannot see — this pins them against regression. Source-parse, mirrors handlers-align.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

const handlerStart = mcp.indexOf('act_batch: async (args) =>');
const handlerBody = mcp.slice(handlerStart, mcp.indexOf('reveal: (args) =>', handlerStart));

const toolsBlock = mcp.slice(mcp.indexOf('const TOOLS: McpTool[] = ['), mcp.indexOf('\n];', mcp.indexOf('const TOOLS: McpTool[] = [')));
const entryStart = toolsBlock.indexOf("name: 'act_batch'");
const entry = toolsBlock.slice(entryStart, toolsBlock.indexOf('name:', entryStart + 10));

test('act_batch handler + TOOLS entry were located', () => {
  expect(handlerStart).toBeGreaterThan(0);
  expect(handlerBody.length).toBeGreaterThan(400);
  expect(entryStart).toBeGreaterThan(0);
});

test('act_batch rebuilds the snapshot EXACTLY ONCE (the deferral that is its perf premise)', () => {
  // a per-step rebuild call inside the loop would make this >1 and defeat the whole tool. Count CALL forms (with
  // a paren) so a comment that merely names withSnapshot doesn't inflate the count.
  expect((handlerBody.match(/with(?:Act)?Snapshot\(/g) ?? []).length).toBe(1);
});

test('act_batch is SELECTOR-only — no resolveRef call, so no snapshot-owned Element is held (no UAF)', () => {
  expect(handlerBody).not.toContain('resolveRef('); // the call form — a comment may mention the word; a CALL is the UAF source
});

test('act_batch releases every findAll match in a finally', () => {
  expect(/for \(const match of matches\) match\.release\(\)/.test(handlerBody)).toBe(true);
});

test('act_batch redacts a caught step error before embedding it', () => {
  // a step error can carry a live control name / typed value — it must pass through redactSecrets.
  expect(/catch[\s\S]{0,160}redactSecrets/.test(handlerBody)).toBe(true);
});

test('act_batch do-enum is exactly act()\'s input verbs — no os/fs privilege-escalation channel', () => {
  const doEnum = /do: \{ type: 'string', enum: (\[[^\]]+\]) \}/.exec(entry)?.[1] ?? '';
  expect(doEnum).toBe("['invoke', 'click', 'type', 'set_value', 'toggle', 'expand', 'collapse', 'select', 'focus', 'read']");
});

test('the no-resolveRef matcher is not vacuous (negative control)', () => {
  // a reintroduced per-step ref path WOULD be caught by the assertion above.
  expect('const e = resolveRef(args.ref);').toContain('resolveRef(');
});
