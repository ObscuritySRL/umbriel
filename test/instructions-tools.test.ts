import { expect, test } from 'bun:test';

// The `initialize` INSTRUCTIONS banner (served to the LLM) must never name an action tool that tools/list
// does not expose — the invariant mcp.ts states at its own INSTRUCTIONS_READONLY comment. A phantom tool
// (e.g. the library-only facade `sendKeys`, which is NOT an MCP tool) makes the agent call it and dead-end on
// "unknown tool". This test derives the real tool names from the TOOLS array and asserts the banner stays honest.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

const toolsBlock = mcp.slice(mcp.indexOf('const TOOLS: McpTool[] = ['), mcp.indexOf('\n];', mcp.indexOf('const TOOLS: McpTool[] = [')));
const toolNames = new Set([...toolsBlock.matchAll(/name:\s*'([a-z_]+)'/g)].map((match) => match[1]));

const instructions = mcp.slice(mcp.indexOf('const INSTRUCTIONS ='), mcp.indexOf('const INSTRUCTIONS_READONLY'));

test('TOOLS array parsed for the honesty check', () => {
  expect(toolNames.size).toBe(96);
});

test('INSTRUCTIONS names no snake_case token that is not a real tool', () => {
  // Lowercase snake_case tokens in the banner are tool references (env vars / Win32 messages are UPPER-case and
  // excluded by the lowercase class). Anything that looks like a tool must actually be one.
  const snakeTokens = new Set([...instructions.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((match) => match[0]));
  const phantom = [...snakeTokens].filter((token) => !toolNames.has(token));
  expect(phantom).toEqual([]);
});

test('INSTRUCTIONS does not advertise the library-only facade `sendKeys` as a tool', () => {
  // `umbriel.sendKeys(...)` is a library facade method, never an MCP tool — tools/call would reject it.
  expect(instructions).not.toContain('sendKeys');
  // the real focused-window key tools it sits beside must still be named
  expect(instructions).toContain('press_key');
  expect(instructions).toContain('hold_key');
});
