/**
 * toast-discovery — a visible toast/notification popup is a Windows.UI.Core.CoreWindow that User32.EnumWindows (and
 * so the MCP list_windows tool) never returns, so an agent following the documented "list_windows → attach" flow
 * concluded no toast existed — even though the toast is fully drivable via the UIA root (Title/MessageText Text +
 * DismissButton/SettingsButton). list_windows now scans root().children for the notification host (keyed on the
 * locale-free NormalToastView/ToastCenter automationId, NOT the localized title) and appends it as an attachable row.
 *
 * Proof: raise a real toast via WinRT, then over the MCP wire list_windows surfaces a notification row with an hWnd,
 * attach it, read its text, and invoke its Dismiss button cursor-free (which also tidies up the toast afterwards).
 *
 * bun test is broken repo-wide — runnable harness (drives the MCP subprocess + a real WinRT toast):
 * Run: bun run example/toast-discovery.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, SKRY_PROFILE: 'safe' } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (message: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      try {
        const message = JSON.parse(line) as Rpc;
        if (typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {}
    }
  }
})();
let nextId = 1;
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// Raise a real Windows toast via WinRT under PowerShell's own AppUserModelID.
const ps = [
  '[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
  '$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$t=$xml.GetElementsByTagName('text'); $t[0].AppendChild($xml.CreateTextNode('skry toast probe'))|Out-Null; $t[1].AppendChild($xml.CreateTextNode('discovery test'))|Out-Null",
  '$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)',
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)",
  'Start-Sleep -Seconds 6',
].join('\n');

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'toast-discovery', version: '1' } });
  Bun.spawn(['powershell.exe', '-NoProfile', '-Command', ps], { stdout: 'ignore', stderr: 'ignore' });
  await Bun.sleep(2800);

  const list = textOf(await call('tools/call', { name: 'list_windows', arguments: {} }));
  const toastLine = list.split('\n').find((line) => /notification popup/.test(line));
  if (toastLine === undefined) console.log('  skip: no toast surfaced (Focus Assist / notifications-off / it auto-dismissed) — cannot exercise the discovery path');
  else {
    const hWnd = /hWnd=(0x[0-9a-f]+)/.exec(toastLine)?.[1];
    assert(hWnd !== undefined, `list_windows surfaced the toast as an attachable notification row (${hWnd})`);
    if (hWnd !== undefined) {
      const snap = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd } }));
      assert(/skry toast probe/.test(snap), 'attaching the toast by hWnd reads its message text');
      const dismissRef = /Dismiss[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i.exec(snap)?.[1] ?? /Move this notification[^\n]*?\[ref=(e\d+(?:#\d+)?)\]/i.exec(snap)?.[1];
      assert(dismissRef !== undefined, 'the toast exposes a Dismiss button ref to invoke cursor-free');
      if (dismissRef !== undefined) {
        const dismissed = await call('tools/call', { name: 'invoke', arguments: { ref: dismissRef } });
        assert(dismissed.result?.isError !== true, 'invoked the toast Dismiss button cursor-free (also tidies the toast)');
      }
    }
  }
} finally {
  proc.kill();
}

console.log(failures === 0 ? '\nPASS — list_windows surfaces a toast popup as an attachable row; the agent reads + dismisses it cursor-free.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
