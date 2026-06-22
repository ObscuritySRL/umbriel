HARDEN umbriel @ D:\Projects\umbriel — 95-tool native-Win MCP server. ADD NOTHING: make EXISTS faster/leaner/safer/clearer at ZERO behavior change — every tool output/public sig/policy gate BYTE-IDENTICAL. Pure TS, Bun FFI, NO build. Win32 ONLY via @bun-win32/* (NEVER hand-roll). Claude AUTHORED all→presume prior self left ns/bytes/lines/clarity/safety on table, hunt it. You=end user. ultracode.

BAR: ship IFF (1) behavior IDENTICAL (diff before/after; ANY change=bug) (2) MOVES a measured axis (ns/bytes/lines/allocs/round-trips/err-recovery) (3) proven LIVE+regression-gated. No speculative rewrite; no "cleaner" w/o a number.

SELF-IMPROVE (sharpen MACHINE not only product): wrote code AND gates→presume prior self left an axis unhardened AND machine blunter. Stronger measure/tighter gate/new slot-gate row/NEW LANE catching defect-class old lanes miss=HARDEN win (test/tool/prompt diffs byte-id→ship free). Even THIS prompt in scope. PUSH mandatory, FINDING not — sweep finding nothing converges honestly; converged=EARNED not ASSUMED; coasting=failure.

DOCS-SYNC: after ANY feature add/remove/tweak→update+SYNC all 6 to code+counts: AI.md ARTICLE.md prompts/BUILD.md prompts/HARDEN.md README.md TODO.md.

PANEL=parallel lanes, 1 ultracode expert/axis. FIRST ACTION ∀ turn: spawn ALL finders @once, HANDS-ON (read+MEASURE live+diff, never memory). LANES:
• Perf: hot-paths/allocs/redundant-vcalls+round-trips/lost-memoization/snapshot-cost.
• Token-Economy: model-paid tokens (tools/list descs+schemas, snapshot/Δ, AI.md); cut keep meaning; prove byte Δ.
• AI-Digestion: errors→next step; schemas unambiguous; smallest faithful output; CONSISTENT shapes; error-path fix OK iff happy-path identical; SUCCESS-shape=owner-call.
• Reliability: ∀ handle/SC/COM-iface/BSTR freed in finally; denied/not-found honest (NOT GetLastError); no throw escapes loop; idempotent teardown; bounded loops.
• Segfault-Safety: .ptr never cached across await; struct@call-site; offsets/strides/slots correct; no UAF; COM slots header-gated (slot-gate.test).
• Code-Hygiene: NO casts; naming; tsc strict; biome-clean.
• Dead-Code&Dup: by AI-USEFULNESS+REACHABILITY not call-count. zero-caller→ (a)USELESS→DELETE (b)USEFUL but AI-UNREACHABLE→KEEP+record-for-BUILD (c)public/SDK→KEEP. STRING-KEYED dispatch (mcp.ts HANDLERS, slot tables)=LIVE w/o import (delete BREAKS tool). DUP→fold onto EXISTING def; NO unrequested abstraction (owner prim OK). RESPECT completeness tables. Delete ONLY zero-live-ref; else record-not-delete.
• Ship-Footprint: package files[]/tarball/dep manifest (declared-unimported|undeclared-used)→Dead-Code&Dup.
• Test-Integrity: tests truly verify (not tautology); close ∀ window (dispose≠close); no flake; surface covered; slot-gate complete.
• Doc-Fidelity: AI.md/README exact+concise; "complete surface" holds; ZERO drift code/counts.

LOOP (parallel): finder→REAL win→(a) FIXER e2e (preserve behavior+LIVE+gate+commit&push 1 slice) (b) note findings/ (c) fresh same-lane finder. CLEAN-w-evidence→lane STOPS; fixer overlaps next finder.

RESOLUTION: COMPLETE iff in ONE turn EVERY lane CLEAN-w-evidence AND tsc0 AND tests green→STOP. Else self-loop; NEVER stop while ANY lane finds. Convergence w/o a fix valid.

FFI fix: wrong COM slot/offset SEGFAULTS under Bun/JSC→re-verify LIVE+extend slot-gate.test. bun test broken for FFI→prove via example/*.integration.test.ts on REAL apps, CLOSE ∀ window.

LAW (AGENTS.md): surgical diffs; NO casts ever (fix types); cast-free com.ts vcall; .ptr inline; struct@call-site; tsc0 ∀ change; AI.md generic. ABSOLUTE: NO new tools/capability — hardening ONLY. SHIP=commit&push ∀ slice (Conventional Commits 1/win); NO publish/server.json (owner releases). findings/ current (CLEAN lane=CONSTRAINT→next run skips).

ANCHOR (re-verify HEAD): 95 gated tools (readonly|safe|full), tsc0, 90 unit tests green. FIRST ACTION: spawn ALL finders NOW.
