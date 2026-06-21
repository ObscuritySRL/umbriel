RELENTLESSLY PERFECT umbriel @ D:\Projects\umbriel — the AI substrate to SEE and DRIVE native Windows at HUMAN-TRANSCENDENCE: act on LOCKED/OFFSCREEN/never-painted controls, SET values directly not keystrokes, BG-default + FG first-class BOTH ways. Pure TS, Bun FFI, NO build. Win32 via @bun-win32/*; a binding it LACKS may be hand-rolled (last resort) → FLAG in TODO.md, NEVER silently. YOU ARE THE END USER.

DEPTH OF CONTROL (the bar): an AI on umbriel SEES anything — RAM, CPU, registry, locks, time/zone, power, displays, processes, services, tasks, env, logs — EVERYTHING — and DOES anything a human can: drives ANY app to ANY end (open Paint and draw, work Quick Settings, set volume), background-default, focus-free where the API allows. But via GENERAL composable primitives, NEVER bespoke tools: a future AI composes set_value/invoke/toggle/set_range/drag/snapshot/registry_get. NEVER ship set_volume/toggle_wifi/get_timezone when a primitive already enables it — efficient, not bloated. Only a capability NO primitive reaches is a candidate; close it GENERALLY, gated + benchmarked.

THIS PASS = BOTH HARDEN (faster/leaner/safer/clearer, BYTE-IDENTICAL) AND research+ship NET-BENEFIT capability. NEITHER mandatory — only-harden or only-decline-with-reasons = SUCCESS. NEVER invent to fill the pass; a feature ships only if it earns its keep.

NO-SHELL: do ANYTHING via umbriel's OWN tools, NEVER PowerShell/cmd/CLI — a shell-reach = a GAP to close natively. BENCHMARK LAW: bench EVERY new tool/impl vs its alternatives (FFI vs Bun-native vs composing tools) by MEASURED perf+simplicity+safety, record bench+loser in findings/. no-shell is law; bun-win32-always is NOT.

TWO PANELS. FIRST ACTION EVERY TURN: spawn ALL finders AT ONCE, 1 ultracode NAMED-EXPERT/seat. HANDS-ON, NEVER memory: PROBE live apps, READ primary sources (MS Learn/headers/@bun-win32), STUDY+EXCEED rivals (FlaUI/Playwright/Windows-MCP/AHK). Return CLEAN-with-evidence OR a ranked list, each proven.
A — HARDEN (audit EXISTS, presume fault): Perf/allocs/FFI-hot-paths · Token-Economy · Dead-Code/Dup (unused·unusable·duplicate, reachability-proven, string-keyed-dispatch-aware — JUDGE BY AI-USEFULNESS+REACHABILITY not call-count: genuinely-useless→delete; USEFUL-but-AI-unreachable→hand to Panel B to EXPOSE as a GENERAL tool, NEVER delete; public/SDK API→keep) · Reliability/leaks · Segfault-Safety · BG+FG-Parity · Security/Policy · AI-Digestion · Doc-Fidelity · Code-Hygiene · Fabrication-Verify. WIN = BYTE-IDENTICAL behavior + a MEASURED axis (ns/bytes/allocs/lines) + minimal diff.
B — CAPABILITY (hunt MISSING + EXCEED the possible): explore BOLDLY beyond rivals; prototype, SEE what sticks; try-and-fail > don't-try (a failed experiment is DATA — prove LIVE or record the wall). SHIP only if it does a real JOB — kills a shell-reach, unblocks an impossible/clunky/slow task, batches a multi-call flow, or a concrete ask. NO vanity. Each shipped: BG+FG, gated, benchmarked, GENERAL.

PER-LANE LOOP (self-perpetuating; lanes independent): a REAL win → (a) a FIXER end-to-end (prove LIVE, gate, ADD a test, commit+push 1 slice), (b) note in findings/, (c) a FRESH-context finder briefed to SKIP claimed+declined. Fixer overlaps next finder. A CLEAN-with-evidence finder STOPS that lane; don't re-review own fixes.

RESOLUTION: COMPLETE only when in ONE turn EVERY lane (both panels) is CLEAN-with-evidence AND tsc 0 + tests green → STOP; else self-loop, NEVER stop while ANY lane finds. Only a REAL finding blocks; convergence WITHOUT invention is valid+expected.

VERIFY LIVE: a wrong COM slot SEGFAULTS — prove each slot live + extend slot-gate.test.ts. bun test broken for FFI — prove via example/*.integration.test.ts on REAL apps; CLOSE every window (dispose≠close).

AGENTS.md IS LAW: surgical diffs, NO casts (fix types), cast-free com.ts vcall, .ptr inline, struct at call site, tsc 0 every change, AI.md generic.

SHIP = COMMIT+PUSH every slice (Conventional Commits, 1/win). NO version-bump/publish/server.json — owner releases. findings/ current — re-confirm dead-ends/declined STILL walls.

ANCHOR: ~88 policy-gated MCP tools (UMBRIEL_PROFILE readonly|safe|full). FIRST ACTION: spawn ALL finders NOW.
