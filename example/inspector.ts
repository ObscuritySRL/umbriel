/**
 * Inspector — a live FlaUInspect-class accessibility-tree viewer for the focused window.
 *
 * Polls the foreground window and renders its UI Automation tree (control type · name · automationId ·
 * bounds), colored, so you can see exactly what selectors to write. The diagnostic you reach for when
 * a find() comes back empty. Press Ctrl+C to stop (or set DEMO_DURATION_MS).
 *
 * APIs demonstrated:
 * - skry.focused (the foreground element), skry.tree (cached subtree), ControlType reverse-map
 *
 * Run: bun run example/inspector.ts
 *      DEMO_DURATION_MS=4000 bun run example/inspector.ts
 */
import { skry, type UiaNode } from 'skry';
import User32 from '@bun-win32/user32';

const deadline = Bun.env.DEMO_DURATION_MS ? Date.now() + Number(Bun.env.DEMO_DURATION_MS) : Number.POSITIVE_INFINITY;
skry.initialize();

function colorFor(role: string): string {
  if (role === 'Button' || role === 'SplitButton') return '\x1b[96m';
  if (role === 'Edit' || role === 'Document') return '\x1b[92m';
  if (role === 'Text') return '\x1b[93m';
  if (role === 'Window' || role === 'Pane') return '\x1b[95m';
  return '\x1b[2m';
}
function render(node: UiaNode, depth: number, lines: string[]): void {
  if (lines.length > 60) return;
  const indent = '  '.repeat(depth);
  const id = node.automationId ? ` \x1b[2m#${node.automationId}\x1b[0m` : '';
  const name = node.name ? ` ${node.name}` : '';
  lines.push(`${indent}${colorFor(node.role)}${node.role}\x1b[0m${name}${id}`);
  for (const child of node.children) render(child, depth + 1, lines);
}

let lastHwnd = 0n;
for (;;) {
  if (Date.now() >= deadline) break;
  const hWnd = User32.GetForegroundWindow();
  if (hWnd !== 0n && hWnd !== lastHwnd) {
    lastHwnd = hWnd;
    try {
      const app = skry.attach(hWnd);
      const tree = skry.tree(app, { agentProfile: true, maxDepth: 12 });
      const lines: string[] = [];
      render(tree, 0, lines);
      console.log(`\x1b[2J\x1b[H\x1b[1m\x1b[95m  UIA inspector — focused window\x1b[0m\n`);
      console.log(lines.join('\n'));
      console.log(`\n\x1b[2m  ${lines.length} nodes shown · focus another window to inspect it · Ctrl+C to stop\x1b[0m`);
      app.dispose();
    } catch {
      // window vanished between GetForegroundWindow and attach; keep polling
    }
  }
  await Bun.sleep(400);
}
skry.uninitialize();
