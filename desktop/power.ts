// Windows session + power state — lock, sign out, restart, shut down — driven natively (no shutdown.exe / logoff.exe /
// rundll32 user32,LockWorkStation / PowerShell Stop-Computer|Restart-Computer). ONE general primitive over the session/
// power state machine, the same shape as control_service(query|start|stop) and manage_task(create|delete) — not a bag of
// bespoke verbs. `lock` needs no privilege; `logoff` needs none either (a user may always end their own session);
// `restart`/`shutdown` go through ExitWindowsEx, which requires SE_SHUTDOWN_NAME — present-but-DISABLED in every
// interactive user token, so it is enabled in-process first (OpenProcessToken + LookupPrivilegeValueW +
// AdjustTokenPrivileges). No elevation is required for the interactive user's OWN session. All symbols come from the
// installed @bun-win32 user32/advapi32/kernel32 bindings — no new dep, no hand-roll.

import Advapi32 from '@bun-win32/advapi32';
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

const TOKEN_ADJUST_PRIVILEGES = 0x0020;
const TOKEN_QUERY = 0x0008;
const SE_PRIVILEGE_ENABLED = 0x0000_0002;
// ExitWindowsEx uFlags. FORCE/POWEROFF are deliberately omitted — a planned, non-forced request lets apps save first.
const EWX_LOGOFF = 0x0000_0000;
const EWX_SHUTDOWN = 0x0000_0001;
const EWX_REBOOT = 0x0000_0002;
const SHTDN_REASON_FLAG_PLANNED = 0x8000_0000; // a clean "planned" reason code (major/minor = OTHER)

export type PowerAction = 'lock' | 'logoff' | 'restart' | 'shutdown';

/** Enable SE_SHUTDOWN_NAME in THIS process's access token (present-but-disabled in every interactive user token) — the
 *  precondition ExitWindowsEx imposes for restart/shutdown. Returns true if the three token calls succeeded. A reusable
 *  building block for any privilege-gated state change (e.g. a future SE_TIME_ZONE_NAME set). No elevation needed for
 *  the user's own token; harmless if it runs unused (the privilege is merely enabled, never acted on). */
export function enableShutdownPrivilege(): boolean {
  const tokenOut = Buffer.alloc(8);
  if (Advapi32.OpenProcessToken(Kernel32.GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, tokenOut.ptr!) === 0) return false;
  const token = tokenOut.readBigUInt64LE(0);
  try {
    const luid = Buffer.alloc(8); // LUID { DWORD LowPart; LONG HighPart } — filled by LookupPrivilegeValueW
    if (Advapi32.LookupPrivilegeValueW(null, Buffer.from('SeShutdownPrivilege\0', 'utf16le').ptr!, luid.ptr!) === 0) return false;
    // TOKEN_PRIVILEGES { DWORD PrivilegeCount; LUID_AND_ATTRIBUTES Privileges[1] { LUID Luid; DWORD Attributes } } = 16 B x64.
    const privileges = Buffer.alloc(16);
    privileges.writeUInt32LE(1, 0); // PrivilegeCount = 1
    luid.copy(privileges, 4); // the looked-up LUID at offset 4
    privileges.writeUInt32LE(SE_PRIVILEGE_ENABLED, 12); // Attributes
    return Advapi32.AdjustTokenPrivileges(token, 0, privileges.ptr!, 0, null, null) !== 0;
  } finally {
    Kernel32.CloseHandle(token);
  }
}

/** Drive the session/power state machine. `lock` → LockWorkStation (reversible, no data loss, needs no privilege);
 *  `logoff`/`restart`/`shutdown` → ExitWindowsEx (planned, non-forced — apps are asked to close, not killed), with
 *  SE_SHUTDOWN_NAME enabled first for restart/shutdown. Returns true if the OS accepted the request. */
export function powerState(action: PowerAction): boolean {
  if (action === 'lock') return User32.LockWorkStation() !== 0;
  if ((action === 'restart' || action === 'shutdown') && !enableShutdownPrivilege()) return false;
  const flags = action === 'logoff' ? EWX_LOGOFF : action === 'restart' ? EWX_REBOOT : EWX_SHUTDOWN;
  return User32.ExitWindowsEx(flags, SHTDN_REASON_FLAG_PLANNED >>> 0) !== 0;
}
