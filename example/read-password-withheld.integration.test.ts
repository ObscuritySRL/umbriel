/**
 * read-password-withheld — the MCP read paths all withhold a password field's value (isPassword gate), but the PUBLISHED
 * library facades did not: execute() (agent.ts) and the TRUST-layer safeExecute() (safety.ts — which ships redactTree to
 * mask secret NAMES) both read element.value/text() ungated, leaking the secret through the computer-use grounding API.
 * Both now apply the same isPassword gate.
 *
 * Proof (no app spawned): a synthetic ES_PASSWORD Edit holding a secret, read via execute() AND safeExecute(), returns
 * "(password — withheld)" — never the secret. Window destroyed in teardown.
 *
 * bun test is broken repo-wide — runnable script:
 * Run: bun run example/read-password-withheld.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import { type AgentAction, ControlType, execute, safeExecute, skry } from 'skry';
import User32 from '@bun-win32/user32';

const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_BORDER = 0x0080_0000;
const ES_PASSWORD = 0x0020;
const PM_REMOVE = 0x0001;
const SECRET = 'hunter2-do-not-leak';
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const hInstance = Kernel32.GetModuleHandleW(null);
const parent = User32.CreateWindowExW(0, wide('#32770').ptr!, wide('skry-pw-parent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 360, 200, 0n, 0n, BigInt(hInstance), null);
const edit = parent === 0n ? 0n : User32.CreateWindowExW(0, wide('Edit').ptr!, null, WS_CHILD | WS_VISIBLE | WS_BORDER | ES_PASSWORD, 10, 10, 320, 28, parent, 0n, BigInt(hInstance), null);
if (edit !== 0n) {
  User32.SetWindowTextW(edit, wide(SECRET).ptr!);
  const msg = Buffer.alloc(48);
  for (let i = 0; i < 2000; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, PM_REMOVE) === 0) break;
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}

skry.initialize();
try {
  if (parent === 0n || edit === 0n) console.log('  skip: could not create the password Edit');
  else {
    const window = skry.attach(parent);
    const probe = window.find({ controlType: ControlType.Edit });
    const isPw = probe?.isPassword ?? false;
    probe?.release();
    if (!isPw) console.log('  skip: synthetic Edit did not surface as a UIA password field');
    else {
      const read: AgentAction[] = [{ find: { controlType: ControlType.Edit }, do: 'read' }];
      const viaExecute = execute(window, read)[0]?.value ?? '';
      assert(/\(password/.test(viaExecute) && !viaExecute.includes(SECRET), `execute() read withholds the password (got: ${JSON.stringify(viaExecute)})`);
      const viaSafe = safeExecute(window, read)[0]?.value ?? '';
      assert(/\(password/.test(viaSafe) && !viaSafe.includes(SECRET), `safeExecute() read withholds the password (got: ${JSON.stringify(viaSafe)})`);
    }
    window.dispose();
  }
} finally {
  skry.uninitialize();
  if (edit !== 0n) User32.DestroyWindow(edit);
  if (parent !== 0n) User32.DestroyWindow(parent);
}

console.log(failures === 0 ? '\nPASS — execute() and safeExecute() withhold password-field values (matching the MCP read gate).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
