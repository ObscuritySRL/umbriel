// Windows environment variables across three scopes — process (the live kernel view), user (HKCU\Environment), and
// machine (HKLM\…\Session Manager\Environment) — read/list/set/delete natively, no setx/reg/PowerShell. Persistent
// (user/machine) writes go through the registry write primitives and then broadcast WM_SETTINGCHANGE so new child
// processes inherit the change without a reboot. process scope uses SetEnvironmentVariableW (transient — this process).
//
// The benchmark mandate's ONE genuine FFI-vs-Bun split lands here: process scope has a Bun-native rival (Bun.env) that
// wins for the transient view, so it is routed through Bun.env; user/machine have NO Bun equivalent (registry-backed,
// survive a reboot), so they use FFI registry — the choice is by scope, not a timing run.

import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';
import { registryDeleteValue, registryGet, registryList, registrySetString, type RegistryHive } from './registry';

const USER_ENV_KEY = 'Environment';
const MACHINE_ENV_KEY = 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const HWND_BROADCAST = 0xffffn;
const WM_SETTINGCHANGE = 0x001a;
const SMTO_ABORTIFHUNG = 0x0002;

export type EnvScope = 'process' | 'user' | 'machine';

/** Parse a scope string into the typed scope, or null — keeps the handler cast-free. */
export function parseScope(value: unknown): EnvScope | null {
  return value === 'process' || value === 'user' || value === 'machine' ? value : null;
}

function envLocation(scope: 'user' | 'machine'): { hive: RegistryHive; key: string } {
  return scope === 'user' ? { hive: 'HKCU', key: USER_ENV_KEY } : { hive: 'HKLM', key: MACHINE_ENV_KEY };
}

/** Tell running apps the environment changed, so new child processes inherit it without a reboot. */
function broadcastEnvironmentChange(): void {
  const label = Buffer.from('Environment\0', 'utf16le'); // named local — kept alive across the synchronous broadcast
  const result = Buffer.alloc(8);
  User32.SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0n, BigInt(label.ptr!), SMTO_ABORTIFHUNG, 2000, result.ptr!);
}

/** Read one env var in a scope. null if unset. process = the live process env; user/machine = the persistent registry.
 *  Process scope reads process.env (not Bun.env) so it stays CONSISTENT with the process-scope write below — Bun.env is
 *  a snapshot that a SetEnvironmentVariableW write would not update, so read-after-write must share one view. */
export function getEnv(scope: EnvScope, name: string): string | null {
  if (scope === 'process') return process.env[name] ?? null;
  const { hive, key } = envLocation(scope);
  const value = registryGet(hive, key, name);
  return value === null ? null : String(value.value);
}

/** Every env var in a scope, name→value. */
export function listEnv(scope: EnvScope): Record<string, string> {
  const result: Record<string, string> = {};
  if (scope === 'process') {
    for (const [name, value] of Object.entries(process.env)) if (typeof value === 'string') result[name] = value;
    return result;
  }
  const { hive, key } = envLocation(scope);
  const listing = registryList(hive, key);
  if (listing) for (const entry of listing.values) result[entry.name] = String(entry.value);
  return result;
}

/** Set (or, with value=null, delete) an env var. Persistent scopes write the registry + broadcast WM_SETTINGCHANGE so
 *  new child processes inherit it; process scope updates process.env (so Bun.spawn children inherit) AND the Win32
 *  process block via SetEnvironmentVariableW (so native CreateProcess children inherit) — transient, this process only.
 *  true on success, false on denied/error. */
export function setEnv(scope: EnvScope, name: string, value: string | null): boolean {
  if (scope === 'process') {
    const wideName = Buffer.from(`${name}\0`, 'utf16le');
    if (value === null) {
      delete process.env[name];
      return Kernel32.SetEnvironmentVariableW(wideName.ptr!, null) !== 0;
    }
    process.env[name] = value;
    const wideValue = Buffer.from(`${value}\0`, 'utf16le');
    return Kernel32.SetEnvironmentVariableW(wideName.ptr!, wideValue.ptr!) !== 0;
  }
  const { hive, key } = envLocation(scope);
  const ok = value === null ? registryDeleteValue(hive, key, name) : registrySetString(hive, key, name, value, value.includes('%')); // %VAR%-style → REG_EXPAND_SZ
  if (ok) broadcastEnvironmentChange();
  return ok;
}
