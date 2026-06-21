# Binding-truth: fabricated "no @bun-win32 binding" declines, corrected + the near-miss that followed — 2026-06-21

## The fabrication (owner caught it)

Three capabilities had been DECLINED across prior passes as "no @bun-win32 binding exists" — a FABRICATION. A finder had
verified only that the packages were absent from umbriel's *installed* deps (`node_modules` / `package.json`) and that was
written up as "the binding does not exist." The owner pointed out `@bun-win32/iphlpapi`, `@bun-win32/ws2_32`, and
`@bun-win32/powrprof` are all published. Verified ground truth (npm registry + the upstream `D:\Projects\bun-win32\packages\`):
ALL of `iphlpapi` (1.0.5), `ws2_32` (1.0.6), `powrprof` (1.0.1), `ntdll` (1.0.7) exist (the upstream has ~140 packages).

**LESSON (load-bearing):** "absent from umbriel's installed deps" ≠ "no binding exists." Before declaring a binding gap,
check the npm registry (`registry.npmjs.org/@bun-win32%2f<pkg>`) AND the upstream `D:\Projects\bun-win32\packages\`. The
only GENUINE gaps are: WindowsAccessBridge-64.dll (owner is building it now as `@bun-win32/windowsaccessbridge64`, not yet
published) — everything DLL-level else umbriel needs is published.

## SHIPPED (the 3 wrongly-declined capabilities, each proven live)
- **`power_state` sleep + hibernate** (powrprof `SetSuspendState`, SE_SHUTDOWN_NAME self-enabled). FFI proven live (privilege
  dance), suspend not fired. `98e8e4d`.
- **`list_adapters` + `list_connections`** (iphlpapi `GetAdaptersAddresses` + `GetExtendedTcpTable`/`GetExtendedUdpTable`).
  Every x64 struct offset verified live: loopback 127.0.0.1/::1, IPv6 "::" compression, ntohs ports, and the headline
  bound-port pid-tie (a self-bound listener found in the table with this process's exact pid). `dcc62da`.
- **process_info command line + cwd** (ntdll `NtQueryInformationProcess` → PEB → `NtReadVirtualMemory` through
  RTL_USER_PROCESS_PARAMETERS). Read this process's own cmdline (quoted arg preserved) + cwd; protected pid degrades to ''.
  `442fcf0`.

## The near-miss (the owner's "triple-check, the model found them accurate" caveat was RIGHT)

While building cmdline, a research subagent claimed `@bun-win32/kernel32`'s `ReadProcessMemory` wrapper was BROKEN —
`lpNumberOfBytesRead` typed `bigint` (vs the Symbols table's `FFIType.ptr`), "uncallable without a forbidden cast, needs a
dlopen hand-roll." I started hand-editing the binding (changed 1 of 3 wrappers: `bigint`→`LPVOID`) before the owner said to
check bun-win32's own rules/docs first. Doing so REVERSED the conclusion:

1. **bun-win32 AGENTS.md** is explicit: type bugs are fixed via `scripts/audit.ts`/`scripts/nullcheck.ts --fix` (the
   authoritative checkers), NOT hand-edits; audit notices are "accepted-convention — verify, don't blindly fix"; "do not
   mutate already-shipped bindings on a hunch."
2. **`audit.ts kernel32` emits NO finding** for ReadProcessMemory/WriteProcessMemory/Toolhelp32ReadProcessMemory — i.e. the
   `bigint` typing is within the repo's accepted conventions.
3. **Empirical test (decisive):** `Kernel32.ReadProcessMemory(self, srcAddr, out.ptr!, 9n, 0n)` → **result=1, the read
   SUCCEEDED** (read "UMBRIELOK" from own memory). Only a non-zero `BigInt(ptr)` throws "Unable to convert to a pointer."
   So the binding is **callable** — `bigint` means "pass `0n` to ignore the bytes-read count" (Bun's `ptr` arg accepts the
   bigint `0n` as NULL). The subagent only ever tested `BigInt(ptr)`, never `0n`, and wrongly concluded "uncallable."

**Conclusion: kernel32.ReadProcessMemory is NOT broken. I reverted my edit; bun-win32 left pristine; NO change pushed.**
The reverted approach was also a SIMPLER alternative the subagent missed: `ReadProcessMemory(h, addr, buf.ptr!, size, 0n)`
works with no hand-roll. (umbriel uses `ntdll.NtReadVirtualMemory` anyway — consistent with `NtQueryInformationProcess`,
typed `PSIZE_T | NULL`, proven live — so no churn.)

**LESSON:** before declaring a binding "incorrect," (a) read bun-win32's AGENTS.md + PROMPT.md (the rules), (b) run its
`audit.ts`/`nullcheck.ts` (the source of truth — they encode the accepted conventions), (c) EMPIRICALLY call it the way the
type permits (here `0n`, not just `BigInt(ptr)`). A subagent's "it's broken" is a claim to verify, not a fact.

## Tooling-silent limitations recorded for the OWNER (not auto-fixable, not changed)
- **kernel32 `ReadProcessMemory`/`WriteProcessMemory`/`Toolhelp32ReadProcessMemory`** — the `SIZE_T *lpNumberOfBytes*`
  out-params are typed `bigint`, so you can pass `0n` (ignore) but cannot RETRIEVE the bytes-read/written count through the
  typed wrapper (that would need `LPVOID`/Pointer, the way DWORD* out-params like `GetProcessHandleCount`'s are typed).
  `audit.ts` does not flag it. Real but accepted limitation — owner's call whether to widen the type.
- **advapi32 `EnumServicesStatusExW` `pszGroupName`** — typed non-nullable `LPCWSTR` though MS Learn documents `_In_opt_`
  (NULL needed for "all services"; measured 252-vs-301). `nullcheck.ts`/`audit.ts` do NOT auto-flag it (likely a SAL-parse
  gap). Owner-judgment to confirm against the SDK header before retyping. umbriel's non-Ex workaround is unaffected.

No `@bun-win32` package was modified this session. The bindings umbriel actually USES (powrprof/iphlpapi/ntdll/kernel32
process APIs) all worked LIVE.
