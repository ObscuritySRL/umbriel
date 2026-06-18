/**
 * UIA report — a one-shot diagnostic of the UI Automation environment.
 *
 * Confirms UI Automation is available, identifies the focused window, lists which control patterns its
 * focused element supports, and shows the MSAA fallback resolving the same window. The professional,
 * richly-formatted health check you run before writing automation against an app.
 *
 * APIs demonstrated:
 * - skry.initialize / focused / attach, Element pattern probes, msaaTree (oleacc fallback)
 *
 * Run: bun run example/skry-report.ts
 */
import { ControlType, msaaTree, skry } from 'skry';

skry.initialize();
console.log(`\n\x1b[1m\x1b[95m  UI Automation report\x1b[0m\n`);
console.log(`  \x1b[92m✓\x1b[0m IUIAutomation client active`);

const focused = skry.focused();
console.log(`  focused element : ${focused.controlTypeName} ${JSON.stringify(focused.name)}`);
console.log(`  bounds          : ${JSON.stringify(focused.boundingRectangle)}`);
console.log(`  enabled         : ${focused.isEnabled}`);

const probes: Array<[string, () => boolean]> = [
  [
    'Invoke',
    () => {
      try {
        focused.invoke();
        return true;
      } catch {
        return false;
      }
    },
  ],
  [
    'Value',
    () =>
      focused.value !== '' ||
      (() => {
        try {
          focused.setValue(focused.value);
          return true;
        } catch {
          return false;
        }
      })(),
  ],
  ['Toggle', () => focused.toggleState !== -1],
  ['ExpandCollapse', () => focused.expandCollapseState !== -1],
  ['RangeValue', () => Number.isFinite(focused.rangeValue)],
  ['Text', () => focused.text().length >= 0 && focused.text() !== ''],
];
console.log(`\n  \x1b[1mpatterns on the focused element:\x1b[0m`);
for (const [name, probe] of probes) {
  let supported = false;
  try {
    supported = probe();
  } catch {
    supported = false;
  }
  console.log(`    ${supported ? '\x1b[92m✓\x1b[0m' : '\x1b[2m·\x1b[0m'} ${name}`);
}

const accessible = msaaTree(focused.nativeWindowHandle !== 0n ? focused.nativeWindowHandle : skry.focused().nativeWindowHandle, 1);
console.log(`\n  \x1b[1mMSAA fallback:\x1b[0m ${accessible ? `IAccessible root ${JSON.stringify(accessible.name)} (role ${accessible.role})` : 'unavailable for this window'}`);

console.log(`\n  \x1b[1mcontrol-type vocabulary:\x1b[0m ${Object.keys(ControlType).filter((key) => Number.isNaN(Number(key))).length} types known\n`);

focused.release();
skry.uninitialize();
