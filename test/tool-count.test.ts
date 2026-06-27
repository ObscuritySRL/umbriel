import { expect, test } from 'bun:test';

// The READMEs quote tool counts (total / safe / readonly) in prose. They drift the moment a tool is
// added without updating the strings. This test derives the counts straight from the TOOLS array in
// mcp.ts (by category) and asserts every doc string matches — so a stale count fails CI, not review.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();
const block = mcp.slice(mcp.indexOf('const TOOLS: McpTool[] = ['), mcp.indexOf('\n];', mcp.indexOf('const TOOLS: McpTool[] = [')));
const categories = [...block.matchAll(/category:\s*'([a-z]+)'/g)].map((match) => match[1]);
const total = categories.length;
const readonly = categories.filter((category) => category === 'read').length;
const osFs = categories.filter((category) => category === 'os' || category === 'fs').length;
const safe = total - osFs;

test('tool counts are derived correctly from mcp.ts', () => {
  expect(total).toBe(99);
  expect(safe).toBe(76);
  expect(readonly).toBe(41); // read_clipboard lives in 'input' (least-privilege), so only the 'read' category is readonly
  expect(osFs).toBe(23);
});

test('README.md quotes the live tool counts', async () => {
  const readme = await Bun.file(`${import.meta.dir}/../README.md`).text();
  expect(readme).toContain(`**${total} snapshot-first tools** (${safe} under the default \`safe\` profile; ${readonly} under \`readonly\`; the ${osFs} os/fs tools need \`full\` or \`UMBRIEL_OS=1\`)`);
});

test('AI.md quotes the live tool counts', async () => {
  const ai = await Bun.file(`${import.meta.dir}/../AI.md`).text();
  expect(ai).toContain(`**${total} tools** (${safe} visible under the default \`safe\` profile; ${readonly} under \`readonly\`; the ${osFs} os/fs tools need \`full\` or \`UMBRIEL_OS=1\`)`);
});

// AI.md's "sandbox EVERY fs-category file tool (…)" parenthetical is a security-relevant enumeration — exactly what
// UMBRIEL_FS_ROOT confines. It silently drifted to 7 of 9 (find_files + stat_path were FS_ROOT-confined in code but absent
// from the doc list). Derive the fs tool names from mcp.ts and assert each appears in that claim, so the NEXT fs tool added
// without a doc sync fails here, not review. (Pairs each `name:` with its following `category:` — name precedes category in
// every TOOLS entry; matchAll is non-overlapping, so each name binds to its own tool's category.)
test('AI.md "sandbox EVERY fs-category" sentence lists every fs-category tool', async () => {
  const ai = await Bun.file(`${import.meta.dir}/../AI.md`).text();
  const fsTools = [...block.matchAll(/name:\s*'([a-z_]+)'[\s\S]*?category:\s*'([a-z]+)'/g)].filter((match) => match[2] === 'fs').map((match) => match[1]);
  expect(fsTools.length).toBe(categories.filter((category) => category === 'fs').length); // sanity: paired-parse matches the category count
  const start = ai.indexOf('sandbox EVERY fs-category file tool (');
  expect(start).toBeGreaterThan(-1); // the claim sentence is present
  const fsList = ai.slice(start, ai.indexOf(')', start) + 1); // the parenthetical tool list, up to its closing paren
  expect(fsTools.filter((name) => !fsList.includes(`\`${name}\``))).toEqual([]); // any fs tool missing from the sandbox claim
});
