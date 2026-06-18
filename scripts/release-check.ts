#!/usr/bin/env bun
/**
 * release-check.ts — pre-publish gate for the standalone `skry` package.
 *
 * Adapted from the bun-win32 monorepo's published-deps.ts, but for skry's flat,
 * single-package layout (no workspace, no packages/ dir). It verifies two things
 * that a publish would otherwise silently get wrong:
 *
 *   1. Version lockstep. package.json, server.json (top-level + packages[].version),
 *      and mcp.ts SERVER_INFO.version must all be the SAME string. A drifted
 *      SERVER_INFO once shipped reporting the wrong version to MCP clients.
 *
 *   2. Pinned deps exist on npm. Every @bun-win32/* dependency is pinned to a
 *      published version range; this resolves each against the registry and fails
 *      if the minimum satisfying version is not actually published (a broken install
 *      otherwise ships only to consumers, never reproducing locally).
 *
 * Run before every publish. Non-zero exit on any problem.
 *
 *   Run: bun run scripts/release-check.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (file: string) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

const problems: string[] = [];

const pkg = read('package.json');
const server = read('server.json');
const mcpSource = readFileSync(join(ROOT, 'mcp.ts'), 'utf8');
const serverInfoMatch = mcpSource.match(/SERVER_INFO\s*=\s*\{[^}]*version:\s*'([^']+)'/);
const serverInfoVersion = serverInfoMatch?.[1];

const expected = pkg.version as string;

if (server.name !== pkg.mcpName) problems.push(`server.json name '${server.name}' != package.json mcpName '${pkg.mcpName}'`);
if (server.version !== expected) problems.push(`server.json version '${server.version}' != package.json '${expected}'`);
for (const entry of server.packages ?? []) {
  if (entry.identifier !== pkg.name) problems.push(`server.json package identifier '${entry.identifier}' != package.json name '${pkg.name}'`);
  if (entry.version !== expected) problems.push(`server.json package version '${entry.version}' != package.json '${expected}'`);
}
if (!serverInfoVersion) problems.push('could not find SERVER_INFO.version in mcp.ts');
else if (serverInfoVersion !== expected) problems.push(`mcp.ts SERVER_INFO.version '${serverInfoVersion}' != package.json '${expected}'`);

const deps: Record<string, string> = pkg.dependencies ?? {};
const npmChecks = Object.entries(deps).map(async ([name, range]) => {
  const wanted = range.replace(/^[\^~]/, '');
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  if (!response.ok) return problems.push(`${name}: registry lookup failed (${response.status})`);
  const meta = (await response.json()) as { versions: Record<string, unknown> };
  if (!meta.versions[wanted]) problems.push(`${name}@${wanted} (from '${range}') is not published on npm`);
});
await Promise.all(npmChecks);

if (problems.length > 0) {
  console.error(`release-check: ${problems.length} problem(s)\n` + problems.map((problem) => `  - ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`release-check: OK — version ${expected} consistent across package.json, server.json, mcp.ts; all ${Object.keys(deps).length} @bun-win32/* deps published.`);
