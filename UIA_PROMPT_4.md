RELENTLESSLY PERFECT @bun-win32/uia (alias bun-uia) at D:\Projects\bun-win32 — an AI's substrate to DRIVE NATIVE WINDOWS by every means — UIA tree, a11y/oleacc, pixels/WGC/OCR, window+process state, win-event hooks, clipboard, message/pattern acting — cursor-free, offscreen, BACKGROUND by default. Pure TS, Bun FFI, NO build steps. YOU ARE THE END USER — millions of Claude instances drive Windows with this. Run as Opus 4.8 + ultracode (multi-agent Workflow) all session.

BAR = HUMAN-TRANSCENDENCE: no-foreground, locked, occluded, offscreen, virtualized is the DEFAULT, not the fallback. PARITY LAW: everything foregroundable MUST work backgrounded — no BG path? INVENT one and PROVE it, or document the OS wall (UIPI / secure-desktop / foreground-lock).

THIS GOAL IS CRITIC-DRIVEN. FIRST ACTION EVERY TURN: spawn the TEN-SEAT CRITIC PANEL — one ultracode agent PER seat, NEVER generic, each cast as a NAMED EXPERT in its field:
1 Perf · 2 Agent-Ergonomics · 3 Background-Parity · 4 Segfault-Safety · 5 Security/Policy · 6 Scenario-Coverage · 7 Doc-Fidelity · 8 Fabrication/Adversarial-Verify · 9 Competitive-Parity · 10 Code-Hygiene.
Each critic MUST RESEARCH HANDS-ON, NEVER from memory: (a) PROBE THE LIVE SYSTEM — drive real, diverse apps (Win32/WinUI/UWP/WPF/Electron/Java/Qt/Office/terminals/UAC/games/RDP); see what fails, is slow, needs focus, or is unsafe; (b) READ PRIMARY SOURCES — MS Learn, SDK headers, dumpbin; (c) STUDY + EXCEED RIVALS — nut.js, FlaUI, WinAppDriver, Playwright, Windows-MCP, AHK; (d) SELF-CRITIQUE — what can an AI still NOT do here reliably / securely / without focus, and what is slow, bloated, unsafe, undocumented, or unproven? Be RELENTLESS — presume fault until proven. Each critic returns EITHER "clean — nothing to improve" WITH the evidence it checked, OR a ranked list of concrete criticisms, each with a proof.

RESOLUTION — accomplished IF AND ONLY IF, this turn, ALL TEN critics returned ZERO criticisms AND ZERO room for improvement. If even one critic raised anything, the goal is NOT met.

ON ANY CRITICISM: for the flagged seats, spawn Opus 4.8 ultracode agents IN PARALLEL — one cast as an EXPERT in each seat's field — to RESOLVE every criticism end-to-end: build the fix, prove it LIVE, where applicable CREATE A TEST that verifies it, then COMMIT and PUSH to main. NEVER STOP, halt, or ask permission — the ONLY terminal state is goal completion; the /goal self-loops. Do NOT re-critique the fixes this turn — unlike prior prompts, you fix + push and yield; the NEXT iteration's panel re-catches anything left.

VERIFY LIVE (Bun=JSC, measure don't assume): a wrong COM vtable slot SEGFAULTS — prove every slot LIVE, extend slot-gate.test.ts (the only --all gate; audit/nullcheck skip uia). bun test is broken repo-wide for FFI — prove via example/*.integration.test.ts that drive REAL apps and CLOSE every window (dispose != close — the user gets flooded). Perf = Bun.nanoseconds before/after + identical output + a regression gate; name which of 3 (isolated / in-proc / live cross-proc). SEE rendered output for visual claims.

AGENTS.md IS LAW — obey exactly: surgical diffs, no premature abstraction, NO casts ever (fix the types), alphabetize, #private, hex offsets, cast-free com.ts vcall, read .ptr inline, assemble structs right before the FFI call, separate nullability audit, tsc 0 after every change, Bun-native APIs, AI.md stays generic.

SHIP = COMMIT + PUSH every change: per AGENTS.md Conventional Commits, commit + push to main after each fix; fixers push in parallel (one commit per slice). Do NOT version-bump, npm-publish, or touch the MCP registry / server.json — the owner releases later. Add new modules to package.json files[]; keep findings/ current.

ANCHOR (STALE — RE-VERIFY before trusting): ~54 policy-gated MCP tools (BUN_UIA_PROFILE readonly|safe|full). findings/ holds dead-ends — each a CONSTRAINT, not a cure; re-confirm STILL a wall. Do NOT author a successor prompt.

FIRST ACTION: spawn the panel NOW.
