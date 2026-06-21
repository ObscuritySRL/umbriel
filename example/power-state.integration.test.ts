/**
 * power-state — session/power control (lock / sign-out / restart / shutdown) was the one OS-operation verb family with
 * NO native tool: an agent told "restart to finish the update" had only a forbidden shell-out (shutdown.exe / logoff /
 * rundll32 user32,LockWorkStation / PowerShell Stop-Computer). power_state closes it via ONE general primitive over the
 * session/power state machine (User32 LockWorkStation/ExitWindowsEx + the in-process SE_SHUTDOWN_NAME enablement), os-
 * gated + confirm-required.
 *
 * Proof WITHOUT ending the live session (the destructive/disruptive actions are NOT fired — they would lock/shut down
 * the owner's machine; their ExitWindowsEx/LockWorkStation signatures are header-verified):
 *   (1) enableShutdownPrivilege() runs the FFI-risky token dance LIVE (OpenProcessToken + LookupPrivilegeValueW +
 *       AdjustTokenPrivileges with a hand-packed TOKEN_PRIVILEGES) and returns true — proving the struct/handle/slots
 *       are correct (a wrong layout would fail or crash), with NO power action taken (the privilege is merely enabled
 *       in this throwaway process's token).
 *   (2) the MCP power_state tool is OS-GATED — absent under `safe`, present under `full`/`UMBRIEL_OS=1` — and its
 *       confirm + action gates REFUSE before any OS call (so the gate is exercised without firing a shutdown).
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/power-state.integration.test.ts
 */
import { enableShutdownPrivilege } from 'umbriel';

import { assert, finish, spawnServer } from './_harness';

type ToolList = { result?: { tools?: { name: string; annotations?: { destructiveHint?: boolean } }[] } };
const toolNames = (message: ToolList): string[] => (message.result?.tools ?? []).map((tool) => tool.name);

// (1) LIVE FFI — the privilege-enable token dance succeeds (no segfault; struct + handle + signatures correct).
assert(enableShutdownPrivilege() === true, 'enableShutdownPrivilege() returns true — the OpenProcessToken + LookupPrivilegeValueW + AdjustTokenPrivileges FFI (hand-packed TOKEN_PRIVILEGES) ran live with no crash, no power action taken');

// (2a) GATE — absent under safe, present under full.
const safe = spawnServer({ UMBRIEL_PROFILE: 'safe' });
const full = spawnServer({ UMBRIEL_PROFILE: 'full', UMBRIEL_OS: '1' });
try {
  await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'power', version: '1' } });
  await full.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'power', version: '1' } });

  const safeTools = toolNames(await safe.call('tools/list', {}));
  const fullList = (await full.call('tools/list', {})) as ToolList;
  const fullTools = toolNames(fullList);
  assert(!safeTools.includes('power_state'), 'power_state is HIDDEN under the safe profile (os-gated — cannot end the session without the os capability)');
  assert(fullTools.includes('power_state'), 'power_state is exposed under the full profile');
  const annotated = (fullList.result?.tools ?? []).find((tool) => tool.name === 'power_state');
  assert(annotated?.annotations?.destructiveHint === true, 'power_state carries destructiveHint:true (the security signal the host drives confirmation off)');

  // (2b) CONFIRM + ACTION gates REFUSE before any OS call — exercised without firing a real power action.
  const noConfirm = await full.call('tools/call', { name: 'power_state', arguments: { action: 'lock' } });
  assert(noConfirm.result?.isError === true && /confirm/.test(noConfirm.result?.content?.[0]?.text ?? ''), 'power_state {action:lock} WITHOUT confirm is refused (the safety gate fires before any OS call — nothing was locked)');
  const badAction = await full.call('tools/call', { name: 'power_state', arguments: { action: 'sleep', confirm: true } });
  assert(badAction.result?.isError === true && /must be/.test(badAction.result?.content?.[0]?.text ?? ''), 'an unknown {action} is rejected with the valid set (no OS call made)');
} finally {
  safe.kill();
  full.kill();
}

finish('PASS — power_state: the SE_SHUTDOWN_NAME token dance runs live; the tool is os-gated and confirm/action-gated (no destructive action fired).');
