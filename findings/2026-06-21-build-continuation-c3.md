# BUILD continuation — token trims + wait_visual_idle shipped, ScrollIntoView declined (live), C2 deferred — 2026-06-21

Continues `2026-06-21-two-panel-eight-slices.md` (the 8-slice pass). Worked the recorded queue with a second design
huddle (C2/C3/C6, 2 critic seats each). Baseline at start: HEAD `fca7442` (tsc 0, 69 tests, 92 tools — wait, 94 after
C4). End: HEAD `51bd522`, tsc 0, **77 unit tests**, **95 tools** (73 safe / 39 readonly / 22 os-fs), tree clean, pushed.

## SHIPPED
- **`3f2e23d` perf(mcp): token-economy trims (H8+H9)** — dropped the non-actionable `Gated behind the "os"/"fs" category`
  prose from ~14 os/fs descriptions (gating is structural: the `category` field drives toolAllowed + the
  destructiveHint/openWorldHint annotations + the blocked-call error already carry it; KEPT "Destructive." and the
  UMBRIEL_FS_ROOT sandbox note). Deduped the thrice-stated maxDepth/flat-tree caveat out of the per-session INSTRUCTIONS
  banner (kept at point-of-use on desktop_snapshot). ~708 B off the always-paid tools/list. +test/no-gating-boilerplate.
- **`51bd522` feat(wait_visual_idle): pixel/frame-delta idle wait (C3)** — wait_idle hashes only the UIA tree → "settles"
  instantly on a no-a11y surface (game/canvas/WebGL/video/GPU browser) while pixels animate. New waitForVisualIdle(getFrame,
  opts) + a pure frameDifference(a,b,step) same-size comparator (255 on dim-mismatch — a resize counts as changed, no OOB).
  Thunk design keeps the waiter pure: the wait_visual_idle read-tool supplies captureWindowLive(hWnd) (BG/WGC) or
  captureScreen(region) (FG). null frame = changed (a surfaceless window never falsely settles). 94->95 tools. Contract
  proven deterministically (test/visual-idle.test.ts: animating->false, stable->true, null->false, sub-tolerance->true);
  both live frame sources settle a static surface (example/wait-visual-idle.integration.test.ts).

## DECLINED — live verification refuted the hypothesis (re-confirm before re-proposing)
- **C6 — find_text/selectText TextRange::ScrollIntoView (slot 19).** Built it end-to-end (slot 19 header-verified +
  literal-pinned in slot-gate; no crash at runtime — the segfault risk was retired). But the LIVE proof refuted the
  finder's PREMISE: on Notepad, `selectText('LINEMARKER 388', {scroll:FALSE})` STILL brought the match into the visible
  text — i.e. IUIAutomationTextRange::**Select (slot 16) already auto-scrolls** the selection into view (standard Windows
  edit behavior: selecting moves the caret, which scrolls). So ScrollIntoView is REDUNDANT on standard text controls;
  find_text already revealed matches before the change. Could not demonstrate ANY control where Select selects-without-
  scrolling (the premise). REVERTED (a redundant per-find_text vcall is vanity). Slot 19 IS correct (19=ScrollIntoView,
  20=GetChildren, vs UIAutomationClient.h 10.0.22000.0) — if a Select-doesn't-scroll provider ever surfaces, it's a
  ready 1-line add; until then, declined. (try-and-fail = DATA: the finder recipe was a HYPOTHESIS that didn't survive.)

## DEFERRED — correct but unprovable on this host (huddle's own guidance)
- **C2 — screenshot_marked WGC fallback.** screenshotWithMarks is PrintWindow-only (blank on GPU/occluded), unlike its
  WGC-backed siblings screenshot/capture_window. The huddle settled the minimal shape (orchestrate the
  PrintWindow->isNearUniform->captureWindowLiveWarm ladder + isMinimized steer in the mcp handler; NO marks.ts edit; NO
  DPI mark-scaling — the process is PROCESS_PER_MONITOR_DPI_AWARE so GetWindowRect/UIA-bounds/PrintWindow/WGC share one
  physical-pixel space, proven by screenshot-origin.test). BUT: C1's live work already established PrintWindow RECOVERS
  WinUI on this host (Calculator was NOT blank), and the huddle adversary's explicit guidance is "if no surface genuinely
  blanks PrintWindow, the change is correct-but-unobservable and should be DECLINED until a real blanking surface is in
  hand." No reliably-launchable blanking surface found (Edge attach is flaky; WinUI recovers). Deferred — the fix is
  correct-by-construction (mirrors the proven `screenshot` ladder) and ready to build the moment a blanking surface
  (a hardware-decoded video frame / DRM / a genuinely-blanking Chromium GPU view) is available to prove it live.

## STILL QUEUED (LOW; each needs a huddle + live proof on a specific control)
- **C7 — click {ref, position:{x,y}}** element-local offset (Playwright locator.click({position})). Resolve bounds + add
  offset, route the EXISTING cursor-free postClickToHwnd (occlusion-correct — the guarantee click_point loses). Composable
  today via inspect_element bounds + click_point (degraded). No new FFI. Needs a single-Element canvas to prove an
  interior click landed off-center.
- **C8 — multi-select mode through find_and_act/reveal.** act()'s select branch hardwires element.select() (replace);
  thread mode:'replace'|'add'|'remove' to the already-wired Element.addToSelection/removeFromSelection (currently only the
  dedicated by-ref select tool reaches them). Composable today via the 2-call reveal->snapshot->select{ref,mode} path.
  Needs a multi-select list to prove add/remove.

## Cumulative this session (both findings files)
12 commits: 5 HARDEN (sendKeys, casts, redaction, GDI-leak, COM-proxy-leak) + 2 token trims (H8/H9) + 4 CAPABILITY
(computer-use WGC screenshot C1, battery+power-plan C5, find_image/find_color+decodePNG C4, wait_visual_idle C3) +
handlers-align machine guard + 2 findings. DECLINED: H7 (vcall-alloc, below-bar), C6 (live-refuted), server.json (owner).
DEFERRED: C2 (unprovable here). 92->95 tools, 52->77 unit tests, tsc 0, tree clean.
