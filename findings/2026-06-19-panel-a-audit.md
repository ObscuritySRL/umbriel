# Panel A (critic) audit + resolution — 2026-06-19

After shipping 12 ease-improvements across three Panel-B hunts, ran the CRITIC panel for the first time this session:
10 named seats audited the EXISTING code (presume fault), weighted to the session's own just-shipped changes, each
finding then adversarially verified by an independent skeptic defaulting to REFUTED. 3 seats clean (perf,
SEGFAULT-SAFETY, fabrication-verify — the FFI is memory-safe and the shipped claims reproduce). 18 findings
CONFIRMED, 1 REFUTED. Most were bugs in MY OWN session code — exactly why the critic pass was overdue. ALL fixed
end-to-end (live-verified + tested + committed) except the one owner-reserved item.

## Fixed (live-verified, pushed)

- **HIGH — waitForProcessGone falsely reported "gone" for an elevated/protected process** (e3c1111). From a
  medium-integrity host, OpenProcess(SYNCHRONIZE) on an elevated installer (the headline use case) returns
  ACCESS_DENIED, and the handle approach treated "can't open" as "exited" (151/447 procs were access-denied in the
  probe). Also hung forever on a "bun" self-needle and missed respawns. Rewrote to poll listProcesses (toolhelp sees
  every integrity level) excluding the host pid — fixes all four + makes the description/message accurate. Regression
  test: a running lsass.exe times out, not falsely resolves.
- **HIGH — wait_for {ref,state} false-positive on a torn-down control** (c6d6948). A same-generation ref to a control
  destroyed IN-PROCESS read swallowed 0/'' defaults, so {enabled:false}/{value:''} resolved instantly with a false
  "reached". Added a CHECKED liveness probe (get_CurrentControlType, slot 21) so it throws "no longer exists". Also
  stripped the internal timeout knob from the echoed expectation. Verified by destroying a child BUTTON mid-flight.
- read_table {startRow >= totalRows} printed an inverted "rows 51–50 of 50" footer (6fddd72) → clear "past the last
  row" message.
- copy_files {paths:[""]} staged a zero-file HDROP yet reported success (6fddd72) → blank paths filtered.
- copy_files move-effect staging failure was swallowed and still returned true (6fddd72) → returns false.
- AI.md doc drift ×5 — readTable startRow, writeClipboardFiles move, waitForProcessGone, waitForOwnState, ownerWindow
  (cb73c8d) → synced.

## Refuted (correctly NOT actioned)

- "copy_files {move} is an irreversible deletion primitive bypassing the fs/os gate." The security verifier rebutted:
  copy_files only SETS the clipboard ("does not access the files or paste") — a real move needs a SUBSEQUENT GUI paste,
  exactly the cursor-free desktop control the `safe` profile is defined to grant; and `press_key Delete` at a focused
  Explorer already gives strictly greater destructive power. Gating it behind fs/os would close a smaller hole than
  press_key leaves open. The move effect is disclosed and the tool carries destructiveHint.

## Owner-reserved (flagged, NOT fixed)

- **mcp.ts:123 SERVER_INFO.version = '1.9.0'** drifted from package.json/server.json **1.9.3** — so the live MCP
  initialize reply reports the wrong version and `bun run scripts/release-check.ts` FAILS (blocking publish). Version
  bumps are the owner's per the goal — FLAGGING ONLY. One-line fix the owner should make: set SERVER_INFO.version to
  '1.9.3'.

## Capabilities added this cycle

- **system_status** (read) — owner-requested machine-state tool: lock/secure desktop, screensaver, RDP, battery,
  monitor count, foreground — so an agent checks readiness before trusting a read (directly mitigating the
  display-off/locked-desktop false-negative the owner raised).
- **hover** (input) — Panel-B's one confirmed competitive gap (Playwright/nut.js/FlaUI/Windows-MCP all expose a
  move/hover). Reuses moveTo; refused under UMBRIEL_CURSOR=never.

Tool count 61→63 (safe 55→57, readonly 22→23), synced across the tool-count test + README + AI.md.
