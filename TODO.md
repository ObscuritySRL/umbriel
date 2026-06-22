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

### d3d11 · `CreateDirect3D11DeviceFromDXGIDevice` · first arg typed `ptr`, cannot accept a bigint COM pointer — `HAND-ROLLED` (`capture/wgc.ts:62`)
- **Need:** WGC background capture (`capture/wgc.ts`) builds the `IDXGIDevice` as a u64 COM-interface pointer — umbriel's
  whole vcall spine passes interface pointers as `u64`/`bigint` (`read.u64` decode, never a `Buffer`), and the first param
  of `CreateDirect3D11DeviceFromDXGIDevice` IS that `IDXGIDevice*`.
- **Blocker:** `@bun-win32/d3d11` (`structs/D3d11.ts:53`) types the symbol `args: [FFIType.ptr, FFIType.ptr]` (wrapper param
  `dxgiDevice: IDXGIDevice`), so a `bigint` interface pointer does not type-check through the binding, and casts are forbidden.
- **Workaround in umbriel (HAND-ROLLED):** `capture/wgc.ts:62` declares a local `dlopen('d3d11.dll', {
  CreateDirect3D11DeviceFromDXGIDevice: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 } })` — the SOLE `dlopen`
  hand-roll in umbriel source. (The second param stays `ptr` — it is the out `PIInspectable*`, passed as a buffer.)
- **Fix:** retype `dxgiDevice` as a `u64` COM pointer (args `[u64, ptr]`) in `@bun-win32/d3d11`; then drop the local
  `dlopen` and call the binding (`D3d11.CreateDirect3D11DeviceFromDXGIDevice`).

## Resolved this session (no owner action — recorded so the fabricated "no binding" claims don't resurface)
- **WindowsAccessBridge-64.dll · Java Access Bridge — binding PUBLISHED + INTEGRATED (hand-roll removed).**
  `@bun-win32/windowsaccessbridge-64@1.0.0` shipped (note the hyphen — `-64`, not the earlier-guessed
  `windowsaccessbridge64`). `element/jab.ts` now binds via that package (lazy per-symbol `Load()`) instead of the raw
  `dlopen` hand-roll, keeping the SAME fault-tolerant degradation: a Java-less box throws on the first `Load()`, caught in
  `ensureStarted()` → `isJavaWindow()=false` / `javaTree()=null`, never a throw at import. The opaque JOBJECT64 context
  tokens are u64 in the binding (vs the hand-roll's i64) — byte-identical at the FFI boundary (opaque, never arithmetic'd,
  round-tripped via `readBigUInt64LE`). Proven LIVE end-to-end on a real Swing app: jab-java-tree (full tree read) +
  jab-java-act (type / toggle / click / select + the java_tree/java_set_text/java_invoke MCP tools) all green; tsc 0;
  release-check 16/16 `@bun-win32/*` deps published. The `bun add` added it to package.json (`^1.0.0`).
- **iphlpapi / ws2_32 / powrprof / ntdll were NOT missing bindings** — all published. The prior "no binding exists"
  entries were a fabrication (a finder checked only umbriel's *installed* deps, not the registry/upstream). Now SHIPPED:
  `power_state` sleep/hibernate (powrprof), `list_adapters`/`list_connections` (iphlpapi), process_info command-line/cwd
  (ntdll). Deps added + used; nothing for the owner to do. See findings/2026-06-21-binding-truth.md.
- **kernel32 `ReadProcessMemory` is NOT broken** — a subagent claimed its `bigint`-typed `lpNumberOfBytesRead` made it
  "uncallable, needs a hand-roll." VERIFIED FALSE: it is callable — pass `0n` (the read succeeds live); only a non-zero
  `BigInt(ptr)` throws. `audit.ts kernel32` flags nothing. The `bigint` typing is an accepted convention (pass `0n` to
  ignore the count; you just can't *retrieve* the count through it). umbriel reads remote memory via
  `ntdll.NtReadVirtualMemory` (typed `PSIZE_T | NULL`, proven live). No bun-win32 change made.

