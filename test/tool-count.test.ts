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
  expect(total).toBe(85);
  expect(safe).toBe(66);
  expect(readonly).toBe(32); // read_clipboard lives in 'input' (least-privilege), so only the 'read' category is readonly
  expect(osFs).toBe(19);
});

test('README.md quotes the live tool counts', async () => {
  const readme = await Bun.file(`${import.meta.dir}/../README.md`).text();
  expect(readme).toContain(`**${total} snapshot-first tools** (${safe} under the default \`safe\` profile; ${readonly} under \`readonly\`; the ${osFs} os/fs tools need \`full\` or \`UMBRIEL_OS=1\`)`);
});

test('AI.md quotes the live tool counts', async () => {
  const ai = await Bun.file(`${import.meta.dir}/../AI.md`).text();
  expect(ai).toContain(`**${total} tools** (${safe} visible under the default \`safe\` profile; ${readonly} under \`readonly\`; the ${osFs} os/fs tools need \`full\` or \`UMBRIEL_OS=1\`)`);
});
