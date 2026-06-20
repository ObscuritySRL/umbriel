HARDEN+OPTIMIZE umbriel @ D:\Projects\umbriel — 83-tool native-Windows AI substrate + stdio MCP server. ADD NOTHING. Make what EXISTS faster/leaner/clearer/safer at ZERO external-behavior change: every tool output, public signature, policy gate stays BYTE-IDENTICAL (prove via diff). Pure TS, Bun FFI, NO build. Win32 ONLY via @bun-win32/* (never hand-roll). YOU ARE END USER. ultracode.

BAR: ship a change IFF (1) behavior IDENTICAL — diff touched tool/fn output before vs after (ANY change = bug, not optimization); (2) it MOVES a measured axis (ns / bytes·tokens / lines / allocs / round-trips / error-recoverability); (3) proven LIVE + regression-gated. No speculative rewrites; no "cleaner" w/o a number; smallest diff that moves the metric.

PANEL = PARALLEL LANES, 1 named ultracode expert/seat per axis. FIRST ACTION EVERY TURN: spawn ALL lane finders AT ONCE. Each HANDS-ON (read code, MEASURE live, diff), never memory:
- Performance: FFI hot paths, per-call allocs, redundant vcalls/round-trips, lost memoization, struct-assembly + snapshot/diff/observation cost. ns±, identical out, perf gate.
- Token-Economy: MODEL-paid tokens/session — tools/list payload (descriptions+schemas), observation/snapshot/Δ size, AI.md. Cut tokens, keep meaning; prove byte delta.
- AI-Digestion: AI legibility — errors name next step, schemas unambiguous, smallest faithful output, shapes CONSISTENT across tools.
- Redundancy: dup logic (desktop/* repeat buffer-alloc/two-pass-sizing/BSTR/handle-free; examples re-impl the stdio-connect harness). Consolidate ONLY real dup, never premature abstraction.
- Reliability: error+leak paths — every OpenProcess/SC/handle/COM-iface/BSTR freed in finally, denied/not-found honest, no-throw across the loop, idempotent teardown, bounded loops.
- Segfault-Safety: FFI safety — .ptr never cached across await, structs at call site, offsets/strides/slots correct, no UAF, COM slots header-gated.
- Code-Hygiene: types (NO casts—fix types), naming, dead code/exports, tsc strict, biome-clean.
- Ship-Footprint: what SHIPS — package files[], dep surface, dead re-exports, shipped-but-unused.
- Test-Integrity: tests that TRULY verify (not tautological), close every window (dispose≠close), no flake, surface covered, slot-gate complete.
- Doc-Fidelity: AI.md/README EXACT+concise, "complete surface" holds, ZERO drift from code/counts.

PER-LANE LOOP (self-perpetuating, CONVERGENT): lanes independent + parallel. Finder finds a REAL proven win → (a) spawn FIXER end-to-end (preserve behavior, prove live, gate, commit+push 1 slice), (b) NOTE in findings/, (c) spawn FRESH same-lane finder to keep hunting. Finder returns "CLEAN — nothing left, WITH evidence" → that lane STOPS (no respawn this run). Only find→fix→find within a lane is ordered; fixer may overlap the next finder.

RESOLUTION (REACHABLE — hardening converges): COMPLETE when in ONE turn EVERY lane returns CLEAN-w/-evidence AND tsc 0 AND all tests green → STOP. Else self-loop; NEVER stop while ANY lane still finds.

ON EVERY FIX: behavior IDENTICAL (diff), LIVE (Bun=JSC; wrong COM slot/FFI offset SEGFAULTS — re-verify live + extend slot-gate.test.ts), MEASURED (axis + number + isolated/in-proc/live-cross-proc). bun test broken for FFI → prove via example/*.integration.test.ts driving REAL apps that CLOSE every window.

AGENTS.md IS LAW: surgical diffs, NO casts ever (fix types), cast-free com.ts vcall, read .ptr inline, assemble structs at call site, tsc 0 after every change, AI.md generic. ABSOLUTE: NO new tools/capability/behavior — hardening ONLY.

SHIP = COMMIT+PUSH every slice (Conventional Commits), fixers parallel, 1 commit/win. NO version-bump/publish/server.json/MCP-registry — owner releases. findings/ current (CLEAN lane = CONSTRAINT, record so next run skips).

ANCHOR (RE-VERIFY): 83 gated tools (readonly|safe|full), tsc 0, 48 unit tests green (re-verify HEAD via `git rev-parse --short HEAD`). No successor prompt. FIRST ACTION: spawn ALL finders NOW.
