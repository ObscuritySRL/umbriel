/**
 * Agent grounding — what you hand an LLM instead of a screenshot.
 *
 * Serializes a window's accessibility subtree to compact JSON: ground-truth element identity, role,
 * and bounding rectangles an agent can click without pixel-counting. Reports node count, token
 * estimate, and build time — the seam the computer-use wave (UFO2, OSWorld) is converging on, where
 * a11y-tree builds otherwise take 3–26 s. Builds in one cached cross-process round-trip.
 *
 * APIs demonstrated:
 * - skry.attach, skry.tree (full + agent profiles), countNodes / estimateTokens
 *
 * Run: bun run example/agent-grounding.ts            (defaults to Calculator)
 *      bun run example/agent-grounding.ts "Notepad"  (any window title)
 */
import { countNodes, estimateTokens, skry } from 'skry';
import User32 from '@bun-win32/user32';

const wanted = Bun.argv[2] ?? 'Calculator';
skry.initialize();
if (wanted === 'Calculator') Bun.spawn(['cmd', '/c', 'start', 'calc'], { stdout: 'ignore', stderr: 'ignore' });
let hWnd = 0n;
const title = Buffer.from(`${wanted}\0`, 'utf16le');
for (let i = 0; i < 20 && hWnd === 0n; i += 1) {
  Bun.sleepSync(400);
  hWnd = User32.FindWindowW(null, title.ptr!);
}
if (hWnd === 0n) {
  console.log(`\x1b[93mNo window titled "${wanted}".\x1b[0m`);
  process.exit(0);
}
Bun.sleepSync(800);
const app = skry.attach(hWnd);

const start = Bun.nanoseconds();
const agent = skry.tree(app, { agentProfile: true });
const buildMs = (Bun.nanoseconds() - start) / 1e6;
const full = skry.tree(app);

console.log(`\n\x1b[1m\x1b[95m  Agent grounding for "${app.name}"\x1b[0m\n`);
console.log(`  full tree  : ${countNodes(full)} nodes, ~${estimateTokens(full)} tokens`);
console.log(`  agent tree : ${countNodes(agent)} nodes, ~${estimateTokens(agent)} tokens, built in \x1b[92m${buildMs.toFixed(1)} ms\x1b[0m`);
console.log(`  \x1b[2mvs OSWorld a11y-tree build (3–26 s): ${(3000 / buildMs).toFixed(0)}–${(26000 / buildMs).toFixed(0)}× faster\x1b[0m\n`);
console.log('  \x1b[2mground-truth JSON an agent acts on (no pixel-counting):\x1b[0m');
console.log(
  JSON.stringify(agent, null, 2)
    .split('\n')
    .slice(0, 22)
    .map((line) => `  ${line}`)
    .join('\n'),
);

app.dispose();
skry.uninitialize();
