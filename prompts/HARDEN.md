HARDEN umbriel @ D:\Projects\umbriel — 88-tool native-Win MCP server. ADD NOTHING: make EXISTS faster/leaner/safer/clearer at ZERO behavior change — every tool output/public sig/policy gate BYTE-IDENTICAL (prove by diff). Pure TS, Bun FFI, NO build. Win32 ONLY via @bun-win32/* (never hand-roll). You=end user. ultracode.

BAR: ship IFF (1) behavior IDENTICAL (diff out before/after; ANY change=bug) (2) MOVES a measured axis (ns/bytes/lines/allocs/round-trips/err-recovery) (3) proven LIVE + regression-gated. No speculative rewrite; no "cleaner" w/o a number; smallest diff.

PANEL=parallel lanes, 1 ultracode expert/axis. FIRST ACTION EVERY TURN: spawn ALL finders AT ONCE, HANDS-ON (read+MEASURE live+diff, never memory). LANES:
• Perf: FFI hot paths, per-call allocs, redundant vcalls/round-trips, lost memoization, struct-assembly/snapshot cost.
• Token-Economy: model-paid tokens — tools/list descs+schemas, observation/snapshot/Δ, AI.md. Cut tokens keep meaning; prove byte Δ.
• AI-Digestion: errors name next step; schemas unambiguous; smallest faithful output; shapes CONSISTENT. error-PATH fix OK if happy-path identical; SUCCESS-shape=owner-call.
• Reliability: every OpenProcess/SC/handle/COM-iface/BSTR freed in finally; denied/not-found honest (NOT GetLastError); no throw escapes loop; idempotent teardown; bounded loops.
• Segfault-Safety: .ptr never cached across await; struct at call site; offsets/strides/slots correct; no UAF; COM slots header-gated (slot-gate.test).
• Code-Hygiene: NO casts (fix types); naming; tsc strict; biome-clean.
• Dead-Code&Dup: judge by AI-USEFULNESS+REACHABILITY not call-count. Each zero-caller sym→ (a) USELESS→DELETE; (b) USEFUL but AI-UNREACHABLE (cap not wired as tool / library-only export)→KEEP+record for BUILD; (c) public/SDK API→KEEP. UNUSED=export-no-importer|internal sym never ref'd|unused param/import/var|code after return. UNUSABLE=handler-no-tool|tool unreachable every profile|slot/const never dispatched|env never read|file unimported. DUP=logic copied across files→fold onto EXISTING/sanctioned shared def; NEVER premature/unrequested abstraction (owner-requested primitive=OK). Account for STRING-KEYED dispatch (mcp.ts HANDLERS, slot tables)=LIVE w/o direct import (delete BREAKS a tool). RESPECT deliberate completeness tables. Delete ONLY (a) (zero live refs incl transitive); fold dups; (b)=record-not-delete.
• Ship-Footprint: package files[], tarball, dep manifest (declared-unimported/undeclared-used). reachability+dup→Dead-Code&Dup.
• Test-Integrity: tests truly verify (not tautology); close every window (dispose≠close); no flake; surface covered; slot-gate complete.
• Doc-Fidelity: AI.md/README exact+concise; "complete surface" holds; ZERO drift from code/counts.

LOOP (parallel): finder→REAL win→(a) FIXER end-to-end (preserve behavior+LIVE+gate+commit&push 1 slice) (b) note findings/ (c) fresh same-lane finder. CLEAN-w-evidence→lane STOPS. find→fix→find ordered; fixer overlaps next finder.

RESOLUTION: COMPLETE iff in ONE turn EVERY lane CLEAN-w-evidence AND tsc0 AND tests green→STOP. Else self-loop; NEVER stop while ANY lane finds. Convergence w/o a fix is valid.

FFI fix: wrong COM slot/offset SEGFAULTS under Bun=JSC→re-verify LIVE + extend slot-gate.test. bun test broken for FFI→prove via example/*.integration.test.ts on REAL apps, CLOSE every window.

LAW (AGENTS.md): surgical diffs; NO casts ever (fix types); cast-free com.ts vcall; .ptr inline; struct at call site; tsc0 every change; AI.md generic. ABSOLUTE: NO new tools/capability — hardening ONLY. SHIP=commit&push every slice (Conventional Commits 1/win); NO publish/server.json (owner releases). findings/ current (CLEAN lane=CONSTRAINT→next run skips).

ANCHOR (re-verify HEAD: git rev-parse --short HEAD): 88 gated tools (readonly|safe|full), tsc0, 51 unit tests green. FIRST ACTION: spawn ALL finders NOW.
