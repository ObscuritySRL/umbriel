# BUILD final batch — C7/C8 shipped, queue resolved — 2026-06-21

Closes the queue from `2026-06-21-build-continuation-c3.md`. A focused 2-seat huddle (C7 + C8) confirmed both as REAL
jobs (no declines), then both shipped. End: HEAD `5d5db97`, tsc 0, **82 unit tests**, **95 tools**, tree clean, pushed.

## SHIPPED
- **`1daeca6` feat(find_and_act,reveal): thread select mode (add/remove) through the shared act() engine (C8)** —
  act() hardwired element.select() (replace), so the selector-driven one-call verbs could only replace-select; adding a
  selector-found item to the selection or deselecting one of several needed a snapshot + per-item select{ref,mode}.
  Added a 5th optional mode (default replace) to act(), its select branch now dispatching add/remove/replace
  line-for-line the dedicated select handler (same labels, disclosingPatternAct + SELECT_STEAL_NOTE, patternAction
  steer). find_and_act + reveal pass the normalized mode; grid_cell stays 3-arg → replace → byte-identical. No new
  tool/FFI/count. Underlying cursor-free behavior is the path already proven in multi-select.integration.test (re-run
  green on a real Explorer list); test/select-mode-wiring.test pins the threading.
- **`5d5db97` feat(click): element-local position {x,y} offset for an interior cursor-free click (C7)** — click only hit
  the clickablePoint/center, so a single-Element canvas/map/timeline/seek-bar could not be clicked at a specific
  interior point cursor-free; the only escape (click_point) posts to WindowFromPoint (topmost-at-pixel, NOT
  occlusion-correct). Added position:{x,y} (element-local): clickElement validates the offset vs bounds (THROW, no silent
  clamp), SKIPS semantic activation (true coordinate click), targets bounds+offset, routes through the EXISTING
  occlusion-correct postClickToHwnd on BOTH cursor-free and cursor:true paths. Default byte-identical. No new
  tool/FFI/count; handler parses via record()/requireNumber (no cast). Proof composes two already-live-proven parts
  (postClickToHwnd lands a posted click at the posted point; interior point = bounds+offset) + test/click-position.test
  pins the arithmetic/validation/skip/two-path/wiring. (A standalone canvas-draw demo needs a classic own-HWND
  single-Element surface — Win11's WinUI Paint ignores posted Win32 clicks — so the composition proof carries it.)

## DEFERRED (unchanged — huddle's own guidance)
- **C2 — screenshot_marked WGC fallback.** Huddle settled the exact minimal shape (orchestrate the
  PrintWindow→isNearUniform→captureWindowLiveWarm ladder + isMinimized steer in the mcp handler; NO marks.ts edit; NO
  DPI mark-scaling — PROCESS_PER_MONITOR_DPI_AWARE makes GetWindowRect/UIA-bounds/PrintWindow/WGC share one
  physical-pixel space, proven by screenshot-origin.test). But the C2 ADVERSARY's explicit guidance: "if no surface
  genuinely blanks PrintWindow, the change is correct-but-unobservable and should be DECLINED until a real blanking
  surface is in hand." C1's live work already showed PW_RENDERFULLCONTENT RECOVERS WinUI on this host (Calculator not
  blank), and modern Chromium recovers too — so no readily-launchable blanking surface. Deferred, NOT declined: the fix
  is correct-by-construction (mirrors the proven `screenshot` ladder) and ready the moment a blanking surface (a
  hardware-decoded video frame / DRM / a genuinely-blanking GPU view) is available to prove it live. (Unlike C7, whose
  composition proof the huddle accepted, C2's recovery branch is only reachable on a blanking surface — hence the defer.)

## SESSION TOTAL (all three findings files)
**15 commits.** HARDEN (7): sendKeys phantom tool, (error as Error) casts, OCR+TextPattern redaction, GDI-leak,
COM-proxy-leak, token-economy trims (H8/H9). CAPABILITY (6): C1 computer-use WGC screenshot, C5 battery+power-plan,
C4 find_image/find_color+decodePNG, C3 wait_visual_idle, C8 find_and_act/reveal select-mode, C7 click position-offset.
MACHINE: handlers-align.test (automates the TOOLS↔HANDLERS check the Dead-Code lane did by hand). DECLINED with
evidence: H7 (vcall-alloc below-bar), C6 (TextRange ScrollIntoView — live-refuted: Select already auto-scrolls),
server.json (owner-reserved). DEFERRED: C2 (no blanking surface on this host). CLEAN lanes (skip next pass):
Dead-Code/Dup, Segfault-Safety, Fabrication-Verify. 92→95 tools, 52→82 unit tests, tsc 0, biome clean, tree clean.
Every actionable finding is shipped, declined-with-evidence, or deferred-with-reason → the queue is resolved.
