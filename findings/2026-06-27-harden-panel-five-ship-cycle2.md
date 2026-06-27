# Fresh harden panel (cycle 2, same day) — 13 ships + a reliability leak-on-throw sweep — 2026-06-27

A second fresh adversarial cycle over post-`7b72ac7` HEAD (the first 2026-06-27 panel had converged earlier the
same day at 99 tools / tsc 0 / 121 tests). Re-verified live anchor: tsc 0, 121 pass / 24 files, biome clean, 99
tools. A 12-seat panel returned 7 CLEAN + 5 candidates; **13 hardening slices shipped** across the cycle, each
behavior byte-identical or licensed-error-path, a measured axis, structurally-or-live proven, regression-gated
WITH TEETH, committed & pushed 1/slice. Six confirming/enumeration sweeps drove the loop — the **RELIABILITY lane
proved to hold a long chain of hidden leak-on-throw siblings** (a per-item COM/Element release left OUTSIDE a
try/finally on a path where a getter/vcall throws the com.ts UAF guard on a torn-down proxy). Each sweep surfaced
one or more the prior finders missed; the loop ran until the `.release()`-angle enumeration bounded the surface to
exactly element.ts's two scroll-host walks, all now addressed.

## SHIPPED (13 slices, each tsc 0 + gated-with-teeth + proven, committed & pushed 1/slice)
Panel (5): **`08d6efa`** getSelectedText TextRange leak · **`44e7f36`** match.ts mean/frameDifference closed-form
(bit-identical, 7.5–14.3% faster) · **`be484ee`** delete_file -32 wire bytes + gate case blind-spot · **`80cb8ad`**
find_color recovery-steer parity · **`3cbf802`** cast gate extended to `as any`/`as unknown as`.
Confirming sweep 1 (2): **`60b5bf5`** elementArrayNames element leak · **`744968d`** frameDifference step>1 ceil pin.
Cross-file reliability sweep (2): **`d96fad7`** walkFolder subfolder leak · **`ab3b40a`** msaa walk dispatch+childAccessible leak.
Final reliability-exhaustion (1): **`fdc86ad`** subtreeMatches labeledBy label leak.
`.release()`-angle enumeration sweep (3): **`ce373c3`** scrollAt walked-node leak · **`13ef963`** chromiumHostHandle
ancestor leak · **`d0b3fa9`** reveal() direct+scan-loop realized() candidate leak (try/CATCH, since the realized==true
return is caller-owned).

Every leak-on-throw fix is **single-release-per-path** (a try/finally, or a try/catch-rethrow for the
caller-owned-return cases) — no catch-remainder, so no double-release; each is byte-identical on the happy path
(the finally/catch only diverges on the tree-timing throw, freeing the proxy that previously leaked) and pinned by a
dedicated structural `*-throw-release.test.ts` (the throws are non-deterministic tree-timing races) with teeth proven
red-on-the-old-bare-release.

## RECORD-ONLY (verified hands-on; do NOT re-flag without NEW evidence)
- **reveal() most-specific-Pane scan (element.ts:464-478, RELIABILITY, HIGH — recorded, NOT shipped).** The
  `for (const pane of this.findAll({controlType:Pane}))` loop leaks the current pane + un-walked remainder + the kept
  `best` when `pane.scrollInfo` throws mid-walk (a real, reachable leak via reveal()/select_option on a WinUI
  ListView whose List reports verticallyScrollable=false). The findFirstMatch-style catch-remainder fix is NOT
  segfault-safe here: `Element.release()` (element.ts:791-794) is `comRelease(this.#ptr); this.#ptr = 0n;` — it
  zeroes #ptr only AFTER comRelease, so a `best?.release()`/`pane.release()` that THROWS mid-loop leaves #ptr
  non-zero, and a catch that re-releases it calls comRelease on a non-zeroed torn-down pointer → an uncatchable
  segfault (com.ts can't safe-read an unmapped ptr). A correct fix needs the find-throw-release null-out discipline
  (work with raw pointers and null each on successful release) — a deliberate, well-tested restructure the owner
  should do, not an autonomous byte-identical slice. Per segfault-safety-is-load-bearing + surgical-diffs, recorded.
- **ocr.ts:289 wordsView bare comRelease (RELIABILITY, LOW).** Same structural class but an OcrResult is an immutable
  COMPLETED snapshot — its proxies are stable, so the per-word vcall cannot throw mid-walk. Unreachable → recorded.
- **jab.ts:130-141 walk bare releaseJavaObject (RELIABILITY, LOW).** Pure windowsaccessbridge-64 FFI recursion, no
  com vcall, only fixed in-bounds buffer reads → no reachable throw. Recorded for consistency with its 194-201 sibling.
- **list_dir returns directory entries UNFENCED (DESIGN-DOUBT, MED).** mcp.ts:4177 omits fenceUntrusted while siblings
  read_file/find_files fence; wrapping ADDS bytes → not byte-identical → BUILD/owner.
- **kill_process by-{name} returns isError:false at "killed 0/N" all-denied (DESIGN-DOUBT, MED).** mcp.ts:3876 vs the
  by-{pid} errorResult; a partial kill's right isError is an owner judgment → BUILD/owner.

## SWEEP TRAIL (the loop's verification spine — each found the next site)
panel → confirm-1 (found elementArrayNames + step>1 gap) → confirm-2 cross-file (found walkFolder + msaa) →
convergence-check (found subtreeMatches) → `.release()`-angle enumeration (found reveal ×3 + chromiumHostHandle;
bounded the surface — input/agent/capture + desktop/com seats CLEAN) → final-converge (byte-identity/segfault audit
of slices 11-13 + reliability dry-check).

**CONVERGENCE EARNED.** The final-converge sweep returned 2/2 CLEAN: (a) slices 11-13 traced byte-identical on every
exit with exactly ONE release per proxy — the #ptr-zeroed-after-comRelease double-release segfault class is NOT
introduced; (b) the reliability lane is EXHAUSTED — a re-grep of every comRelease/.release()/.dispose()/handle-close
across com/element/input/capture/desktop/agent confirms only the recorded pane-scan (no byte-identical segfault-safe
fix exists) and the two unreachable items (ocr.ts:289 immutable snapshot, jab.ts:139 no-vcall) remain; nothing
shippable was missed. Final state: **tsc 0, 145 unit tests (was 121 at cycle start), 34 test files (was 24), 99 tools,
biome clean.** 13 slices shipped + 5 record-only items, each declined-with-reason.

## STILL-CLEAN LANES (constraints → next run skips unless NEW evidence)
SEGFAULT-SAFETY, BUG-HUNT, CODE-HYGIENE, DEAD-CODE & DUP, SHIP-FOOTPRINT, TEST-INTEGRITY, DOC-FIDELITY — all
re-confirmed with traced evidence this cycle. PERF/TOKEN/AI-DIGESTION candidates all shipped + re-swept CLEAN.

## STILL-WALLED (re-confirmed)
get_env/read_event_log/registry/file reads UNMASKED (owner-confirmed); HTTP-fetch SSRF; audio/brightness (no binding);
DockPattern; ItemContainer VARIANT segfault; OLE drag-drop; toast AUMID; RegisterHotKey; virtual-desktop-move
E_ACCESSDENIED; disk.ts listVolumes not-ready modal (owner hardware-gated); release-check.ts `pkg.version as string`
(scripts/ outside the no-error-cast glob). Owner-reserved binding nullability gaps in TODO.md.
