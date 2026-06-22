# Build session — 4 capabilities + harden + earned convergence — 2026-06-22

A two-panel BUILD pass from baseline `3dcfdd3` (95 tools / 90 unit tests) to `a7726c9` (99 tools / 102 unit
tests). The opening 15-seat finder sweep returned 2 CLEAN seats (segfault-safety, hygiene) and 13 real findings;
all were shipped, then a 7-seat earned-convergence sweep over the session diff returned 6 CLEAN + 1 real latent
leak, which was fixed and gated. A final FFI/leak confirmation came back CLEAN. **19 commits, all pushed.** tsc 0,
102 unit tests, biome clean, release-check OK, version 1.11.1.

## CAPABILITY (4 shipped — each design-huddled pre-build, gated, live-proven, no new FFI hand-roll)
- **find_files** (`c17f3c9`, fs) — recursive glob in the FS sandbox via `Bun.Glob.scanSync`; per-hit `resolveFsPath`
  re-validation drops `..`/absolute/reparse-point escapes (live-proven the secret never leaks). Kills the `dir /s` /
  `where` / `Get-ChildItem -Recurse` shell-reach + the N-call list_dir fan-out.
- **list_modules** (`0ae2204`, read) — per-process loaded-DLL enumeration (Process Explorer "DLLs" view) via
  K32EnumProcessModulesEx (single-pass — the binding's LPVOID lphModule can't take NULL) + MODULEINFO. Live: self 38,
  explorer 376, System pid 4 → [] graceful.
- **act_batch** (`95d6879`, input) — N act steps in ONE call, snapshot rebuilt ONCE at the end. SELECTOR-only (drops
  the per-step-ref UAF), per-step actionability auto-wait + ambiguity refusal, stopOnError, step-error redaction;
  maskArgs UNTOUCHED (its array-collapse already hides steps[].text — the huddle's adversary corrected the memo here).
- **wait_for_alert** (`5ce23bd` + `a7726c9`, read) — transient a11y announcement listener (dialog/alert/live-region)
  via 3 single-event SetWinEventHook on the safe OUTOFCONTEXT pump (NOT a range firehose, NOT the foreign-thread UIA
  callback) + AccessibleObjectFromEvent→get_accName. Probe-validated before build; queueMicrotask(stop) UAF guard
  mirrors waitForWindow. Modal text resolves reliably; live-region text provider-dependent (honest in the description).

## HARDEN (presume-fault wins; byte-identical on the named paths unless noted)
- **`8517b83` msaa x64 VARIANT** — `VARIANT_SIZE` 16→24 (the true x64 sizeof). The old value heap-overflowed the
  AccessibleChildren output array by 8·count AND strided the decode wrong; a misaligned vt==VT_DISPATCH could feed
  vcall(QueryInterface) an unmapped pointer (uncatchable segfault). HIGH. Live: Character Map 955 nodes / fan-out 302
  at stride-24 vs 11 / 3 at stride-16 (the gate fails at 16). The lone outlier vs firewall.ts/reads.ts scratch24.
- **`3af1523` policy deny-wins** — `UMBRIEL_ALLOW/DENY` lowercased at the parse point; `UMBRIEL_DENY=OS` was failing
  OPEN (the destructive category stayed reachable). Gate proven to fail open without the fix.
- **`7349445` tree serialize leak** — release the in-flight child on a fault mid-walk (both the recursion AND
  nextSiblingCached throw points; the finder flagged only one). Live: fault releases 6 ≥ 5; unguarded leaks 2.
- **`4f34f28` getPattern hoist** — module-scoped out-buffer, ~195 ns/call across ~40 sites; byte-identical.
- **`1c4b7ea` regionArg** — folded 5 byte-identical region builds into one extractor (Partial<Rect>).
- **`78506dd` leaf-Text prune** — drop a leaf Text that duplicates its parent's name from the RENDER (ref/marks intact,
  parent keeps the name). 5-case unit gate with the equality/ref/automationId gates as negative controls.
- **`62a6f18` conditional-verb errors** — manage_window move/set_opacity + manage_element move/resize/rotate name their
  full param set on a missing arg (the 350c75e A8 pattern); happy path byte-identical (typeof no-op).
- **`02657fe` selectSmart** — a classic radio replace-select now uses focus-clean BM_CLICK (the invoke/toggle doctrine);
  non-radio + add/remove byte-identical. Live: BM_CLICK lands the select with foreground UNCHANGED (vs UIA Select's steal).
- **`0ce9544` TODO d3d11** — logged the sole dlopen hand-roll (CreateDirect3D11DeviceFromDXGIDevice, wgc.ts:62).
- **`6afb7f7` index import merge**; **`6900b1a` select-mode-wiring** gate updated to selectSmart routing (caught by the
  full suite — the selectSmart commit had shipped before I re-ran `bun test test/`; fixed).

## TEST-INTEGRITY (two PRE-EXISTING environmental flakes fixed — both reproduced with my changes reverted)
- **`3666365` mcp-snapshot-economy** — launched Calculator via `cmd /c start calc` (a NO-SHELL violation) + title-attach
  onto a single-instance UWP that SUSPENDS backgrounded → empty ref-less tree → flake. Now umbriel.launch + attach by
  hWnd (the act_batch path). Red→green; shell-reach removed.
- **`8a00d98` find-image-color** — three live captures of a changing desktop (crop → locateOnScreen → re-capture) flaked
  at 86.4% vs the 97% gate. Now ONE capture + cropBitmap + findImage self-match (step:1) verified byte-exact at the
  match location in the SAME frame; passes back-to-back regardless of screen activity.

## EARNED CONVERGENCE
The 7-seat adversarial sweep over the 18-commit diff returned 6 CLEAN-with-evidence (leaks, security/redaction/gate,
HARDEN byte-id regression, doc-fidelity, whole-diff hostile review running 9 live tests, capability-convergence) and
ONE real LOW finding: `announcedText()` never `VariantClear`'d the pvarChild VARIANT — a latent COM ref leak on the
VT_DISPATCH return path (the live MessageBox path is VT_I4, so it never surfaced). Fixed (`a7726c9`): read childId, then
`Oleaut32.VariantClear(pvarChild.ptr!)` on every S_OK path (no-op for VT_I4; mirrors reads.ts scratch24), with a
source-parse regression gate. A final FFI/leak confirmation over the fixed HEAD came back CLEAN (tsc 0, 102 tests, both
new FFI live tests pass, no double-free / .ptr-across-await / leak). Capability lane converged honestly — the only
non-covered items are previously-declined walls (DockPattern, ItemContainer VARIANT segfault, OLE drag-drop, toast
AUMID, RegisterHotKey-vs-stateless, virtual-desktop-move E_ACCESSDENIED) and owner-reserved binding nullability gaps
already in TODO.md. **Every lane CLEAN-with-evidence; convergence EARNED by a push that found one real defect, fixed
it, and a confirming push that found nothing.**
