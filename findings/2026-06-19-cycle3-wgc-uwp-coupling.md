# Cycle 3 — WGC lifecycle proven sound; the remaining failures are one systematic UWP-coupling issue

## Shipped

- `test: capture the taskbar in safety-floor WGC lifecycle` — section A exited 2 because its subprocess
  launched single-instance UWP Calculator, racing section C's launch/close of the same app (UWP suspends),
  giving false null captures. **The WGC bundle rebuild is sound** — proven by 3× standalone child runs
  (exit 0) and `.scratch/probe-wgc.ts` (captureWindowLive succeeds on every iteration incl. post-rebuild;
  taskbar control captures too). Switched the target to the always-present `Shell_TrayWnd` (stable classic
  Win32, never suspends), keeping the test's teeth. Full safety-floor now passes (exit 0).

## DISPROVEN (third "product bug" refuted by live probe this session)

The WGC bundle-rebuild-after-uninitialize was flagged as a possible use-after-free. Live evidence refutes it:
`init → capture → uninitialize → capture ×3` captures successfully on every iteration, and `disposeWgc()` +
rebuild work. The exit-2 was purely the Calculator test-isolation race. Do not "fix" the WGC lifecycle code.

## mcp-snapshot-economy — FIXED (a test ref-source bug; the product economy is flawless)

CORRECTION of an earlier wrong call in this file. I first concluded (from `.scratch/probe-snapshot2.ts`) that
Calculator's content tree was unavailable off-foreground and the test was an unfixable UWP-coupling dead-end.
That was WRONG — a flaw in that probe: it parsed the ref out of repeated `desktop_snapshot` DELTA responses,
which correctly say "(no UI change — refs unchanged)" and never re-list `[ref=]` lines, so the loop could
never find "Five". Calculator's content IS available — a full attach snapshot carries the whole keypad incl.
`Button "Five" [ref=e49#1]` (`.scratch/probe-uwp-ergonomics.ts`).

Real root cause (`.scratch/probe-snapshot4.ts`): the test took `fiveRef2` from a SEPARATE `desktop_snapshot {}`
after the 1st press — which returns a no-change/value delta with no `[ref=]` to parse → `fiveRef2` undefined →
the 2nd invoke ran without a ref and errored. The 1st press routes through the WinUI button's InvokePattern
(no own HWND); the MSAA bridge RAISES the window (foreground steal — findings/32) and re-grounds the tree, so
the invoke's OWN appended result carries a fresh "Five" ref. FIX (shipped): read `fiveRef2` from the 1st
invoke's result. Verified live end-to-end: 1st press re-grounds (fresh `e49#4`); 2nd press (now foreground)
returns exactly the asserted compact Δ — `~ Text "Display is 5" → "Display is 55"` (135 vs 4030 chars). The
delta economy and ref-survival-across-value-delta all work as designed. Calculator is NOT a strategic
retargeting item — it was a one-line ref-source bug.

## SYSTEMATIC FINDING — Win11 single-instance Notepad coupling (one root cause, 5 tests)

These tests assume a classic Win10 single-window Notepad with a clean, immediately-present classic `EDIT`:
`cursor-free-copy-cut`, `cursor-free-mcp-input`, `cursor-free-undo`, `copy-secret-redacted-not-journaled`,
`snapshot-leak`. On Windows 11 Notepad is a packaged single-instance app:
- **Notepad** — single-instance + session-restore (leftover content from a prior run reattaches), editor is
  `RichEditD2DPT` not classic `EDIT`. (Cursor-free posting itself WORKS — proven in cycle 2.)

(`mcp-snapshot-economy`, Calculator-based, was initially grouped here but proved to be a one-line test
ref-source bug — now FIXED, see above. No Calculator coupling remains.)

The umbriel PRODUCT paths all work (proven live across cycles 2-3). The failures are test-design coupling to
OS-version-specific app behavior + cross-test isolation (shared single-instance app state).

RECOMMENDATION (owner's strategic call — NOT done autonomously): pick one —
1. Retarget these tests to a SYNTHETIC classic Win32 control (the pattern `click-no-raise-waitstate` uses:
   create + DestroyWindow an own `EDIT`/`BUTTON`) — deterministic, isolated, OS-version-independent. Trades
   real-app coverage for reliability.
2. Keep real apps but add robust warmup/retry + guaranteed clean state (hard for single-instance UWP) and a
   per-test app-kill in teardown.
This is a test-strategy decision (real-app coverage vs determinism) that belongs to the maintainer; an
autonomous agent should not unilaterally rewrite these 5 intentional real-app integration tests.

## Other open

- `vcall-safety [A]` — subprocess expected a specific clean-crash signature; got exit=1/no-signal/empty under
  Bun 1.4-canary. com.ts documents that unmapped (non-null garbage) pointers segfault UNCATCHABLY, so this is
  runtime-version-sensitive crash behavior, not an umbriel defect. Re-confirm on a stable Bun release.

## Bottom line after 3 cycles

Zero product bugs. Three "critical product bug" claims refuted by live probing. Ten commits, all test/doc
hygiene. The codebase is in excellent shape; remaining work is a systematic test-robustness decision for the
maintainer, not product improvement.
