// Window + process event hooks. SetWinEventHook (WINEVENT_OUTOFCONTEXT) delivers events as posted messages;
// pumped on the MAIN thread, the callback fires synchronously on the pumping thread — no foreign-thread hazard
// under Bun. Process creation has no WinEvent, so it is polled via a toolhelp32 snapshot diff. The pump yields
// with `await Bun.sleep`, so timers and the rest of the event loop keep running while a watcher is active.
//
// UIA property/structure event SUBSCRIPTION (IUIAutomation::AddPropertyChangedEventHandler / AddStructureChanged-
// EventHandler / AddAutomationEventHandler) is deliberately NOT bound: UIA invokes those COM callbacks on its own
// internal worker thread, not the STA thread that registered them, and a Bun JSCallback trampoline driven from a
// foreign native thread segfaults (the repo-wide foreign-thread hazard). That is exactly why WINEVENT_OUTOFCONTEXT
// is safe here — it POSTS messages back to the registering thread instead of calling a callback on a foreign one.
// The supported substitute for "notice a property/subtree change" is polling: waitFor (element.ts) / waitForIdle
// (idle.ts) sample one cached round-trip per interval on this same STA thread. This is a settled design choice,
// not an unfinished feature.

import { FFIType, JSCallback } from 'bun:ffi';

import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';

import { listWindows, type WindowInfo } from '../element/window';

const EVENT_SYSTEM_FOREGROUND = 0x0000_0003;
const EVENT_SYSTEM_MINIMIZESTART = 0x0000_0016;
const EVENT_SYSTEM_MINIMIZEEND = 0x0000_0017;
const EVENT_OBJECT_DESTROY = 0x0000_8001;
const EVENT_OBJECT_SHOW = 0x0000_8002;
const EVENT_OBJECT_NAMECHANGE = 0x0000_800c;
const WINEVENT_OUTOFCONTEXT = 0x0000_0000;
const WINEVENT_SKIPOWNPROCESS = 0x0000_0002;
const PM_REMOVE = 0x0000_0001;
const OBJID_WINDOW = 0;
const CHILDID_SELF = 0;
const GA_ROOT = 2;
const TH32CS_SNAPPROCESS = 0x0000_0002;
const TH32CS_SNAPTHREAD = 0x0000_0004;
const THREAD_SUSPEND_RESUME = 0x0000_0002;
const PROCESS_SET_INFORMATION = 0x0000_0200;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x0000_1000;
const FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000; // ms between 1601-01-01 (FILETIME epoch) and 1970-01-01 (unix)
const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn;
const PROCESS_TERMINATE = 0x0001;

export type WindowEventType = 'appear' | 'close' | 'focus' | 'minimize' | 'restore' | 'rename';

export interface WindowEvent {
  type: WindowEventType;
  hWnd: bigint;
  title: string;
  className: string;
  processId: number;
}

export interface WindowWatcher {
  stop(): void;
}

/** A window match: an exact/partial title, a class name, or an owning process id. A bare string is a title substring. */
export type WindowMatch = string | { title?: string | RegExp; className?: string; process?: number };

function windowTitle(hWnd: bigint): string {
  const buffer = Buffer.alloc(1024);
  const length = User32.GetWindowTextW(hWnd, buffer.ptr!, 512);
  return length > 0 ? buffer.subarray(0, length * 2).toString('utf16le') : '';
}

function windowClassName(hWnd: bigint): string {
  const buffer = Buffer.alloc(512);
  const length = User32.GetClassNameW(hWnd, buffer.ptr!, 256);
  return length > 0 ? buffer.subarray(0, length * 2).toString('utf16le') : '';
}

function windowProcessId(hWnd: bigint): number {
  const out = Buffer.alloc(4);
  User32.GetWindowThreadProcessId(hWnd, out.ptr!);
  return out.readUInt32LE(0);
}

/** A real top-level application window: visible, titled, and its own root (filters tooltips, IME, message-only). */
function isAppWindow(hWnd: bigint): boolean {
  return User32.IsWindowVisible(hWnd) !== 0 && User32.GetAncestor(hWnd, GA_ROOT) === hWnd && windowTitle(hWnd).length > 0;
}

function toPredicate(match: WindowMatch): (window: WindowInfo) => boolean {
  // String/title substring matches CASE-INSENSITIVELY, mirroring attach (mcp.ts) — a differently-cased title
  // (waiting on 'Save As' for the actual 'Save as', or a lowercased app name) must not silently time out. className
  // stays exact (class names are case-sensitive identifiers); a RegExp carries its own case flags.
  if (typeof match === 'string') {
    const lower = match.toLowerCase();
    return (window) => window.title.toLowerCase().includes(lower);
  }
  return (window) => {
    if (match.process !== undefined && window.processId !== match.process) return false;
    if (match.className !== undefined && window.className !== match.className) return false;
    if (match.title !== undefined) {
      if (match.title instanceof RegExp) return match.title.test(window.title);
      return window.title.toLowerCase().includes(match.title.toLowerCase());
    }
    return true;
  };
}

/**
 * Watch top-level window lifecycle and focus changes via SetWinEventHook, delivering each as a `WindowEvent`:
 * `appear` (a new app window shown), `close` (one we'd announced is destroyed), `focus` (foreground change),
 * `minimize`/`restore`, and `rename` (title change). Returns a handle whose `stop()` unhooks and ends the pump.
 * The handler runs on the main thread. Windows already open when the watcher starts are seeded, so `appear`
 * fires only for genuinely new ones.
 */
export function watchWindows(handler: (event: WindowEvent) => void, options: { pollMs?: number } = {}): WindowWatcher {
  const known = new Map<bigint, { title: string; className: string; processId: number }>();
  for (const window of listWindows()) known.set(window.hWnd, { title: window.title, className: window.className, processId: window.processId });

  const callback = new JSCallback(
    (_hook: bigint, event: number, hWnd: bigint, idObject: number, idChild: number) => {
      if (idObject !== OBJID_WINDOW || idChild !== CHILDID_SELF || hWnd === 0n) return;
      if (event === EVENT_OBJECT_DESTROY) {
        const prior = known.get(hWnd);
        if (prior !== undefined) {
          known.delete(hWnd);
          handler({ type: 'close', hWnd, title: prior.title, className: prior.className, processId: prior.processId });
        }
        return;
      }
      if (event === EVENT_OBJECT_SHOW || event === EVENT_SYSTEM_FOREGROUND) {
        if (!isAppWindow(hWnd)) return;
        const title = windowTitle(hWnd);
        const className = windowClassName(hWnd);
        const processId = windowProcessId(hWnd);
        const isNew = !known.has(hWnd);
        known.set(hWnd, { title, className, processId });
        handler({ type: isNew ? 'appear' : 'focus', hWnd, title, className, processId });
        return;
      }
      if (event === EVENT_SYSTEM_MINIMIZESTART || event === EVENT_SYSTEM_MINIMIZEEND) {
        if (!known.has(hWnd) && !isAppWindow(hWnd)) return;
        handler({ type: event === EVENT_SYSTEM_MINIMIZESTART ? 'minimize' : 'restore', hWnd, title: windowTitle(hWnd), className: windowClassName(hWnd), processId: windowProcessId(hWnd) });
        return;
      }
      if (event === EVENT_OBJECT_NAMECHANGE) {
        const prior = known.get(hWnd);
        if (prior === undefined || !isAppWindow(hWnd)) return;
        const title = windowTitle(hWnd);
        if (title === prior.title) return;
        known.set(hWnd, { ...prior, title });
        handler({ type: 'rename', hWnd, title, className: prior.className, processId: prior.processId });
      }
    },
    { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.u32, FFIType.u32], returns: FFIType.void },
  );

  const flags = (WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS) >>> 0;
  const systemHook = User32.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, 0n, callback.ptr!, 0, 0, flags);
  const objectHook = User32.SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_NAMECHANGE, 0n, callback.ptr!, 0, 0, flags);

  let running = true;
  const message = Buffer.alloc(48); // MSG (x64)
  void (async () => {
    while (running) {
      while (User32.PeekMessageW(message.ptr!, 0n, 0, 0, PM_REMOVE) !== 0) {
        User32.TranslateMessage(message.ptr!);
        User32.DispatchMessageW(message.ptr!);
      }
      await Bun.sleep(options.pollMs ?? 15);
    }
  })();

  return {
    stop(): void {
      if (!running) return;
      running = false;
      User32.UnhookWinEvent(systemHook);
      User32.UnhookWinEvent(objectHook);
      callback.close();
    },
  };
}

/**
 * Resolve when a window matching `match` exists — immediately if one is already open, otherwise on the first
 * matching `appear`/`focus`/`rename` event. Rejects after `timeout` ms (default 30s). Use it to gate an action
 * on a window the agent is waiting for (a dialog, an app it just launched, a page that finished navigating).
 */
export function waitForWindow(match: WindowMatch, options: { timeout?: number } = {}): Promise<WindowInfo> {
  const timeout = options.timeout ?? 30000;
  const predicate = toPredicate(match);
  const existing = listWindows().find(predicate);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise<WindowInfo>((resolve, reject) => {
    const watcher = watchWindows((event) => {
      if (event.type !== 'appear' && event.type !== 'focus' && event.type !== 'rename') return;
      const info: WindowInfo = { hWnd: event.hWnd, title: event.title, className: event.className, processId: event.processId };
      if (predicate(info)) {
        clearTimeout(timer);
        resolve(info);
        // Defer stop() OUT of this synchronous frame: we are inside the SetWinEventHook JSCallback's own native
        // invocation, and stop()→callback.close() frees that trampoline while it is still on the stack — a
        // use-after-free that segfaults the process the instant the awaited window appears. resolve() is idempotent
        // and stop() guards on `running`, so the deferred (possibly double) stop is harmless.
        queueMicrotask(() => watcher.stop());
      }
    });
    const timer = setTimeout(() => {
      watcher.stop();
      reject(new Error(`waitForWindow: no window matched ${JSON.stringify(match)} within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Resolve when a window matching `match` is GONE — immediately if none is currently open, otherwise on the first
 * matching `close` event (the close event carries the window's LAST-KNOWN title/className/processId, since the hWnd is
 * already dead). Rejects after `timeout` ms (default 30s). The mirror of waitForWindow: gate an action on a window
 * DISAPPEARING — a dialog dismissed, a splash/progress window finishing, an app exiting.
 */
export function waitForWindowGone(match: WindowMatch, options: { timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? 30000;
  const predicate = toPredicate(match);
  if (listWindows().find(predicate) === undefined) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const watcher = watchWindows((event) => {
      if (event.type !== 'close') return;
      const info: WindowInfo = { hWnd: event.hWnd, title: event.title, className: event.className, processId: event.processId };
      if (predicate(info)) {
        clearTimeout(timer);
        resolve();
        // Defer stop() out of the JSCallback's own native frame — same use-after-free guard as waitForWindow's appear path.
        queueMicrotask(() => watcher.stop());
      }
    });
    const timer = setTimeout(() => {
      watcher.stop();
      reject(new Error(`waitForWindowGone: a window matching ${JSON.stringify(match)} was still open after ${timeout}ms`));
    }, timeout);
  });
}

/** Every running process as `{ processId, name }` (toolhelp32 snapshot). The image name is the bare exe (e.g. `notepad.exe`). */
export function listProcesses(): { processId: number; name: string }[] {
  const snapshot = Kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot === INVALID_HANDLE || snapshot === 0n) return [];
  try {
    const entry = Buffer.alloc(568); // PROCESSENTRY32W (x64): th32ProcessID @8, szExeFile @44 (260 WCHAR)
    entry.writeUInt32LE(568, 0); // dwSize
    const processes: { processId: number; name: string }[] = [];
    let ok = Kernel32.Process32FirstW(snapshot, entry.ptr!);
    while (ok !== 0) {
      processes.push({ processId: entry.readUInt32LE(8), name: entry.subarray(44, 564).toString('utf16le').split('\0')[0]! });
      ok = Kernel32.Process32NextW(snapshot, entry.ptr!);
    }
    return processes;
  } finally {
    Kernel32.CloseHandle(snapshot);
  }
}

/**
 * Terminate a process by pid (TerminateProcess via an OpenProcess(PROCESS_TERMINATE) handle) — kill a hung/stray
 * process natively, no `taskkill`/Stop-Process. Returns 'killed', 'denied' (the process exists but this session
 * cannot terminate it — elevated/protected from a medium-integrity host), or 'not-found'. GetLastError is unreliable
 * across the bun:ffi boundary, so denied-vs-not-found is decided by the toolhelp snapshot (visible across every
 * integrity level), not the error code.
 */
export function killProcess(processId: number): 'killed' | 'denied' | 'not-found' {
  const handle = Kernel32.OpenProcess(PROCESS_TERMINATE, 0, processId);
  if (handle === 0n) return listProcesses().some((process) => process.processId === processId) ? 'denied' : 'not-found';
  try {
    return Kernel32.TerminateProcess(handle, 1) !== 0 ? 'killed' : 'denied';
  } finally {
    Kernel32.CloseHandle(handle);
  }
}

export type PriorityClass = 'idle' | 'below' | 'normal' | 'above' | 'high';
const PRIORITY_CLASSES: Record<PriorityClass, number> = { idle: 0x40, below: 0x4000, normal: 0x20, above: 0x8000, high: 0x80 };
const THREADENTRY32_SIZE = 28; // dwSize, cntUsage, th32ThreadID@8, th32OwnerProcessID@12, tpBasePri, tpDeltaPri, dwFlags

/**
 * SUSPEND or RESUME every thread of a process via the toolhelp thread snapshot — freeze a runaway/installer without
 * killing it, then thaw it (no `pssuspend`/PowerShell, and ntdll's NtSuspendProcess isn't bound). Returns the count of
 * threads acted on, or 'denied' (its threads are elevated/protected from this medium-integrity host), or 'not-found'
 * (no such process). `resume` selects ResumeThread over SuspendThread.
 */
export function suspendProcess(processId: number, resume: boolean): number | 'denied' | 'not-found' {
  const snapshot = Kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot === INVALID_HANDLE || snapshot === 0n) return 'denied';
  try {
    const entry = Buffer.alloc(THREADENTRY32_SIZE);
    entry.writeUInt32LE(THREADENTRY32_SIZE, 0); // dwSize
    let acted = 0;
    let denied = 0;
    let found = false;
    let ok = Kernel32.Thread32First(snapshot, entry.ptr!);
    while (ok !== 0) {
      if (entry.readUInt32LE(12) === processId) {
        // th32OwnerProcessID
        found = true;
        const handle = Kernel32.OpenThread(THREAD_SUSPEND_RESUME, 0, entry.readUInt32LE(8)); // th32ThreadID
        if (handle === 0n) denied += 1;
        else {
          const previous = resume ? Kernel32.ResumeThread(handle) : Kernel32.SuspendThread(handle);
          if (previous === 0xffff_ffff) denied += 1;
          else acted += 1; // (DWORD)-1 is the failure sentinel; otherwise the prior suspend count
          Kernel32.CloseHandle(handle);
        }
      }
      ok = Kernel32.Thread32Next(snapshot, entry.ptr!);
    }
    if (!found) return 'not-found';
    return acted === 0 && denied > 0 ? 'denied' : acted;
  } finally {
    Kernel32.CloseHandle(snapshot);
  }
}

/**
 * Set a process's scheduling priority class (renice a CPU hog to `idle`/`below` so the foreground stays responsive, or
 * raise a stalled job) via OpenProcess(PROCESS_SET_INFORMATION) → SetPriorityClass. 'denied' if the process can't be
 * opened (elevated/protected), 'not-found' if it isn't running.
 */
export function setProcessPriority(processId: number, priority: PriorityClass): 'set' | 'denied' | 'not-found' {
  const handle = Kernel32.OpenProcess(PROCESS_SET_INFORMATION, 0, processId);
  if (handle === 0n) return listProcesses().some((process) => process.processId === processId) ? 'denied' : 'not-found';
  try {
    return Kernel32.SetPriorityClass(handle, PRIORITY_CLASSES[priority]) !== 0 ? 'set' : 'denied';
  } finally {
    Kernel32.CloseHandle(handle);
  }
}

export interface ProcessInfo {
  processId: number;
  name: string;
  parentProcessId: number;
  startTime: string; // ISO 8601, or '' if the detail handle was denied
  cpuKernelMs: number;
  cpuUserMs: number;
  workingSetMB: number;
  peakWorkingSetMB: number;
  handleCount: number;
  children: { processId: number; name: string }[];
}

/**
 * Deep per-process detail by pid: name, parent pid, start time, CPU kernel/user ms, working-set + peak MB, open handle
 * count, and the child list — so the AI can pick WHICH pid to kill/suspend/reprioritize (the runaway renderer, the
 * leaking child) instead of guessing from a flat name list. name/parent/children come from ONE toolhelp snapshot
 * (visible across integrity levels); the detail fields come from an OpenProcess(QUERY_LIMITED_INFORMATION) handle and
 * read 0 when the process is elevated/protected (the snapshot facts still resolve). null if the pid isn't running.
 */
export function processInfo(processId: number): ProcessInfo | null {
  const snapshot = Kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot === INVALID_HANDLE || snapshot === 0n) return null;
  let name = '';
  let parentProcessId = 0;
  let found = false;
  const children: { processId: number; name: string }[] = [];
  try {
    const entry = Buffer.alloc(568); // PROCESSENTRY32W (x64): th32ProcessID @8, th32ParentProcessID @32, szExeFile @44
    entry.writeUInt32LE(568, 0);
    let ok = Kernel32.Process32FirstW(snapshot, entry.ptr!);
    while (ok !== 0) {
      const entryPid = entry.readUInt32LE(8);
      const entryParent = entry.readUInt32LE(32);
      const entryName = entry.subarray(44, 564).toString('utf16le').split('\0')[0] ?? '';
      if (entryPid === processId) {
        found = true;
        name = entryName;
        parentProcessId = entryParent;
      }
      if (entryParent === processId) children.push({ processId: entryPid, name: entryName });
      ok = Kernel32.Process32NextW(snapshot, entry.ptr!);
    }
  } finally {
    Kernel32.CloseHandle(snapshot);
  }
  if (!found) return null;
  let startTime = '';
  let cpuKernelMs = 0;
  let cpuUserMs = 0;
  let workingSetMB = 0;
  let peakWorkingSetMB = 0;
  let handleCount = 0;
  const handle = Kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, processId);
  if (handle !== 0n) {
    try {
      const creation = Buffer.alloc(8);
      const exit = Buffer.alloc(8);
      const kernel = Buffer.alloc(8);
      const user = Buffer.alloc(8);
      if (Kernel32.GetProcessTimes(handle, creation.ptr!, exit.ptr!, kernel.ptr!, user.ptr!) !== 0) {
        startTime = new Date(Number(creation.readBigUInt64LE(0) / 10_000n) - FILETIME_UNIX_EPOCH_MS).toISOString();
        cpuKernelMs = Number(kernel.readBigUInt64LE(0) / 10_000n);
        cpuUserMs = Number(user.readBigUInt64LE(0) / 10_000n);
      }
      const handleOut = Buffer.alloc(4);
      if (Kernel32.GetProcessHandleCount(handle, handleOut.ptr!) !== 0) handleCount = handleOut.readUInt32LE(0);
      const memory = Buffer.alloc(72); // PROCESS_MEMORY_COUNTERS (x64): cb @0, PeakWorkingSetSize @8, WorkingSetSize @16
      memory.writeUInt32LE(72, 0);
      if (Kernel32.K32GetProcessMemoryInfo(handle, memory.ptr!, 72) !== 0) {
        peakWorkingSetMB = Math.round(Number(memory.readBigUInt64LE(8)) / 1_048_576);
        workingSetMB = Math.round(Number(memory.readBigUInt64LE(16)) / 1_048_576);
      }
    } finally {
      Kernel32.CloseHandle(handle);
    }
  }
  return { processId, name, parentProcessId, startTime, cpuKernelMs, cpuUserMs, workingSetMB, peakWorkingSetMB, handleCount, children };
}

export interface SystemResources {
  memoryTotalMB: number; // total physical RAM
  memoryAvailableMB: number; // free physical RAM
  memoryLoadPercent: number; // 0-100, the OS's own memory-pressure figure
  cpuPercent: number; // system-wide CPU busy %, sampled over `sampleMs`
  uptimeSeconds: number; // since last boot
  processes: number; // running process count
}

/** One GetSystemTimes sample (FILETIME 100ns counts). Kernel time INCLUDES idle. */
function cpuTimes(): { idle: number; busy: number } {
  const idle = Buffer.alloc(8);
  const kernel = Buffer.alloc(8);
  const user = Buffer.alloc(8);
  Kernel32.GetSystemTimes(idle.ptr!, kernel.ptr!, user.ptr!);
  const idleTicks = Number(idle.readBigUInt64LE(0));
  return { idle: idleTicks, busy: Number(kernel.readBigUInt64LE(0)) + Number(user.readBigUInt64LE(0)) - idleTicks };
}

/**
 * System resources — RAM (GlobalMemoryStatusEx), system-wide CPU % (two GetSystemTimes samples `sampleMs` apart),
 * uptime (GetTickCount64) and the process count — so an AI can answer "how much memory / CPU are we using?" natively,
 * never shelling out to PowerShell. Benchmark-chosen: the @bun-win32 FFI path beats node:os here (GlobalMemoryStatusEx
 * 1.3x vs os.freemem; GetSystemTimes 12.3x vs os.cpus()). Read-only; safe to call on a background/locked desktop.
 */
export async function systemResources(sampleMs = 200): Promise<SystemResources> {
  const memory = Buffer.alloc(64); // MEMORYSTATUSEX: dwLength@0, dwMemoryLoad@4, ullTotalPhys@8, ullAvailPhys@16, …
  memory.writeUInt32LE(64, 0); // dwLength MUST be set before the call
  Kernel32.GlobalMemoryStatusEx(memory.ptr!);
  const before = cpuTimes();
  await Bun.sleep(Math.max(50, sampleMs)); // floor to span several ~15.6ms scheduler ticks — a sub-tick window collapses both deltas to 0 and would report a misleading cpuPercent:0
  const after = cpuTimes();
  const idleDelta = after.idle - before.idle;
  const busyDelta = after.busy - before.busy;
  const totalDelta = idleDelta + busyDelta;
  return {
    memoryTotalMB: Math.round(Number(memory.readBigUInt64LE(8)) / 1048576),
    memoryAvailableMB: Math.round(Number(memory.readBigUInt64LE(16)) / 1048576),
    memoryLoadPercent: memory.readUInt32LE(4),
    cpuPercent: totalDelta > 0 ? Math.max(0, Math.min(100, Math.round((busyDelta / totalDelta) * 100))) : 0,
    uptimeSeconds: Math.round(Number(Kernel32.GetTickCount64()) / 1000),
    processes: listProcesses().length,
  };
}

/**
 * Resolve with the process id when a process whose image name contains `imageName` (case-insensitive) is
 * running — immediately if already present, otherwise polled until it starts. Rejects after `timeout` ms. Use it
 * to trigger work the moment a process the agent is waiting on spawns (a build, an installer, a launched app).
 */
export async function waitForProcess(imageName: string, options: { timeout?: number; interval?: number } = {}): Promise<number> {
  const timeout = options.timeout ?? 30000;
  const interval = options.interval ?? 200;
  const needle = imageName.toLowerCase();
  const start = Bun.nanoseconds();
  for (;;) {
    const hit = listProcesses().find((process) => process.name.toLowerCase().includes(needle));
    if (hit !== undefined) return hit.processId;
    if ((Bun.nanoseconds() - start) / 1e6 >= timeout) throw new Error(`waitForProcess: "${imageName}" did not start within ${timeout}ms`);
    await Bun.sleep(interval);
  }
}

/**
 * Resolve when NO process whose image name contains `imageName` (case-insensitive) is running — immediately if none is.
 * Re-polls the toolhelp snapshot (listProcesses) each tick: image-name presence is observable across EVERY integrity
 * level, so this honestly confirms an ELEVATED/protected job is gone — an OpenProcess(SYNCHRONIZE) handle CANNOT (a
 * medium-integrity host gets ACCESS_DENIED on an elevated installer, which would otherwise read as a false "gone") — and
 * it catches a respawn under a new pid. Excludes the host's OWN process so a needle that is a substring of the runtime
 * (e.g. "bun") can't wait on itself forever (mirrors watchWindows' WINEVENT_SKIPOWNPROCESS). The mirror of waitForProcess
 * — gate work on a windowless job FINISHING (an installer, a build, a conversion, a launched app closing) where
 * waitForWindowGone falsely resolves at once because the job owns no visible window. Rejects after `timeout` ms (30s).
 */
export async function waitForProcessGone(imageName: string, options: { timeout?: number; interval?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? 30000;
  const interval = options.interval ?? 200;
  const needle = imageName.toLowerCase();
  const self = Kernel32.GetCurrentProcessId(); // never wait on the host's own process (a "bun" needle would never resolve)
  const start = Bun.nanoseconds();
  for (;;) {
    if (!listProcesses().some((entry) => entry.processId !== self && entry.name.toLowerCase().includes(needle))) return;
    if ((Bun.nanoseconds() - start) / 1e6 >= timeout) throw new Error(`waitForProcessGone: a process matching "${imageName}" was still running after ${timeout}ms`);
    await Bun.sleep(interval);
  }
}
