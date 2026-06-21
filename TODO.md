# TODO — owner action queue

Action items for the **owner** (not autonomous agents) — primarily **Win32 binding gaps** to
wrap or fix in **`@bun-win32`** (`D:\Projects\bun-win32`), the upstream FFI layer umbriel stands on.

Per [`AGENTS.md`](AGENTS.md): umbriel composes the installed `@bun-win32/*` bindings and never
declares new FFI symbols **when a binding already exposes them**. The one exception is a genuine
gap — a symbol/DLL **no** installed binding covers — which may be hand-rolled as a last resort
**only if it is logged here**, so the owner can wrap it upstream and the local hand-roll is later
removed.

## How to use
- A finder/fixer that must hand-roll a missing symbol, or that hits a mis-typed/blocked binding,
  appends an entry below before shipping.
- Each entry: the **DLL + symbol(s)**, **why** umbriel needs it, **status** (`GAP` = blocked or
  worked-around; `HAND-ROLLED` = declared locally, with `file:line`), and the **fix** (which
  `@bun-win32` package + the exact change).
- When you wrap/fix it upstream: bump umbriel's pinned dep, replace any local hand-roll with the
  binding, delete the entry.

## Open

### kernel32 · `GetVolumeInformationW` · 3 `_Out_opt_` params mis-typed non-nullable — `GAP` (binding fix, non-blocking)
- **Need:** `desktop/disk.ts` `listVolumes` (the `list_volumes` tool) reads only the volume label + filesystem name;
  it does not want the serial number, max-component-length, or filesystem-flags — all documented `_Out_opt_` on MS Learn,
  so the natural call passes `NULL` for those three.
- **Blocker (minor):** `@bun-win32/kernel32` types `lpVolumeSerialNumber` / `lpMaximumComponentLength` /
  `lpFileSystemFlags` as non-nullable `LPVOID` (MS Learn documents each as `LPDWORD _Out_opt_` — the generator both
  widened the type to `LPVOID` and missed the `_Out_opt_` nullability), and casts are forbidden, so `NULL` does not
  type-check.
- **Workaround in umbriel (shipped):** `disk.ts` passes ONE shared writable 4-byte scratch buffer for all three discarded
  out-params (the API harmlessly overwrites it; the values are never read). Zero functional cost — NOT blocked, unlike the
  `EnumServicesStatusExW` case below; flagged only so the typing can be relaxed.
- **Fix:** mark those three params `_Out_opt_` → `LPDWORD | NULL` in `@bun-win32/kernel32`; then `disk.ts` can pass `null`
  and drop the scratch buffer.

### advapi32 · `EnumServicesStatusExW` · `pszGroupName` mis-typed non-nullable — `GAP` (binding fix)
- **Need:** the Ex enumerate variant carries the owning **pid per row**, so `list_services` could
  return each service's pid directly, dropping `control_service`'s per-service `QueryServiceStatusEx`
  round-trip.
- **Blocker:** `@bun-win32/advapi32` types `pszGroupName` as non-nullable `LPCWSTR` (the generator
  missed its `_In_opt_`). `NULL` is REQUIRED for "all services" — an empty string returns only
  ungrouped services (measured 252 vs 301 live) — and casts are forbidden, so the Ex variant is
  unusable for a full enumeration today.
- **Workaround in umbriel:** `desktop/services.ts` uses the non-Ex `EnumServicesStatusW` (no group
  arg, correctly nullable) and recovers the pid on demand via `QueryServiceStatusEx`.
- **Fix:** mark `pszGroupName` `_In_opt_` → `LPCWSTR | NULL` in `@bun-win32/advapi32`; then
  `list_services` can carry the pid per row and drop the per-service round-trip.
- **Verification (2026-06-21):** bun-win32's own `nullcheck.ts advapi32` + `audit.ts advapi32` do NOT auto-flag
  `pszGroupName` (tooling-silent — likely a SAL-parse gap, since MS Learn documents it `_In_opt_`). So this is an
  OWNER-JUDGMENT call, not an auto-fixable audit hit: confirm the `_In_opt_` against the SDK header before retyping, then
  `nullcheck.ts --fix` (or hand-add `| NULL`). NOT changed autonomously — umbriel's non-Ex workaround is unaffected
  either way. (The 252-vs-301 measurement above is real evidence the NULL-for-all-services limitation exists.)

### WindowsAccessBridge-64.dll · Java Access Bridge (~9 symbols) · no binding — `HAND-ROLLED` (`element/jab.ts:34-43`)
- **Need:** drive Swing/AWT/JavaFX windows, which expose nothing to UIA/MSAA (only their top-level
  frame). Powers `java_tree` / `java_invoke` / `java_set_text`.
- **Status:** `element/jab.ts` hand-rolls the DLL via raw `dlopen` (lazy + fault-tolerant — the DLL
  is absent without a JAB-enabled JDK/JRE, so a missing bridge degrades to `isJavaWindow()=false`,
  never a throw at import). Symbols: `Windows_run`, `isJavaWindow`, `getAccessibleContextFromHWND`,
  `getAccessibleContextInfo`, `getAccessibleChildFromContext`, `getAccessibleActions`,
  `doAccessibleActions`, `setTextContents`, `releaseJavaObject`. This predates the
  hand-roll-and-flag policy; recorded now for visibility.
- **Status of the upstream binding:** the owner is CREATING this binding in another session — it will publish as
  `@bun-win32/windowsaccessbridge64` (owner's stated guess; not tonight). It is genuinely uncovered today (no
  `windowsaccessbridge*`/`jab`/`accessbridge`/`java` package on npm; the upstream `packages/windowsaccessbridge-64/` is
  the WIP). So the `element/jab.ts` `dlopen` hand-roll stays correct + necessary until that publishes.
- **Fix (in progress, owner):** once `@bun-win32/windowsaccessbridge64` is published, add it as a dep and replace the
  `element/jab.ts` hand-roll with it — keeping the lazy/fault-tolerant behavior (the DLL is absent without a JAB-enabled
  JDK/JRE, so a missing bridge must still degrade to `isJavaWindow()=false`, never throw at import).

## Resolved this session (no owner action — recorded so the fabricated "no binding" claims don't resurface)
- **iphlpapi / ws2_32 / powrprof / ntdll were NOT missing bindings** — all published. The prior "no binding exists"
  entries were a fabrication (a finder checked only umbriel's *installed* deps, not the registry/upstream). Now SHIPPED:
  `power_state` sleep/hibernate (powrprof), `list_adapters`/`list_connections` (iphlpapi), process_info command-line/cwd
  (ntdll). Deps added + used; nothing for the owner to do. See findings/2026-06-21-binding-truth.md.
- **kernel32 `ReadProcessMemory` is NOT broken** — a subagent claimed its `bigint`-typed `lpNumberOfBytesRead` made it
  "uncallable, needs a hand-roll." VERIFIED FALSE: it is callable — pass `0n` (the read succeeds live); only a non-zero
  `BigInt(ptr)` throws. `audit.ts kernel32` flags nothing. The `bigint` typing is an accepted convention (pass `0n` to
  ignore the count; you just can't *retrieve* the count through it). umbriel reads remote memory via
  `ntdll.NtReadVirtualMemory` (typed `PSIZE_T | NULL`, proven live). No bun-win32 change made.

