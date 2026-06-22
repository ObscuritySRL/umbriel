HARDEN umbriel @ D:\Projects\umbriel — 99-tool native-Win MCP server. ADD NOTHING: make EXISTS faster/leaner/safer/clearer at ZERO behavior change — every tool output/public sig/policy gate BYTE-IDENTICAL. Pure TS, Bun FFI, NO build. Win32 ONLY via @bun-win32/* (NEVER hand-roll). Claude AUTHORED all→presume prior self left ns/bytes/lines/clarity/safety on table. You=end user. Fable5+ultracode.

BAR: ship IFF (1) behavior IDENTICAL (diff before/after; ANY change=bug) (2) MOVES a measured axis (ns/bytes/lines/allocs/round-trips/err-recovery) (3) proven LIVE+regression-gated. No speculative rewrite; no "cleaner" w/o a number. BYTE-ID=default NOT design-proof: beatable shape→Design-Doubt lane, never polish worse.

SELF-IMPROVE (sharpen MACHINE not only product): wrote code+gates→presume an axis unhardened AND machine blunter. Stronger measure/gate/slot-gate row/NEW LANE catching a defect-class old lanes miss=HARDEN win (byte-id diffs ship free). Even THIS prompt in scope. PUSH mandatory, FINDING not — sweep finding nothing converges honestly; converged=EARNED not ASSUMED; coasting=failure.

DOCS-SYNC: after ANY feature add/remove/tweak→update+SYNC all 6 to code+counts: AI.md ARTICLE.md prompts/BUILD.md prompts/HARDEN.md README.md TODO.md.

PANEL=parallel lanes, 1 ultracode expert/axis. FIRST ACTION ∀ turn: spawn ALL finders @once, HANDS-ON (read+MEASURE live+diff, never memory). LANES:
• Perf: hot-paths/allocs/redundant-vcalls+round-trips/lost-memoization/snapshot-cost.
• Token-Economy: model-paid tokens (tools/list descs+schemas, snapshot/Δ, AI.md); cut keep meaning; prove byte Δ.
• AI-Digestion: errors→next step; schemas unambiguous; smallest faithful output; CONSISTENT shapes; error-path fix OK iff happy-path identical.
• Design-Doubt (record-only): tool's APPROACH itself beatable (output/default/contract)? shape=HYPOTHESIS not proof-of-right → record-for-BUILD/owner; NEVER implement (byte-id rules lane). DOUBT mandatory.
• Reliability: ∀ handle/SC/COM-iface/BSTR freed in finally; denied/not-found honest (NOT GetLastError); no throw escapes loop; idempotent teardown; bounded loops.
• Segfault-Safety: .ptr never cached across await; struct@call-site; offsets/strides/slots correct; no UAF; COM slots header-gated (slot-gate.test); a wrong slot/offset SEGFAULTS→prove LIVE via example/*.integration.test.ts (bun test broke for FFI), CLOSE ∀ window.
• Code-Hygiene: NO casts; naming; tsc strict; biome-clean.
• Dead-Code&Dup: by AI-USEFULNESS+REACHABILITY not call-count. zero-caller→ (a)USELESS→DELETE (b)USEFUL but AI-UNREACHABLE→KEEP+record-for-BUILD (c)public/SDK→KEEP. STRING-KEYED dispatch (HANDLERS/slot tables)=LIVE w/o import (delete BREAKS tool). DUP→fold onto EXISTING def; NO unrequested abstraction; RESPECT completeness tables; delete ONLY zero-live-ref else record.
• Ship-Footprint: files[]/tarball/deps (declared-unimported|undeclared-used)→Dead-Code&Dup.
• Test-Integrity: tests truly verify (not tautology); close ∀ window (dispose≠close); no flake; surface covered; slot-gate complete.
• Doc-Fidelity: AI.md/README exact+concise; "complete surface" holds; ZERO drift code/counts.

LOOP (parallel): finder→REAL win→(a) FIXER e2e (preserve behavior+LIVE+gate+commit&push 1 slice) (b) note findings/ (c) fresh same-lane finder. CLEAN-w-evidence→lane STOPS; fixer overlaps next finder.

RESOLUTION: COMPLETE iff in ONE turn EVERY lane CLEAN-w-evidence AND tsc0 AND tests green→STOP. Else self-loop; NEVER stop while ANY lane finds. Convergence w/o a fix valid.

LAW (AGENTS.md): surgical diffs; NO casts ever (fix types); cast-free com.ts vcall; .ptr inline; struct@call-site; tsc0 ∀ change; AI.md generic. ABSOLUTE: NO new tools/capability — hardening ONLY. SHIP=commit&push ∀ slice (Conventional Commits 1/win); NO publish/server.json (owner releases). findings/ current (CLEAN lane=CONSTRAINT→next run skips).

ANCHOR (re-verify HEAD): 99 gated tools (readonly|safe|full), tsc0, 102 unit tests green. FIRST ACTION: spawn ALL finders NOW.
