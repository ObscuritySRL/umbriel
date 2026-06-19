// Windows Task Scheduler via COM — list every scheduled task (the #1 autorun/persistence surface) natively, no
// schtasks/Get-ScheduledTask shell and NO @bun-win32/taskschd package: it drives CLSID_TaskScheduler →
// ITaskService → ITaskFolder → IRegisteredTask entirely through umbriel's OWN generic COM machinery (vcall/guid/
// comRelease + the BSTR decoder), the same mechanism com/automation.ts uses for CUIAutomation, just a different CLSID.
//
// SEGFAULT SAFETY: a wrong vtable slot is an unchecked function-pointer call that crashes the host. Every slot in
// TASK_SLOT was verified LIVE (the integration test drives the real scheduler and asserts decoded values; a wrong
// slot yields garbage or a crash). The non-obvious one: IRegisteredTask has a get+PUT Enabled property, and a
// get+put property consumes TWO vtable slots — so put_Enabled@11 shifts every method after it, making
// get_LastRunTime slot 15 (not 14), get_LastTaskResult 16, get_NextRunTime 18.

import { FFIType } from 'bun:ffi';
import Combase from '@bun-win32/combase';
import Oleaut32 from '@bun-win32/oleaut32';

import { comRelease, guid, vcall } from '../com/com';
import { decodeBstr } from '../com/reads';
import { CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, S_OK, VT_I4 } from '../com/constants';

const CLSID_TaskScheduler = '{0f87369f-a4e5-4cfc-bd3e-73e6154572dd}';
const IID_ITaskService = '{2faba4c7-4da9-4013-9697-20cc3fd40f85}';
const TASK_ENUM_HIDDEN = 0x0001;
const MAX_TASKS = 1000;
const MAX_DEPTH = 12;
const TASK_STATES: Record<number, string> = { 0: 'unknown', 1: 'disabled', 2: 'queued', 3: 'ready', 4: 'running' };

/** Verified-LIVE vtable slots. IDispatch-derived: IUnknown 0-2, IDispatch 3-6, interface methods from 7. */
export const TASK_SLOT = {
  ITaskService_GetFolder: 7,
  ITaskService_Connect: 10,
  ITaskFolder_get_Path: 8,
  ITaskFolder_GetFolders: 10,
  ITaskFolder_GetTasks: 14,
  Collection_get_Count: 7, // ITaskFolderCollection + IRegisteredTaskCollection share Count@7 / Item@8
  Collection_get_Item: 8,
  IRegisteredTask_get_Name: 7,
  IRegisteredTask_get_State: 9,
  IRegisteredTask_get_Enabled: 10,
  IRegisteredTask_get_LastRunTime: 15, // shifted past put_Enabled@11 + Run@12 + RunEx@13 + GetInstances@14
  IRegisteredTask_get_LastTaskResult: 16,
  IRegisteredTask_get_NextRunTime: 18, // shifted past get_NumberOfMissedRuns@17
};

export interface ScheduledTask {
  path: string; // folder path, e.g. \Microsoft\Office
  name: string;
  state: string;
  enabled: boolean;
  lastRun: string; // ISO 8601, or '' if never run
  nextRun: string; // ISO 8601, or '' if not scheduled
  lastResult: string; // hex exit code / HRESULT of the last run, e.g. 0x0
}

/** Allocate a NUL-terminated BSTR. Caller frees it with Oleaut32.SysFreeString. */
function allocBstr(text: string): ReturnType<typeof Oleaut32.SysAllocString> {
  const wide = Buffer.from(`${text}\0`, 'utf16le'); // named local — kept alive across the SysAllocString read
  return Oleaut32.SysAllocString(wide.ptr!);
}

/** OLE DATE (days since 1899-12-30) → ISO, or '' for the never/no-run sentinel (anything before year 2000). */
function oleDate(date: number): string {
  return date < 36526 ? '' : new Date((date - 25569) * 86_400_000).toISOString();
}

function getBstrField(task: bigint, slot: number): string {
  const out = Buffer.alloc(8);
  if (vcall(task, slot, [FFIType.ptr], [out.ptr!]) !== S_OK) return '';
  return decodeBstr(out.readBigUInt64LE(0)); // copies, then frees the BSTR
}

function getLongField(task: bigint, slot: number): number {
  const out = Buffer.alloc(4);
  if (vcall(task, slot, [FFIType.ptr], [out.ptr!]) !== S_OK) return 0;
  return out.readInt32LE(0);
}

function getDateField(task: bigint, slot: number): string {
  const out = Buffer.alloc(8);
  if (vcall(task, slot, [FFIType.ptr], [out.ptr!]) !== S_OK) return '';
  return oleDate(out.readDoubleLE(0));
}

/** A VT_I4 collection index VARIANT (collections are 1-based). */
function indexVariant(index: number): Buffer {
  const variant = Buffer.alloc(16);
  variant.writeUInt16LE(VT_I4, 0);
  variant.writeInt32LE(index, 8);
  return variant;
}

function collectTasks(folder: bigint, folderPath: string, tasks: ScheduledTask[]): void {
  const collectionOut = Buffer.alloc(8);
  if (vcall(folder, TASK_SLOT.ITaskFolder_GetTasks, [FFIType.i32, FFIType.ptr], [TASK_ENUM_HIDDEN, collectionOut.ptr!]) !== S_OK) return;
  const collection = collectionOut.readBigUInt64LE(0);
  try {
    const countOut = Buffer.alloc(4);
    if (vcall(collection, TASK_SLOT.Collection_get_Count, [FFIType.ptr], [countOut.ptr!]) !== S_OK) return;
    const count = countOut.readInt32LE(0);
    for (let index = 1; index <= count && tasks.length < MAX_TASKS; index += 1) {
      const variant = indexVariant(index);
      const taskOut = Buffer.alloc(8);
      if (vcall(collection, TASK_SLOT.Collection_get_Item, [FFIType.ptr, FFIType.ptr], [variant.ptr!, taskOut.ptr!]) !== S_OK) continue;
      const task = taskOut.readBigUInt64LE(0);
      tasks.push({
        path: folderPath,
        name: getBstrField(task, TASK_SLOT.IRegisteredTask_get_Name),
        state: TASK_STATES[getLongField(task, TASK_SLOT.IRegisteredTask_get_State)] ?? 'unknown',
        enabled: getLongField(task, TASK_SLOT.IRegisteredTask_get_Enabled) !== 0, // VARIANT_BOOL: -1 true / 0 false
        lastRun: getDateField(task, TASK_SLOT.IRegisteredTask_get_LastRunTime),
        nextRun: getDateField(task, TASK_SLOT.IRegisteredTask_get_NextRunTime),
        lastResult: `0x${(getLongField(task, TASK_SLOT.IRegisteredTask_get_LastTaskResult) >>> 0).toString(16)}`,
      });
      comRelease(task);
    }
  } finally {
    comRelease(collection);
  }
}

function walkFolder(service: bigint, folderPath: string, depth: number, tasks: ScheduledTask[]): void {
  if (depth > MAX_DEPTH || tasks.length >= MAX_TASKS) return;
  const pathBstr = allocBstr(folderPath);
  const folderOut = Buffer.alloc(8);
  const opened = vcall(service, TASK_SLOT.ITaskService_GetFolder, [FFIType.ptr, FFIType.ptr], [pathBstr, folderOut.ptr!]);
  Oleaut32.SysFreeString(pathBstr);
  if (opened !== S_OK) return;
  const folder = folderOut.readBigUInt64LE(0);
  try {
    collectTasks(folder, folderPath, tasks);
    // recurse into subfolders (ITaskFolderCollection shares Count@7 / Item@8 with the task collection)
    const subfoldersOut = Buffer.alloc(8);
    if (vcall(folder, TASK_SLOT.ITaskFolder_GetFolders, [FFIType.i32, FFIType.ptr], [0, subfoldersOut.ptr!]) === S_OK) {
      const subfolders = subfoldersOut.readBigUInt64LE(0);
      try {
        const countOut = Buffer.alloc(4);
        if (vcall(subfolders, TASK_SLOT.Collection_get_Count, [FFIType.ptr], [countOut.ptr!]) === S_OK) {
          const count = countOut.readInt32LE(0);
          for (let index = 1; index <= count && tasks.length < MAX_TASKS; index += 1) {
            const variant = indexVariant(index);
            const subOut = Buffer.alloc(8);
            if (vcall(subfolders, TASK_SLOT.Collection_get_Item, [FFIType.ptr, FFIType.ptr], [variant.ptr!, subOut.ptr!]) !== S_OK) continue;
            const subfolder = subOut.readBigUInt64LE(0);
            const subPath = getBstrField(subfolder, TASK_SLOT.ITaskFolder_get_Path);
            comRelease(subfolder);
            if (subPath !== '') walkFolder(service, subPath, depth + 1, tasks);
          }
        }
      } finally {
        comRelease(subfolders);
      }
    }
  } finally {
    comRelease(folder);
  }
}

/**
 * Every scheduled task on the local machine (recursively across all task folders): path, name, state, enabled,
 * last/next run time, and last result code. [] if the Task Scheduler service is unreachable. Read-only — no task is
 * created, run, or modified. Hidden tasks are included (TASK_ENUM_HIDDEN) since they are a persistence vector.
 */
export function listScheduledTasks(): ScheduledTask[] {
  Combase.CoInitializeEx(null, COINIT_APARTMENTTHREADED); // idempotent (S_FALSE if already initialized on this thread)
  const out = Buffer.alloc(8);
  if (Combase.CoCreateInstance(guid(CLSID_TaskScheduler).ptr!, 0n, CLSCTX_INPROC_SERVER, guid(IID_ITaskService).ptr!, out.ptr!) !== S_OK) return [];
  const service = out.readBigUInt64LE(0);
  if (service === 0n) return [];
  const tasks: ScheduledTask[] = [];
  try {
    const emptyVariant = Buffer.alloc(16); // 4× VT_EMPTY → Connect to the local machine as the current user
    if (vcall(service, TASK_SLOT.ITaskService_Connect, [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], [emptyVariant.ptr!, emptyVariant.ptr!, emptyVariant.ptr!, emptyVariant.ptr!]) !== S_OK) return tasks;
    walkFolder(service, '\\', 0, tasks);
  } finally {
    comRelease(service);
  }
  return tasks;
}
