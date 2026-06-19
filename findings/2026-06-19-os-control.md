# OS-control substrate — native, no-PowerShell, benchmark-driven — 2026-06-19

Owner mandate (now in UMBRIEL_PROMPT.md): the AI does ANYTHING on the machine through umbriel's OWN tools and NEVER
shells out to PowerShell/cmd — total system control, not just GUI automation. AND: "benchmark everything, don't
blindly use bun-win32" — choose @bun-win32 FFI vs Bun-native per MEASURED perf. Both directives honored.

## Shipped this session (9 tools)

Machine state / readiness:
- system_status (read) — lock/secure desktop, screensaver, RDP, battery, monitors, foreground. The readability check
  that closes the display-off/locked false-negative.
- system_resources (read) — RAM, system-wide CPU %, uptime, process count.
- current_user (read) — account name, integrity level, elevated, UAC type.

Process control:
- kill_process (os) — terminate by pid/name, granular killed/denied/not-found.

Filesystem:
- make_dir / copy_file / move_file / delete_file (fs) — sandbox-confined via the existing resolveFsPath (lexical +
  reparse-point); a UMBRIEL_FS_ROOT escape (../ traversal, absolute system path, dest escape) is refused with no
  filesystem effect (security-tested).

Input parity:
- hover (input) — park the real pointer for hover-only UI (the one competitive gap).

## The benchmark drove DIFFERENT choices per domain (the whole point)

| capability        | @bun-win32 FFI            | Bun-native            | chosen | why |
|-------------------|---------------------------|-----------------------|--------|-----|
| memory            | GlobalMemoryStatusEx       | os.freemem            | FFI    | 1.3x faster + richer (load%) |
| CPU sample        | GetSystemTimes             | os.cpus()             | FFI    | 12.3x faster (os.cpus allocs per-core) |
| uptime            | GetTickCount64             | os.uptime             | tie    | FFI (one source) |
| kill              | TerminateProcess           | process.kill          | FFI    | granular status vs thrown EPERM |
| copy / mkdir / move / delete | CopyFileW/… (FFI) | node:fs               | Bun    | ties/wins + far simpler/safer than wide-string FFI |

Lesson recorded: FFI is NOT the default — it won for resources/kill (perf, granularity) and LOST to node:fs for the
filesystem (a tie on speed, a rout on simplicity/safety). Measured, not assumed. Also: GetLastError is UNRELIABLE
across the bun:ffi trampoline (returned 0 for a bad pid) — kill's denied-vs-not-found is decided by the toolhelp
snapshot instead. (Benchmarks: .scratch/bench-resources.ts, bench-fs.ts, probe-kill-compare.ts.)

## Panel-B capability hunt (ranked, bindings PROVEN live this session — build queue)

1. **stat_path** (fs, read) — SHIPPED (39827f6). node:fs size/times + FFI GetFileAttributesW for the attribute bits.
2. **registry_get / registry_list** (os) — SHIPPED (544e8b2). desktop/registry.ts: RegOpenKeyExW + two-pass
   RegQueryValueExW + RegEnumKeyExW/RegEnumValueW, decoded by RegType. **registry_set (write) is the remaining half**
   — RegCreateKeyExW + RegSetValueExW (bound); gate carefully (write is more sensitive — likely HKCU-confined or an
   explicit allow), with the kill_process security lesson. Build registry_set next or fold into the env_var work.
3. **manage_process** (os) — SHIPPED (448f384). suspend/resume via the thread-snapshot freeze, priority via
   SetPriorityClass; self/host-excluded; denied/not-found mapping. Verified live (froze 6 threads, process stayed
   alive). **process_info (read) is the remaining companion** — GetProcessTimes/GetProcessHandleCount/
   K32GetProcessMemoryInfo + th32ParentProcessID tree (tells the AI WHICH child to freeze). Optional follow-up.
4. **list_services + control_service** (read / os) — SHIPPED (61e2592). desktop/services.ts. list_services via
   EnumServicesStatusW (name/displayName/state); control_service via OpenServiceW + QueryServiceStatusEx (state + pid) /
   StartServiceW / ControlService. Verified live (301 services, Dnscache running pid 2896, stop → denied medium IL).
   **BINDING CONSTRAINT (upstream, D:\Projects\bun-win32):** EnumServicesStatusExW (the Ex variant, carries the pid per
   row) types `pszGroupName` as non-nullable `LPCWSTR` — the generator missed its `_In_opt_`. NULL is REQUIRED for "all
   services" (an empty string returns ONLY ungrouped — measured 252 vs 301), and casts are forbidden, so the Ex variant
   is unusable for a full enumeration today. Used the non-Ex EnumServicesStatusW (no group arg, correctly nullable) and
   recover the pid per-service via control_service. FIX upstream: mark pszGroupName `_In_opt_` → `LPCWSTR | NULL`, then
   list_services could carry the pid per row. Still a wall as of this session.
5. **get_env + set_env** (read / os) — SHIPPED (ba24467). desktop/env.ts + registry write primitives
   (registrySetString/registryDeleteValue). user/machine persist via the registry + WM_SETTINGCHANGE broadcast;
   process via process.env + SetEnvironmentVariableW. Verified live (USER set→read→delete roundtrip, machine denied).
   Fixed a consistency bug found live (process read via Bun.env vs write via SetEnvironmentVariableW = different views).

**Panel-B queue COMPLETE — all 5 shipped.**

## Round 2 — fresh panels on the new code (both spawned same turn)

**Panel-A critic on the new OS-control code** (registry/services/env/manage_process/stat_path): 3 seats clean
(segfault-safety, fabrication, ergonomics-hygiene), 3 CONFIRMED + FIXED:
- MEDIUM security (327a1ba) — set_env/get_env/registry_get echoed the VALUE on result line 1, which traceCall journals;
  a secret env/registry value leaked into the UMBRIEL_TRACE journal. Fixed: value on line 2 (off the line-1 sample),
  set_env doesn't echo it, + redactSecrets() on the observation. Regression test trace-redaction.
- MEDIUM (d86351a) — registryList corrupted any value > 16KB (reused buffer; on ERROR_MORE_DATA the name + lpcchValueName
  are stale, so the over-cap value got the PRIOR name + NUL padding and its real name was lost; get_env machine reads
  HKLM Path which is commonly > 16KB). Fixed: re-query name+type only on MORE_DATA, mark oversized. Test registry-large-value.
- LOW (43f491c) — AI.md omitted the 6 new library exports + 3 source files. Fixed.

**Panel-B capability hunt for NEW gaps** (all 5 buildable NOW on current deps, 0 need a new binding except network):
1. **process_info** (read) — SHIPPED (0d2d106). value 9.5: deep per-pid detail (start/CPU/memory/handles + parent/child
   tree) so kill/suspend/priority are TARGETED not blind. kernel32, proven live.
2. **read_event_log** (read) — SHIPPED (1734d48). desktop/eventlog.ts: advapi32 legacy OpenEventLogW/ReadEventLogW/
   CloseEventLog, EVENTLOG_BACKWARDS_READ, hand-decoded EVENTLOGRECORD. {log} enum (OpenEventLogW falls back to
   Application for an unknown name — documented), {count}/{level} filter. Verified live (real System records, error
   filter). Note: the `message` is the raw insertion strings, not the FormatMessage-formatted sentence (would need the
   source's message DLL) — still diagnostic.
3. **get_displays** (read, value 7) — user32 EnumDisplayDevicesW/EnumDisplaySettingsW; DEVMODEW tail anchored to dmSize
   (bpp@dmSize-20, width@-16, height@-12, freq@-4). Proven live (5120x1440@240). Resolution/refresh/topology for
   capture+placement.
4. **registry_set** (os, value 6.5) — DEFER: generalizes the proven scoped write primitives, but arbitrary HKLM/HKCU
   write is the most destructive surface; needs confirm-flag + per-type validation + careful review. Build after the reads.
5. **list_scheduled_tasks** (read, value 7) — OWNER-DECISION: buildable on combase + umbriel's OWN vcall/guid COM
   machinery (CLSID_TaskScheduler, no taskschd pkg needed), but hand-driving ITaskService via raw vtable slots is the
   highest segfault risk. The #1 autorun/persistence vector. Owner decides whether to invest the COM work.
- **network (list_adapters/list_connections) — BLOCKED:** no iphlpapi/ws2_32 in ANY installed @bun-win32 binding
  (verified). Genuinely needs a NEW @bun-win32/iphlpapi dependency — an owner decision (new dep + attack surface).

Sequencing: read_event_log → get_displays → (registry_set with security pass) → (list_scheduled_tasks if owner opts in).

## Owner-reserved (flagged, NOT fixed)

SERVER_INFO.version (mcp.ts:123 1.9.0 vs 1.9.3) blocks release-check; server.json + AGENTS.md carry the same stale
3-fs-tool list. Tool count 61→71 this session.
