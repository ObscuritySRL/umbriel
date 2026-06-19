# Cycle 5 — the "Notepad-coupled strategic" cluster was mostly a fixable ref bug

CORRECTION of the cycle-2/3 narrative. I had classified ~5 tests as "strategic Win11-Notepad coupling
requiring synthetic-control retargeting (owner decision)." Live investigation (the lesson that keeps paying
off) shows that was WRONG for most of them: they shared one surgical, fixable bug. The products all work.

## Fixed this cycle (live-verified, pushed)

- **vcall-safety** — was NOT a "Bun-canary crash signature" (my earlier guess). The subprocess imported `vcall`
  from `${import.meta.dir}/../com.ts`, but after the monorepo→folders refactor `vcall` is at `com/com.ts`
  (root `com.ts` absent). The child failed to IMPORT → exit 1, empty stdout → the catchability proof never ran.
  Fixed the path; child now catches the zeroed-interface fault and exits 0. Stale path, not a runtime issue.

- **cursor-free-mcp-input, cursor-free-undo, cursor-free-copy-cut** — the SAME delta-reground ref bug as
  mcp-snapshot-economy, NOT strategic coupling. Each re-resolved the editor ref via a FRESH `desktop_snapshot`
  after a value change (type/cut), but that reground returns a compact Δ / "no UI change" that omits the
  `[ref=]` line → the ref helper returned `undefined` → the tool ran with NO ref (generic SendInput path:
  Ctrl+C "no selection", Ctrl+Z "pressed", or type-to-nothing) instead of the ref-gated cursor-free path.
  Refs survive value deltas ("other refs unchanged"), so the fix is to cache the last resolved ref and fall
  back to it. Verified LIVE on Win11 Notepad's `RichEditD2DPT`: WM_CHAR, WM_PASTE, WM_COPY, WM_CUT, EM_SETSEL,
  EM_UNDO all land and read back. The product's cursor-free posting was always correct.

## Net correction

The umbriel PRODUCT has no defect in any of these — cursor-free input/clipboard/undo work on Win11's
RichEditD2DPT (foreground AND minimized), proven across cycles 2-5. The earlier "must retarget ~5 real-app
tests to synthetic controls (owner decision)" conclusion was largely WRONG; 4 were ordinary fixable test bugs
(a stale import path + the delta-reground ref pattern). Investigate live before classifying.

## Genuinely open (the only 2 left from the original 20 sweep failures)

- **copy-secret-redacted-not-journaled — OWNER DECISION (security-surface format), NOT a leak.** Verified the
  security floor HOLDS: `redactSecrets` is applied on every copy/cut path; the copied AKIA secret never appears
  raw in the echo or the trace observation. The test fails only on a *positive* `«redacted»`-presence proxy:
  `copy` uses a MULTI-LINE `fenceUntrusted` (preamble line 1, `«redacted»` line 2 — matching `read_clipboard`),
  while `cut` is single-line; the test slices the first line (correct for cut), and the trace observation is
  also the first line (the fence preamble for copy). So copy's observation is uninformative (preamble only),
  not leaky. Making it green needs an OWNER call: either make `copy`'s echo single-line (consistent with `cut`,
  informative trace — but breaks its `read_clipboard` consistency) OR relax the test's positive check to the
  security-critical `!includes(SECRET)`. I will not change the security-surface output format or weaken a
  security test autonomously.

- **snapshot-leak — needs deeper investigation (not a clean fix).** Instruments `Element.prototype.cachedChildren`
  / `cachedControlType` to inject a throw at controlType-read #6 and assert `materialized > 0`. It failed with
  `materialized = 0` (6 controlType reads, ZERO `cachedChildren` getter calls) → the `snapshot()` walk accesses
  children via a different path than the instrumented getter, so the instrumentation no longer measures what it
  assumes; also TMO'd in isolation (a deep maxDepth:25 walk timing issue on Win11 Notepad). The CORE safety
  property (a mid-walk fault releases every materialized child) still holds (`releases >= materialized` passes).
  Fixing it means re-architecting the fault trigger to fire on the FIRST controlType read AFTER children
  actually materialize via the real access path (read refmap.ts walk()/walkLive() to find it), and resolving the
  deep-walk timing. A focused next-cycle task, not a one-line fix.

## Tally

Session: deterministic sweep failures resolved — selector-controltype, text-cap, find-and-act-popup,
safety-floor, mcp-snapshot-economy, vcall-safety, cursor-free-mcp-input, cursor-free-undo, cursor-free-copy-cut
(9 fixed). Remaining: copy-secret (owner security-format decision), snapshot-leak (deeper investigation), and
the owner-only items (SERVER_INFO version sync; Dock/TableItem capability candidates). Still zero product bugs.
