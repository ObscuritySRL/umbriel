/**
 * process-commandline — process_info now reports a process's COMMAND LINE + current working directory, read from the
 * target's PEB via ntdll (NtQueryInformationProcess → PebBaseAddress, then NtReadVirtualMemory through
 * PEB.ProcessParameters → RTL_USER_PROCESS_PARAMETERS.CommandLine/CurrentDirectory). The forensic detail an agent
 * otherwise needs wmic / Get-CimInstance Win32_Process for — now native, no shell. (This was earlier WRONGLY declined as
 * "ntdll has no @bun-win32 binding"; ntdll was published all along and is now a dep; NtReadVirtualMemory is the clean,
 * correctly-typed read path — no kernel32.ReadProcessMemory hand-roll.)
 *
 * Proof (a wrong PEB offset returns GARBAGE, not a crash — so the cross-check is the verifier):
 *   - SELF: processInfo(this pid).commandLine contains 'bun' + this test's name, and workingDir is the repo path —
 *     pinning PebBaseAddress@8, ProcessParameters@0x20, CommandLine@0x70, CurrentDirectory@0x38, and the UNICODE_STRING
 *     layout, all at once.
 *   - DENIED: a protected pid (System=4) degrades to '' (the OpenProcess|VM_READ is refused), never a throw — honest
 *     best-effort, same as imagePath.
 *   - MCP cross-process: the process_info tool (a separate server process) reads THIS process's pid and surfaces a
 *     'cmd:' line — proving the read works across the process boundary, under the read profile.
 *
 * bun test is broken repo-wide — runnable harness (no windows spawned):
 * Run: bun run example/process-commandline.integration.test.ts
 */
import { processInfo } from 'umbriel';

import { assert, finish, spawnServer } from './_harness';

// --- SELF (library) ---
const self = processInfo(process.pid);
assert(self !== null, `processInfo(${process.pid}) resolves this process`);
assert(self !== null && /bun/i.test(self.commandLine) && self.commandLine.includes('process-commandline'), `commandLine is the real launch line (got ${JSON.stringify(self?.commandLine)})`);
assert(self !== null && /umbriel/i.test(self.workingDir), `workingDir is the repo path (got ${JSON.stringify(self?.workingDir)})`);

// --- DENIED (library) — a protected pid degrades to '', never throws ---
const system = processInfo(4);
assert(system === null || system.commandLine === '', 'a protected pid (System=4) yields an empty command line (denied), not a throw');

// --- MCP cross-process: the server reads THIS process's command line over the read profile ---
const server = spawnServer({ UMBRIEL_PROFILE: 'safe' });
try {
  await server.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cmdline', version: '1' } });
  const out = server.textOf(await server.call('tools/call', { name: 'process_info', arguments: { pid: process.pid } }));
  assert(/cmd:/.test(out) && /bun/i.test(out), `process_info surfaces the command line cross-process (got: ${JSON.stringify(out.slice(0, 160))})`);
} finally {
  server.kill();
}

finish('PASS — process_info reads a process command line + cwd from the PEB via ntdll (self verified, protected pid degrades, MCP surfaces it cross-process).');
