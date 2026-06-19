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
5. **env_var** (read / os) — a SPECIALIZATION of registry (HKCU\Environment + HKLM Session Manager) + a process-scope
   Bun.env branch (the ONE genuine FFI-vs-Bun split: Bun.env wins for process scope, FFI registry for user/machine) +
   a WM_SETTINGCHANGE broadcast. Build AFTER registry (then it's a thin specialization). All bound + proven.

Sequencing: registry → process-control → services → env (env reuses registry). None duplicate a shipped tool; every
binding verified callable this session.

## Owner-reserved (flagged, NOT fixed)

SERVER_INFO.version (mcp.ts:123 1.9.0 vs 1.9.3) blocks release-check; server.json + AGENTS.md carry the same stale
3-fs-tool list. Tool count 61→71 this session.
