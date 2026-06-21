# HARDEN+OPTIMIZE pass over the NEW FFI surface — CONVERGED, 0 code changes — 2026-06-21

Third dedicated HARDEN run. The prior two converged the whole tree (`harden-converged` at 83 tools, `two-panel-ship`
at 86). Since then three FEATURE commits shipped new native code that no harden lane had ever swept — this pass targets
exactly that un-hardened surface and proves it is already hard.

Goal: make what EXISTS faster/leaner/clearer/safer at ZERO external-behavior change — every tool output / public
signature / policy gate byte-identical, every win moving a MEASURED axis, proven LIVE + regression-gated. ADD NOTHING.

**Baseline = end state (NO code changed — the correct outcome): HEAD `aad247a`; tsc 0; 51 unit tests green; slot-gate
145 (104+23+18, 0 mismatched); 88 tools (68 safe / 34 readonly / 20 os-fs). Docs already reconcile to 88
(tool-count.test passes).** The goal prompt's anchor of "83 tools" was stale text — verified live as 88.

## Scope — the un-hardened code (shipped after the last full harden convergence, commit `34a9c52`)

- `desktop/network.ts` (+201, NEW) — iphlpapi `GetAdaptersAddresses` (IP_ADAPTER_ADDRESSES_LH linked list) +
  `GetExtendedTcpTable`/`GetExtendedUdpTable` (MIB_*ROW_OWNER_PID). Powers `list_adapters` / `list_connections`.
- `desktop/events.ts` (the +41 process-info part) — ntdll `NtQueryInformationProcess(ProcessBasicInformation)` → PEB →
  `NtReadVirtualMemory` through `RTL_USER_PROCESS_PARAMETERS` for command line + cwd (`readRemoteUnicodeString` + the
  `processInfo` additions). NOTE: lives in events.ts, not a `desktop/process.ts` (the `feat(desktop/process)` commit
  message notwithstanding).
- `desktop/power.ts` (+12) — powrprof `SetSuspendState` sleep/hibernate.
- `mcp.ts` (+51) — registrations/handlers/descriptions for the above. `index.ts` (+1) — one new export.

## Method — two rounds, both convergent

- **Round 1 — 10-lane FIND panel** (read-only, each aimed at the new surface, each carrying the prior CLEAN
  constraints so it would not re-flag decided ground): Performance, Token-Economy, AI-Digestion, Redundancy,
  Reliability, Segfault-Safety, Code-Hygiene, Ship-Footprint, Test-Integrity, Doc-Fidelity. Result: **9 CLEAN-with-
  evidence + 1 Redundancy finding** (readPackedWide dup).
- **Round 2 — 4-seat adversarial CONVERGE panel** (differently-angled, NOT a repeat): FFI-offset adversary
  (every offset + every FFI signature vs the actual `@bun-win32` binding source), completeness critic (round 1's
  structural blind spots), redundancy re-adjudicator, honesty/behavior-identical auditor (re-ran the strongest CLEAN
  claims live). Result: **all 4 CLEAN, 0 findings.**

Lead independently audited all new FFI offsets BEFORE the panel and re-verified tsc 0 / 51 tests / clean tree AFTER.

## The one finding — `readPackedWide` dup — adjudicated REPORT-ONLY (do NOT consolidate)

`readPackedWide` exists in `desktop/network.ts:53-58` (max-read **1024**) and `desktop/services.ts:38-43` (max-read
**2048**, PRIVATE, in a module that imports `Advapi32`). Not a shippable win, for three independently-verified reasons:

1. **The two copies DIFFER** (1024 vs 2048). Consolidating is not a pure dedup — it would change one call site's
   behavior in the >512-char-non-NUL-terminated corner case (not byte-identical by construction), or require adding a
   `maxBytes` parameter (signature widening).
2. **Coupling regression.** `network.ts` is — per its own file header — "the lightest of the OS-read engines"
   (Iphlpapi-only, no COM, no handles). Importing services.ts's copy creates a static module-graph dependency from the
   light network engine onto the heavy SCM engine. (Round-2 refinement: `@bun-win32` bindings are LAZY — they `dlopen`
   on first `Load()`, no module-eval Preload — so there is no *runtime* advapi32.dll load; but the static coupling
   regression holds, and `readPackedWide` is **not even exported** from services.ts.)
3. **No existing shared primitive.** `com/reads.ts` is COM-vtable-decoders only (getBstr/getLong/getDouble/…);
   promoting `readPackedWide` there is a NEW abstraction AGENTS.md forbids. Precedent `1705c3b` folded tasks.ts onto an
   already-exported byte-matching `getBstr`/`getLong` (created nothing) — not analogous. The `harden-converged` run
   already classified the identical `GetWindowTextW`/`GetClassNameW` cross-file decoder dup as REPORT-ONLY for this
   exact reason. The utf16le decode is inlined across ~15 files with 3+ distinct private signatures
   (network/services pointer+base+cap; eventlog.ts readWideZ offset+byte-scan; window/spy/events length-prefixed
   subarray) — per-site inlining is the established convention.

## Below-bar rejects (evaluated, measured, not shipped)

- **network.ts "double-read" of the TCP-state / adapter-type / adapter-status DWORD** (`TCP_STATES[x] ?? \`state-${x}\``
  etc.) — the second read only fires on the rare *unknown*-value fallback (`??` short-circuits on the common path), so
  the measured common-path impact is ~0 ns. Fails "moves a measured axis." Byte-identical but no number → not shipped.
- **events.ts `readRemoteUnicodeString` allocation** flagged as "unbounded" — it is u16-BOUNDED (`Length` is a USHORT,
  ≤ 65535 B), which is exactly right for a maximal ~32K-char Windows command line. Correct, not a defect.
- **WOW64 "degrades to ''" comment is pessimistic, not a bug** — round-2's completeness critic read both live 32-bit
  targets' command lines CORRECTLY through the PEB walk; the code never returns garbage and never crashes. The comment
  understates the code; no change warranted.

## CLEAN lanes — CONSTRAINTS (next HARDEN run can SKIP these; evidence on file)

All ten lanes are CLEAN for the new code, with the same standing constraints the prior two convergences recorded for
the old code (which remains doubly-converged and untouched here):

- **Segfault-Safety / Performance / Reliability** — every new offset/stride/size + FFI signature verified vs the actual
  `@bun-win32/{iphlpapi,ntdll,powrprof}` binding source AND live (6 adapters, 159 connections, 470 processes scanned —
  0 garbage cmdlines, max 3828 chars; loopback/IPv6/`::`-compression/WOW64/denied-pid all faithful). Handles freed in
  `finally` (snapshot @393, process @447); every NTSTATUS checked, degrades to ''/0, never throws; two-pass table
  sizing + 3-attempt retry bounded by `MAX_TABLE_BYTES` (8 MB). No `.ptr` cached across await (all reads inline at the
  synchronous call site). `network.ts` holds NO OS handles (pure buffer enumeration).
- **Token-Economy** — measured on the real wire: full-profile `tools/list` `result.tools` = **76,466 B** (88 tools);
  safe-profile = **65,425 B** (68 tools). New tool descriptions carry no cuttable filler that preserves agent meaning +
  safety semantics (spec-default `destructiveHint`/`openWorldHint` load-bearing per AI.md; "no data loss" on lock is a
  safety distinction; IPv4-only caveat is critical context).
- **AI-Digestion** — new tools' error paths name the next step / report the filter; output shapes consistent with
  sibling tools; `process_info` appends `cmd:`/`cwd:` only when non-empty (→ byte-identical for denied/protected pids)
  and routes `commandLine` through `redactSecrets`.
- **Code-Hygiene / Ship-Footprint** — 0 removable casts (Number()→Pointer / BigInt(len) are sanctioned boundary
  idioms); biome clean; the 3 new deps (iphlpapi/ntdll/powrprof) each imported by exactly one shipped file; tarball
  ~45 files, no stray artifacts; new `index.ts` export consumed.
- **Test-Integrity** — the 3 new integration tests assert real observed behavior (bound-listener-found-by-exact-pid;
  self argv+cwd from PEB; live token dance without firing shutdown), kill every spawned server in `finally`, launch no
  GUI window; slot-gate needs NO extension (network/events/power are flat APIs, no new COM vtable).
- **Doc-Fidelity** — AI.md/README enumerate the new tools + source files + exports; counts reconcile 88/68/34/20.

## CONVERGED — 2026-06-21

**0 slices shipped — the correct outcome of a HARDEN pass over already-hard code.** In one turn EVERY lane (10 finders
+ 4 adversarial convergence seats) is CLEAN-with-evidence; tsc 0, 51 unit tests green, slot-gate 145, 88 tools, tree
clean. No lane is still finding → STOP. The strict bar (ship IFF byte-identical AND moves a measured axis AND provable
live) correctly produced no speculative edits; per the binding-truth lesson, "CLEAN with evidence" is a valid and
valuable result. (No version bump / server.json / MCP-registry touched — owner releases.)
