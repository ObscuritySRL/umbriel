/**
 * Automate Calculator — drive another app's GUI from TypeScript, then prove it on screen.
 *
 * Attaches Microsoft UI Automation to Calculator, renders its live control tree as a colored ANSI
 * tree, presses 5 + 3 = 8 by invoking each button's InvokePattern (no keyboard, no pixels — semantic
 * targeting by name), reads the result back through the tree, and saves a PrintWindow screenshot so
 * you can SEE the 8. Works on a locked session (UIA + PrintWindow do not need the input desktop).
 *
 * APIs demonstrated:
 * - skry.attach / find / findAll (query the a11y tree)
 * - Element.invoke (InvokePattern), Element.name (read the display)
 * - Window.screenshot (PrintWindow → PNG visual proof)
 *
 * Run: bun run example/automate-calculator.ts
 *      DEMO_DURATION_MS=8000 bun run example/automate-calculator.ts
 */
import { ControlType, skry } from 'skry';
import User32 from '@bun-win32/user32';

const deadline = Bun.env.DEMO_DURATION_MS ? Bun.nanoseconds() + Number(Bun.env.DEMO_DURATION_MS) * 1e6 : Number.POSITIVE_INFINITY;

skry.initialize();
Bun.spawn(['cmd', '/c', 'start', 'calc'], { stdout: 'ignore', stderr: 'ignore' });
let hWnd = 0n;
const title = Buffer.from('Calculator\0', 'utf16le');
for (let i = 0; i < 20 && hWnd === 0n; i += 1) {
  Bun.sleepSync(400);
  hWnd = User32.FindWindowW(null, title.ptr!);
}
if (hWnd === 0n) {
  console.log('\x1b[93mCould not find a Calculator window — exiting cleanly.\x1b[0m');
  process.exit(0);
}
Bun.sleepSync(800);
const app = skry.attach(hWnd);

console.log(`\n\x1b[1m\x1b[95m  Calculator — driven from TypeScript via UI Automation\x1b[0m\n`);
const tree = skry.tree(app, { agentProfile: true });
const buttons = app.findAll({ controlType: ControlType.Button });
console.log(`  \x1b[2mlive tree: ${buttons.length} buttons, root "${tree.name}"\x1b[0m`);
for (const button of buttons.slice(0, 12)) console.log(`  \x1b[2m├─\x1b[0m \x1b[96mButton\x1b[0m ${button.name}`);
for (const button of buttons) button.release();

console.log(`\n\x1b[1m  Computing 5 + 3 = 8 by invoking buttons:\x1b[0m`);
for (const name of ['Five', 'Plus', 'Three', 'Equals']) {
  if (Bun.nanoseconds() >= deadline) break;
  const button = app.find({ controlType: ControlType.Button, name });
  if (button) {
    button.invoke();
    console.log(`  \x1b[92m✓\x1b[0m pressed \x1b[96m${name}\x1b[0m`);
    button.release();
  }
  Bun.sleepSync(350);
}

Bun.sleepSync(400);
const display = app.find({ automationId: 'CalculatorResults' });
console.log(`\n  \x1b[1m\x1b[92m${display ? display.name : '(no display)'}\x1b[0m`);
display?.release();

await Bun.write('.scratch/automate-calculator.png', app.screenshot());
console.log(`  \x1b[2msaved .scratch/automate-calculator.png — look: the display reads 8\x1b[0m\n`);

app.dispose();
skry.uninitialize();
