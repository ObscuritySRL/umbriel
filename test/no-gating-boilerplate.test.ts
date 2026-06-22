import { expect, test } from 'bun:test';

// A tool's gating is conveyed STRUCTURALLY — by its `category` field (toolAllowed filters tools/list by it) and the
// destructiveHint/openWorldHint annotations — plus a clear policy error on a blocked call. So the prose "Gated behind
// the X category" in a description is dead weight on the always-paid tools/list wire: non-actionable in BOTH visibility
// states (a tool the model can SEE is by definition enabled; a gated-out tool's description is never read). Pin it out.
// (Destructiveness — "Destructive." — and the UMBRIEL_FS_ROOT sandbox note are KEPT: those are behavior/safety signals
// the model acts on, not gating boilerplate.)
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();
const toolsBlock = mcp.slice(mcp.indexOf('const TOOLS: McpTool[] = ['), mcp.indexOf('\n];', mcp.indexOf('const TOOLS: McpTool[] = [')));

test('no tool description carries the non-actionable "Gated behind the … category" boilerplate', () => {
  expect(toolsBlock).not.toContain('Gated behind the');
});
