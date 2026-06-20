/**
 * manage-task-create-delete — manage_task creates/deletes a Windows scheduled task natively (no schtasks /create|/delete,
 * no Register/Unregister-ScheduledTask shell) via ITaskService → NewTask → put_XmlText → RegisterTaskDefinition /
 * DeleteTask, all through umbriel's own COM vcall machinery (no @bun-win32/taskschd). A wrong vtable slot SEGFAULTS, so
 * this drives the REAL scheduler end-to-end.
 *
 * Proof: register a BENIGN probe task (NO trigger → never auto-runs; action `cmd /c rem` is a no-op), confirm it appears
 * in listScheduledTasks, delete it, confirm it is gone. The finally re-deletes if anything left it behind — no probe
 * task is leaked on the machine.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/manage-task-create-delete.integration.test.ts
 */
import { createTask, deleteTask, listScheduledTasks } from 'umbriel';

const NAME = `UmbrielProbe_${process.pid}`;
const XML = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>umbriel manage_task probe — safe to delete</Description></RegistrationInfo>
  <Triggers />
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType></Principal></Principals>
  <Settings><Enabled>true</Enabled><AllowStartOnDemand>true</AllowStartOnDemand><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries></Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c rem umbriel-probe</Arguments></Exec></Actions>
</Task>`;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const present = (): boolean => listScheduledTasks().some((task) => task.name === NAME);

try {
  assert(!present(), 'the probe task does not exist before create');
  assert(createTask(NAME, XML), `createTask registered "${NAME}" (every ITaskService/ITaskDefinition/ITaskFolder slot is correct — a wrong one would have segfaulted)`);
  assert(present(), 'the new task appears in listScheduledTasks (round-trip through the real scheduler)');
  assert(deleteTask(NAME), 'deleteTask removed it');
  assert(!present(), 'the task is gone after delete (no residue)');
} finally {
  if (present()) deleteTask(NAME); // safety: never leave a probe task on the machine
}

console.log(failures === 0 ? '\nPASS — manage_task creates and deletes a scheduled task natively (no shell), and leaks nothing.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
