RELENTLESSLY PERFECT umbriel @ D:\Projects\umbriel — AI substrate to DRIVE NATIVE WINDOWS by EVERY means at HUMAN-TRANSCENDENCE: act on LOCKED/OFFSCREEN/never-painted controls, SET values directly not keystrokes, BG-default + FG first-class BOTH ways. Pure TS, Bun FFI, NO build. Win32 via @bun-win32/* (D:\Projects\bun-win32); a binding it LACKS may be hand-rolled (last resort) → FLAG in TODO.md for the owner to wrap, NEVER silently. YOU ARE THE END USER. ultracode.

THIS PASS = BOTH: HARDEN what exists (faster/leaner/safer/clearer, behavior BYTE-IDENTICAL) AND research+ship NET-BENEFIT features. NEITHER mandatory — only-harden, or only-decline-w/-reasons, = SUCCESS. NEVER invent to fill the pass; a feature ships only if it earns its keep.

NO-SHELL: do ANYTHING via umbriel's OWN tools, NEVER PowerShell/cmd/CLI — a shell-reach = a GAP to close natively. BENCHMARK LAW: bench EVERY new tool/impl vs its REAL alternatives BEFORE ship (@bun-win32 FFI vs Bun-native vs composing existing tools), pick by MEASURED perf+simplicity+safety, record bench+loser in findings/. e.g. FS: CopyFileW-FFI vs node:fs → Bun won (simpler+safer, speed tie). no-shell is law; bun-win32-always is NOT.

TWO PANELS. FIRST ACTION EVERY TURN: spawn ALL finders AT ONCE, 1 ultracode NAMED-EXPERT/seat. HANDS-ON, NEVER memory: PROBE live apps, READ primary sources (MS Learn/headers/@bun-win32), STUDY+EXCEED rivals (FlaUI/Playwright/Windows-MCP/AHK/nut.js). Return CLEAN-with-evidence OR a ranked list, each proven.
A — HARDEN (audit EXISTS, presume fault): Perf/allocs/FFI-hot-paths · Token-Economy · Redundancy · Reliability/leaks · Segfault-Safety · BG+FG-Parity · Security/Policy · AI-Digestion · Doc-Fidelity · Code-Hygiene · Fabrication-Verify. WIN = behavior BYTE-IDENTICAL + a MEASURED axis (ns/bytes/allocs/lines) + minimal diff.
B — CAPABILITY (hunt MISSING + EXCEED the possible): explore BOLDLY — ambitious BEYOND rivals+current code; prototype, SEE what sticks; try-and-fail > don't-try (a failed experiment is DATA — prove it LIVE or record the wall in findings/). SHIP selectively: only if it does a real JOB for the AI — kills a shell-reach, unblocks an impossible/clunky/slow task, batches a multi-call flow (fewer round-trips/tokens), or a concrete dev/user ask. NO vanity/completeness ships. Justify by work ENABLED; none clears the bar ⇒ CLEAN. Each shipped: BG+FG, policy-gated, benchmarked.

PER-LANE LOOP (self-perpetuating, CONVERGENT), lanes parallel+independent: a finder finds a REAL win → (a) spawn a FIXER end-to-end (build/optimize, prove LIVE, gate, ADD a test, commit+push 1 slice), (b) note in findings/, (c) spawn a FRESH-context finder, briefed to SKIP already-claimed+declined, to keep hunting the lane (fresh eyes > stale). Fixer overlaps next finder. A finder returning CLEAN-with-evidence STOPS that lane. Don't re-review own fixes — next finder re-catches.

RESOLUTION — COMPLETE only when in ONE turn EVERY lane (both panels) is CLEAN-with-evidence AND tsc 0 + tests green → STOP; else self-loop, NEVER stop while ANY lane finds. Only a REAL finding blocks; "could add X" does NOT — convergence WITHOUT invention is valid+expected.

VERIFY LIVE: a wrong COM slot SEGFAULTS — prove each slot live + extend slot-gate.test.ts. bun test broken for FFI — prove via example/*.integration.test.ts driving REAL apps that CLOSE every window (dispose≠close).

AGENTS.md IS LAW: surgical diffs, NO casts (fix types), cast-free com.ts vcall, .ptr inline, struct at call site, tsc 0 every change, AI.md generic.

SHIP = COMMIT+PUSH every slice (Conventional Commits, 1/win). NO version-bump/publish/server.json — owner releases. Add modules to package.json files[]; findings/ current (dead-ends + declined features = CONSTRAINTS — re-confirm STILL a wall / still not worth it).

ANCHOR (RE-VERIFY): ~83 policy-gated MCP tools (UMBRIEL_PROFILE readonly|safe|full). No successor prompt. FIRST ACTION: spawn ALL finders NOW.
