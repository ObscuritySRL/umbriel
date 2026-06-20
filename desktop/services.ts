// Windows Service Control Manager via Advapi32 — list / query / start / stop a service natively, no `sc query` /
// Start-Service shell. list_services enumerates every Win32 service (EnumServicesStatusW); control_service opens ONE by
// name and queries (state + pid) / starts / stops it. Zero new bindings (the advapi32 package the registry + token
// paths already use).
//
// NOTE: the richer EnumServicesStatusExW (which carries the owning pid per row) is NOT used here — its `pszGroupName`
// arg is typed non-nullable LPCWSTR in @bun-win32/advapi32 (the generator missed its `_In_opt_`), and passing NULL is
// REQUIRED for "all services" (an empty string returns only ungrouped — 252 vs 301 live), with casts forbidden. The
// non-Ex EnumServicesStatusW has no group arg and correctly types its nullable params, so it's the clean path; the
// per-service pid is recovered on demand by control_service's QueryServiceStatusEx (SERVICE_STATUS_PROCESS.dwProcessId).

import Advapi32 from '@bun-win32/advapi32';

const SC_MANAGER_CONNECT = 0x0001;
const SC_MANAGER_ENUMERATE_SERVICE = 0x0004;
const SERVICE_QUERY_STATUS = 0x0004;
const SERVICE_START = 0x0010;
const SERVICE_STOP = 0x0020;
const SERVICE_WIN32 = 0x0030; // OWN_PROCESS | SHARE_PROCESS
const SERVICE_STATE_ALL = 0x0003;
const SC_STATUS_PROCESS_INFO = 0;
const SERVICE_CONTROL_STOP = 0x0001;
const SERVICE_STOPPED = 0x0001; // dwCurrentState values (distinct from the SERVICE_STOP access right above)
const SERVICE_RUNNING = 0x0004;
const ENUM_STATUS_STRIDE = 48; // ENUM_SERVICE_STATUSW (x64): LPWSTR@0, LPWSTR@8, SERVICE_STATUS@16 (28B), 8-aligned → 48
const SERVICE_STATES: Record<number, string> = { 1: 'stopped', 2: 'start-pending', 3: 'stop-pending', 4: 'running', 5: 'continue-pending', 6: 'pause-pending', 7: 'paused' };

export type ServiceAction = 'query' | 'start' | 'stop';

export interface ServiceEntry {
  name: string;
  displayName: string;
  state: string;
}

/** Read a NUL-terminated wide string that the API packed INSIDE `buffer`, via its absolute `pointer` and the buffer's
 *  `base` — by offset, so the read stays within the buffer (never an out-of-bounds absolute read). */
function readPackedWide(buffer: Buffer, base: bigint, pointer: bigint): string {
  if (pointer === 0n) return '';
  const offset = Number(pointer - base);
  if (offset < 0 || offset >= buffer.length) return '';
  return buffer.toString('utf16le', offset, Math.min(offset + 2048, buffer.length)).split('\0')[0] ?? '';
}

/** The service's current state, plus its owning pid when running, via QueryServiceStatusEx (SERVICE_STATUS_PROCESS). */
function queryServiceState(service: bigint): string {
  const buffer = Buffer.alloc(64); // SERVICE_STATUS_PROCESS is 36B; dwCurrentState @4, dwProcessId @28
  const needed = Buffer.alloc(4);
  if (Advapi32.QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, buffer.ptr!, 64, needed.ptr!) === 0) return 'unknown';
  const state = buffer.readUInt32LE(4);
  const processId = buffer.readUInt32LE(28);
  const label = SERVICE_STATES[state] ?? `state-${state}`;
  return processId > 0 ? `${label} (pid ${processId})` : label;
}

/** If `service` is ALREADY in the terminal state `action` would move it to, the "already …" label (the goal is met —
 *  NOT an error, no elevation needed); else null, so the caller performs / reports the transition unchanged. Reads the
 *  live state via QueryServiceStatusEx (same SERVICE_STATUS_PROCESS layout queryServiceState uses). This is why a failed
 *  Start/Control on an already-in-state service, or a medium-integrity caller without the start/stop right for a service
 *  that is already there, reports the true situation instead of a misleading access-denied. */
function alreadyInState(service: bigint, action: ServiceAction): string | null {
  const buffer = Buffer.alloc(64); // SERVICE_STATUS_PROCESS is 36B; dwCurrentState @4, dwProcessId @28
  const needed = Buffer.alloc(4);
  if (Advapi32.QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, buffer.ptr!, 64, needed.ptr!) === 0) return null;
  const state = buffer.readUInt32LE(4);
  if (action === 'start' && state === SERVICE_RUNNING) {
    const processId = buffer.readUInt32LE(28);
    return processId > 0 ? `already running (pid ${processId})` : 'already running';
  }
  if (action === 'stop' && state === SERVICE_STOPPED) return 'already stopped';
  return null;
}

/** Enumerate every Win32 service (name / displayName / state). [] if the SCM can't be opened for enumerate (needs no
 *  elevation in practice). Two-call sizing: a NULL buffer learns the byte count, then alloc + fill. */
export function listServices(): ServiceEntry[] {
  const manager = Advapi32.OpenSCManagerW(null, null, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE);
  if (manager === 0n) return [];
  try {
    const needed = Buffer.alloc(4);
    const returned = Buffer.alloc(4);
    Advapi32.EnumServicesStatusW(manager, SERVICE_WIN32, SERVICE_STATE_ALL, null, 0, needed.ptr!, returned.ptr!, null);
    const size = needed.readUInt32LE(0);
    if (size === 0) return [];
    const buffer = Buffer.alloc(size);
    if (Advapi32.EnumServicesStatusW(manager, SERVICE_WIN32, SERVICE_STATE_ALL, buffer.ptr!, size, needed.ptr!, returned.ptr!, null) === 0) return [];
    const count = returned.readUInt32LE(0);
    const base = BigInt(buffer.ptr!); // read inline right after the sync fill — no await, so the backing store is stable
    const services: ServiceEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      const record = index * ENUM_STATUS_STRIDE;
      const state = buffer.readUInt32LE(record + 20); // SERVICE_STATUS.dwCurrentState (@16 + 4)
      services.push({
        name: readPackedWide(buffer, base, buffer.readBigUInt64LE(record)),
        displayName: readPackedWide(buffer, base, buffer.readBigUInt64LE(record + 8)),
        state: SERVICE_STATES[state] ?? `state-${state}`,
      });
    }
    return services;
  } finally {
    Advapi32.CloseServiceHandle(manager);
  }
}

/**
 * Query / start / stop ONE service by name. Returns the resulting state string ('running (pid 2896)', 'stopped',
 * 'start-pending', …); 'already running (pid …)' / 'already stopped' when the service is ALREADY in the state the action
 * would move it to (the goal is met — NOT an error, no elevation needed); 'denied' (the SCM/service exists but this
 * medium-integrity session lacks the start/stop right — and the service is NOT already in the target state); or
 * 'not-found'. Start/stop are asynchronous, so a fresh transition's state may read *-pending.
 */
export function controlService(name: string, action: ServiceAction): string | 'denied' | 'not-found' {
  const manager = Advapi32.OpenSCManagerW(null, null, SC_MANAGER_CONNECT);
  if (manager === 0n) return 'denied';
  try {
    const wide = Buffer.from(`${name}\0`, 'utf16le');
    const access = action === 'start' ? SERVICE_START | SERVICE_QUERY_STATUS : action === 'stop' ? SERVICE_STOP | SERVICE_QUERY_STATUS : SERVICE_QUERY_STATUS;
    const service = Advapi32.OpenServiceW(manager, wide.ptr!, access);
    if (service === 0n) {
      const probe = Advapi32.OpenServiceW(manager, wide.ptr!, SERVICE_QUERY_STATUS); // disambiguate denied vs not-found
      if (probe === 0n) return 'not-found';
      try {
        return alreadyInState(probe, action) ?? 'denied'; // already in the goal state ⇒ not really denied; else the action's access was refused
      } finally {
        Advapi32.CloseServiceHandle(probe);
      }
    }
    try {
      if (action === 'start') {
        if (Advapi32.StartServiceW(service, 0, null) === 0) return alreadyInState(service, action) ?? 'denied';
      } else if (action === 'stop') {
        const status = Buffer.alloc(36); // SERVICE_STATUS is 28B
        if (Advapi32.ControlService(service, SERVICE_CONTROL_STOP, status.ptr!) === 0) return alreadyInState(service, action) ?? 'denied';
      }
      return queryServiceState(service);
    } finally {
      Advapi32.CloseServiceHandle(service);
    }
  } finally {
    Advapi32.CloseServiceHandle(manager);
  }
}

const SERVICE_QUERY_CONFIG = 0x0001;
const SERVICE_START_TYPES: Record<number, string> = { 0: 'boot', 1: 'system', 2: 'auto', 3: 'manual', 4: 'disabled' };

export interface ServiceConfig {
  startType: string; // boot / system / auto / manual / disabled
  binaryPath: string; // the on-disk image path + command line the service runs (e.g. svchost.exe -k netsvcs)
  account: string; // the account it runs as (LocalSystem / NetworkService / a user)
}

/** A service's static config — how it starts, the binary/command line it runs, and the account — via QueryServiceConfigW
 *  (two-call sizing, then the LPWSTR fields packed in the buffer decoded by offset). null if the service can't be opened
 *  for a config query (not found / denied). Read-only; needs no elevation in practice. */
export function readServiceConfig(name: string): ServiceConfig | null {
  const manager = Advapi32.OpenSCManagerW(null, null, SC_MANAGER_CONNECT);
  if (manager === 0n) return null;
  try {
    const wide = Buffer.from(`${name}\0`, 'utf16le');
    const service = Advapi32.OpenServiceW(manager, wide.ptr!, SERVICE_QUERY_CONFIG);
    if (service === 0n) return null;
    try {
      const needed = Buffer.alloc(4);
      Advapi32.QueryServiceConfigW(service, null, 0, needed.ptr!); // sizing call — returns 0 (ERROR_INSUFFICIENT_BUFFER) + the byte count
      const size = needed.readUInt32LE(0);
      if (size === 0) return null;
      const buffer = Buffer.alloc(size);
      if (Advapi32.QueryServiceConfigW(service, buffer.ptr!, size, needed.ptr!) === 0) return null;
      const base = BigInt(buffer.ptr!); // read inline right after the synchronous fill — backing store stable, no await
      const startType = buffer.readUInt32LE(4); // QUERY_SERVICE_CONFIGW (x64): dwStartType@4, lpBinaryPathName@16, lpServiceStartName@48
      return {
        startType: SERVICE_START_TYPES[startType] ?? `start-${startType}`,
        binaryPath: readPackedWide(buffer, base, buffer.readBigUInt64LE(16)),
        account: readPackedWide(buffer, base, buffer.readBigUInt64LE(48)),
      };
    } finally {
      Advapi32.CloseServiceHandle(service);
    }
  } finally {
    Advapi32.CloseServiceHandle(manager);
  }
}
