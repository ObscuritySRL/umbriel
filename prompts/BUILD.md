BUILD/PERFECT umbriel @ D:\Projects\umbriel — AI substrate to SEE+DRIVE native Windows at human-transcendence: act on LOCKED/OFFSCREEN/never-painted controls; SET values directly not keystrokes; BG-default + FG first-class both ways. Pure TS, Bun FFI, NO build. Win32 via @bun-win32/*; a binding it LACKS may be hand-rolled (last resort)→FLAG in TODO.md, NEVER silently. You=end user. ultracode.

DEPTH OF CONTROL (bar): AI SEES anything (RAM/CPU/registry/locks/time-zone/power/displays/processes/services/tasks/env/logs) + DOES anything a human can (drive ANY app to ANY end — Paint, Quick Settings, volume), BG-default, focus-free where the API allows — via GENERAL composable primitives NEVER bespoke tools (compose set_value/invoke/toggle/set_range/drag/snapshot/registry_get). NEVER ship set_volume/toggle_wifi/get_timezone when a primitive enables it. Only a cap NO primitive reaches is a candidate; close GENERALLY, gated+benchmarked.

PASS = BOTH HARDEN (faster/leaner/safer/clearer, BYTE-IDENTICAL) AND research+ship NET-BENEFIT capability. NEITHER mandatory — only-harden or only-decline-with-reasons = SUCCESS. NEVER invent to fill; a feature ships only if it earns its keep.

NO-SHELL: do ANYTHING via umbriel's OWN tools, NEVER PowerShell/cmd/CLI — a shell-reach=a GAP to close natively. BENCHMARK LAW: bench EVERY new tool/impl vs alternatives (FFI vs Bun-native vs composing tools) by measured perf+simplicity+safety; record bench+loser in findings/. no-shell=law; bun-win32-always=NOT.

TWO PANELS. FIRST ACTION EVERY TURN: spawn ALL finders AT ONCE, 1 ultracode named-expert/seat. HANDS-ON never memory: PROBE live apps, READ primary sources (MS Learn/headers/@bun-win32), STUDY+EXCEED rivals (FlaUI/Playwright/Windows-MCP/AHK). Return CLEAN-w-evidence OR a ranked list, each proven.
A — HARDEN (audit EXISTS, presume fault): Perf/allocs/FFI-hot-paths · Token-Economy · Dead-Code/Dup (unused·unusable·dup, reachability-proven, string-keyed-dispatch-aware — judge by AI-usefulness+reachability not call-count: useless→delete; useful-but-AI-unreachable→hand to Panel B to EXPOSE as a GENERAL tool NEVER delete; public/SDK API→keep) · Reliability/leaks · Segfault-Safety · BG+FG-Parity · Security/Policy · AI-Digestion · Doc-Fidelity · Code-Hygiene · Fabrication-Verify. WIN=BYTE-IDENTICAL + a measured axis (ns/bytes/allocs/lines) + minimal diff.
B — CAPABILITY (hunt MISSING + EXCEED the possible): explore BOLDLY beyond rivals; prototype, SEE what sticks; try-and-fail>don't-try (a failed experiment=DATA — prove LIVE or record the wall). SHIP only if a real JOB — kills a shell-reach, unblocks an impossible/clunky/slow task, batches a multi-call flow, or a concrete ask. NO vanity. Each shipped: BG+FG, gated, benchmarked, GENERAL.

LOOP (parallel): a REAL win→(a) FIXER end-to-end (prove LIVE+gate+ADD a test+commit&push 1 slice) (b) note findings/ (c) fresh finder briefed to SKIP claimed+declined. Fixer overlaps next finder. CLEAN-w-evidence→lane STOPS; don't re-review own fixes.

RESOLUTION: COMPLETE only when in ONE turn EVERY lane (both panels) CLEAN-w-evidence AND tsc0+tests green→STOP; else self-loop, NEVER stop while ANY lane finds. Only a REAL finding blocks; convergence WITHOUT invention valid+expected.

VERIFY LIVE: wrong COM slot SEGFAULTS→prove each slot live+extend slot-gate.test. bun test broken for FFI→prove via example/*.integration.test.ts on REAL apps; CLOSE every window (dispose≠close).

LAW (AGENTS.md): surgical diffs; NO casts (fix types); cast-free com.ts vcall; .ptr inline; struct at call site; tsc0 every change; AI.md generic. SHIP=commit&push every slice (Conventional Commits 1/win); NO publish/server.json (owner releases). findings/ current — re-confirm dead-ends/declined STILL walls.

ANCHOR: ~88 gated MCP tools (UMBRIEL_PROFILE readonly|safe|full). FIRST ACTION: spawn ALL finders NOW.
