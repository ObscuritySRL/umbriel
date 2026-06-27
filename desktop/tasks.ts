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
import { getBstr, getLong } from '../com/reads';
import { CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, S_OK, VT_I4 } from '../com/constants';

const CLSID_TaskScheduler = '{0f87369f-a4e5-4cfc-bd3e-73e6154572dd}';
const IID_ITaskService = '{2faba4c7-4da9-4013-9697-20cc3fd40f85}';
const TASK_ENUM_HIDDEN = 0x0001;
const TASK_CREATE_OR_UPDATE = 6; // RegisterTaskDefinition flags
const TASK_LOGON_INTERACTIVE_TOKEN = 3; // run as the current interactive user, no stored password
const MAX_TASKS = 1000;
const MAX_DEPTH = 12;
const TASK_STATES: Record<number, string> = { 0: 'unknown', 1: 'disabled', 2: 'queued', 3: 'ready', 4: 'running' };

/** Verified-LIVE vtable slots. IDispatch-derived: IUnknown 0-2, IDispatch 3-6, interface methods from 7. */
export const TASK_SLOT = {
  ITaskService_GetFolder: 7,
  ITaskService_NewTask: 9, // → ITaskDefinition (GetFolder@7, GetRunningTasks@8, NewTask@9, Connect@10)
  ITaskService_Connect: 10,
  ITaskDefinition_put_XmlText: 20, // get+put property: get_XmlText@19, put_XmlText@20
  ITaskFolder_get_Path: 8,
  ITaskFolder_GetFolders: 10,
  ITaskFolder_DeleteTask: 15,
  ITaskFolder_GetTasks: 14,
  ITaskFolder_RegisterTaskDefinition: 17, // ...DeleteTask@15, RegisterTask@16, RegisterTaskDefinition@17
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
      try {
        tasks.push({
          path: folderPath,
          name: getBstr(task, TASK_SLOT.IRegisteredTask_get_Name),
          state: TASK_STATES[getLong(task, TASK_SLOT.IRegisteredTask_get_State)] ?? 'unknown',
          enabled: getLong(task, TASK_SLOT.IRegisteredTask_get_Enabled) !== 0, // VARIANT_BOOL: -1 true / 0 false
          lastRun: getDateField(task, TASK_SLOT.IRegisteredTask_get_LastRunTime),
          nextRun: getDateField(task, TASK_SLOT.IRegisteredTask_get_NextRunTime),
          lastResult: `0x${(getLong(task, TASK_SLOT.IRegisteredTask_get_LastTaskResult) >>> 0).toString(16)}`,
        });
      } finally {
        comRelease(task); // release on EVERY exit — incl. a field-read vcall throw if the task is deleted mid-enumeration (was a bare comRelease outside try → leaked the IRegisteredTask proxy on the throw path)
      }
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
            let subPath: string;
            try {
              subPath = getBstr(subfolder, TASK_SLOT.ITaskFolder_get_Path); // getBstr issues a vcall — a torn-down subfolder proxy (folder deleted mid-enumeration) throws the UAF guard
            } finally {
              comRelease(subfolder); // release on EVERY exit incl. that throw (was a bare comRelease outside try → leaked the ITaskFolder proxy; mirrors collectTasks/elementArrayNames)
            }
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
  const service = connectTaskService();
  if (service === 0n) return [];
  const tasks: ScheduledTask[] = [];
  try {
    walkFolder(service, '\\', 0, tasks);
  } finally {
    comRelease(service);
  }
  return tasks;
}

/** CoCreateInstance(TaskScheduler) + Connect to the local machine as the current user. Returns the ITaskService pointer
 *  (caller comReleases) or 0n. Shared by listScheduledTasks and the create/delete writers. */
function connectTaskService(): bigint {
  Combase.CoInitializeEx(null, COINIT_APARTMENTTHREADED); // idempotent (S_FALSE if already initialized on this thread)
  const out = Buffer.alloc(8);
  if (Combase.CoCreateInstance(guid(CLSID_TaskScheduler).ptr!, 0n, CLSCTX_INPROC_SERVER, guid(IID_ITaskService).ptr!, out.ptr!) !== S_OK) return 0n;
  const service = out.readBigUInt64LE(0);
  if (service === 0n) return 0n;
  const emptyVariant = Buffer.alloc(16); // 4× VT_EMPTY → local machine, current user
  if (vcall(service, TASK_SLOT.ITaskService_Connect, [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], [emptyVariant.ptr!, emptyVariant.ptr!, emptyVariant.ptr!, emptyVariant.ptr!]) !== S_OK) {
    comRelease(service);
    return 0n;
  }
  return service;
}

/**
 * Create (or update) a scheduled task in the root folder from a task-definition XML string — the no-shell equivalent of
 * schtasks /create or Register-ScheduledTask. The XML drives ANY trigger/action/principal, so this is ONE general
 * primitive (not a bespoke autorun tool); `name` is the task name within the root folder. Registers as the current
 * interactive user (no stored password). true on success. Drives ITaskService/ITaskDefinition/ITaskFolder via umbriel's
 * own COM machinery (no @bun-win32/taskschd).
 */
export function createTask(name: string, xml: string): boolean {
  const service = connectTaskService();
  if (service === 0n) return false;
  try {
    const defOut = Buffer.alloc(8);
    if (vcall(service, TASK_SLOT.ITaskService_NewTask, [FFIType.i32, FFIType.ptr], [0, defOut.ptr!]) !== S_OK) return false;
    const definition = defOut.readBigUInt64LE(0);
    if (definition === 0n) return false;
    try {
      const xmlBstr = allocBstr(xml);
      const putResult = vcall(definition, TASK_SLOT.ITaskDefinition_put_XmlText, [FFIType.ptr], [xmlBstr]);
      Oleaut32.SysFreeString(xmlBstr);
      if (putResult !== S_OK) return false;
      const rootBstr = allocBstr('\\');
      const folderOut = Buffer.alloc(8);
      const gotFolder = vcall(service, TASK_SLOT.ITaskService_GetFolder, [FFIType.ptr, FFIType.ptr], [rootBstr, folderOut.ptr!]);
      Oleaut32.SysFreeString(rootBstr);
      if (gotFolder !== S_OK) return false;
      const folder = folderOut.readBigUInt64LE(0);
      try {
        const nameBstr = allocBstr(name);
        const variant = Buffer.alloc(16); // VT_EMPTY userId / password / sddl, reused (read-only by the callee)
        const registeredOut = Buffer.alloc(8);
        const registered = vcall(
          folder,
          TASK_SLOT.ITaskFolder_RegisterTaskDefinition,
          [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr],
          [nameBstr, definition, TASK_CREATE_OR_UPDATE, variant.ptr!, variant.ptr!, TASK_LOGON_INTERACTIVE_TOKEN, variant.ptr!, registeredOut.ptr!],
        );
        Oleaut32.SysFreeString(nameBstr);
        if (registered !== S_OK) return false;
        const registeredTask = registeredOut.readBigUInt64LE(0);
        if (registeredTask !== 0n) comRelease(registeredTask);
        return true;
      } finally {
        comRelease(folder);
      }
    } finally {
      comRelease(definition);
    }
  } finally {
    comRelease(service);
  }
}

/** Delete a scheduled task by name (within the root folder) — the no-shell schtasks /delete. true on success. */
export function deleteTask(name: string): boolean {
  const service = connectTaskService();
  if (service === 0n) return false;
  try {
    const rootBstr = allocBstr('\\');
    const folderOut = Buffer.alloc(8);
    const gotFolder = vcall(service, TASK_SLOT.ITaskService_GetFolder, [FFIType.ptr, FFIType.ptr], [rootBstr, folderOut.ptr!]);
    Oleaut32.SysFreeString(rootBstr);
    if (gotFolder !== S_OK) return false;
    const folder = folderOut.readBigUInt64LE(0);
    try {
      const nameBstr = allocBstr(name);
      const deleted = vcall(folder, TASK_SLOT.ITaskFolder_DeleteTask, [FFIType.ptr, FFIType.i32], [nameBstr, 0]);
      Oleaut32.SysFreeString(nameBstr);
      return deleted === S_OK;
    } finally {
      comRelease(folder);
    }
  } finally {
    comRelease(service);
  }
}
