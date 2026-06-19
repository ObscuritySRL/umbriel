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

## Still open on the mandate (next loops, each benchmarked)

process suspend/resume, registry read/write, services query/start/stop, env, network, file rename/attrib. Tool count
61→70 this session. SERVER_INFO.version (mcp.ts:123 1.9.0 vs 1.9.3) remains owner-reserved + flagged (blocks
release-check).
