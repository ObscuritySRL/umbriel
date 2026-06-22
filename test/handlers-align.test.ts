import { expect, test } from 'bun:test';

// Every MCP tool (a TOOLS entry) must have a matching HANDLERS entry and vice versa. Both are string-keyed in mcp.ts
// (TOOLS[].name ↔ HANDLERS[name], dispatched via HANDLERS[name]), so a typo'd or missing key is invisible to tsc: a
// listed-but-unhandled tool dead-ends on "unknown tool", and an orphan handler is dead code. The Dead-Code audit lane
// checks this alignment by hand every pass — this pins it permanently.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

const toolsBlock = mcp.slice(mcp.indexOf('const TOOLS: McpTool[] = ['), mcp.indexOf('\n];', mcp.indexOf('const TOOLS: McpTool[] = [')));
const toolNames = new Set([...toolsBlock.matchAll(/name:\s*'([a-z_]+)'/g)].map((match) => match[1]));

const handlersBlock = mcp.slice(mcp.indexOf('const HANDLERS'));
const handlerKeys = new Set([...handlersBlock.matchAll(/^ {2}([a-z_]+): (?:async )?\(/gm)].map((match) => match[1]));

test('every TOOLS name has a HANDLERS entry, and every handler has a tool (no listed-but-undispatchable, no dead handler)', () => {
  expect(toolNames.size).toBe(96);
  expect([...toolNames].filter((name) => !handlerKeys.has(name))).toEqual([]); // tools with no handler
  expect([...handlerKeys].filter((key) => !toolNames.has(key))).toEqual([]); // handlers with no tool
  expect(handlerKeys.size).toBe(toolNames.size);
});
