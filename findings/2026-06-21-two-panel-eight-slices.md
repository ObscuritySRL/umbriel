# Two-panel BUILD pass — 8 slices shipped (5 HARDEN + 3 CAPABILITY), queue recorded — 2026-06-21

A full BUILD loop under Fable5+ultracode. Baseline: HEAD `5d6bd73`, tsc 0, 52 unit tests, 92 tools. End: tsc 0,
**69 unit tests**, **94 tools** (72 safe / 38 readonly / 22 os-fs), tree clean, all pushed.

## Method
- **Finder fleet**: 11 HARDEN axes + 3 CAPABILITY seats spawned at once. First fan-out hit a transient server-side
  rate limit (14 agents @ once → 13/14 died). Re-ran the 13 in **throttled batches of 3** with an adversarial
  verify-per-finding stage → 17 confirmed, 1 refuted, 3 lanes CLEAN-with-evidence. (MACHINE LESSON: fan out finders in
  batches of ~3, never ~14 at once.)
- **Pre-build DESIGN HUDDLE** (2 critic seats each) for the 3 capabilities before coding. It earned its keep: the two
  seats SPLIT on whether `Bun.inflateSync` is raw vs zlib-wrapped; an empirical probe settled it RAW (it throws
  "invalid stored block lengths" on a zlib-wrapped stream) — following the wrong seat would have shipped a silently
  broken PNG decoder. The huddle also caught a find_image `{path}` gate-leak (read-category + `resolveFsPath` no-op
  when `UMBRIEL_FS_ROOT` unset → arbitrary disk read) → dropped `{path}`, image-only.

## SHIPPED (each tsc 0 + biome + test + live proof where applicable)
- **`e9b5cad` fix(mcp): drop phantom `sendKeys` from INSTRUCTIONS** — the banner named a library-only facade as if an
  MCP tool; tools/call would dead-end "unknown tool". +honesty test (every snake_case token in INSTRUCTIONS is a real tool).
- **`9154550` fix(hygiene): 9× `(error as Error)` → `error instanceof Error ? error.message : String(error)`** — a real
  unknown→Error cast (AGENTS.md forbids) that also throws on `throw null`. CORRECTS the prior
  `2026-06-19-harden-converged` note that lumped it with the genuine `Number()→Pointer` idiom as "unavoidable" — the
  cast-free form was already in-repo (mcp.ts:953/…), so it was avoidable. +glob guard test.
- **`29aac63` fix(security): redact secrets on the OCR + inspect_element TextPattern read paths** — both fenced but
  skipped `redactSecrets`, leaking AWS/Bearer/JWT/PEM tokens the sibling read paths mask. Coords come from bounds, not
  string length, so masking shifts nothing. +wiring test.
- **`a205ba1` fix(capture): GDI try/finally in captureScreen/captureWindowRGB** — the DC+memDC+bitmap teardown was
  unconditional (not finally), so a throw from the BGRA `Buffer.alloc` (huge multi-monitor grab / OOM) leaked them
  against the 10k GDI quota. Proven live: forced-throw ×30 → GDI Δ0 (was ~+60).
- **`66e6545` fix(element): free in-flight COM proxies on the throw path of find()'s cached-filter loop** — the one
  site the prior `ae54a76` leak fix missed; a vcall UAF throw mid-loop leaked `pointers[index..]`. Success path
  byte-identical (find-cached integration test green). +structural test.
- **`516b1c0` feat(computer-use): WGC-first `screenshot`** (CAP, C1) — the CUA observation action used bare PrintWindow,
  blank on the GPU/occluded windows the adapter exists to drive (every other verb is already cursor-free+BG). Mirror
  Element.capture(): `(await captureWindowLive) ?? captureWindowRGB` → encodePNG; both-null → honest ok:false (was a
  silent 0-byte PNG). WGC-first because isNearUniform/captureWindowLiveWarm are mcp.ts-private (layering). Proven live
  3× (byte-identical to the re-encoded WGC frame, distinct from PrintWindow). Library change → no tool count change.
- **`bf37604` feat(system_status): battery %/time/charging/saver + active power plan** (CAP, C5) — read the rest of the
  SYSTEM_POWER_STATUS buffer it already filled (sentinels 255/0xFFFFFFFF/0x80 → null/false), + `activePowerPlan()`
  (PowerGetActiveScheme+PowerReadFriendlyName). The trap was `LocalFree` on the GUID** (NOT the name buffer); GUID
  address→ptr via the sanctioned `Number(x) as Pointer`. Folded into the existing read tool — no count change. Live:
  "Ultimate Performance" resolved; +structural LocalFree pin.
- **`0fb9a11` feat(find_image,find_color): pixel/template grounding + decodePNG** (CAP, C4) — the AHK ImageSearch/
  PixelSearch + nut.js core, library-exported but unwired. Added a from-scratch pure-TS `decodePNG` (8-bit color types
  0/2/3/6, all 5 filters incl Paeth, strip zlib wrapper for raw inflateSync). find_image takes base64 `{image}` ONLY
  (no `{path}` gate-leak). 92→94 tools. Tests: decode round-trip + every filter + all color types (156 asserts);
  live capture→encode→base64→decode→locate at score 1.000 / 100% re-capture. +**handlers-align.test.ts** machine guard
  (every TOOLS name ↔ a HANDLERS entry — the alignment the Dead-Code lane checked by hand).

## DECLINED / OWNER-RESERVED (re-confirm before re-proposing — STILL walls)
- **H7 — vcall per-call argTypes array alloc** (Perf, low/low-confidence): ~5.4 ns/call, ~1% of a sub-µs cached read,
  166-site blast radius, no test-observable effect; the finder itself recommended "accept the cost". Below the
  byte-identical+measured-axis+**minimal-diff** bar (a vcall1 specialization adds surface). NOT a win.
- **server.json UMBRIEL_OS description under-lists 4 os-tools** (set_display/manage_task/power_state/registry_key) —
  REAL doc drift, but server.json is OWNER-RESERVED (release-coupled: release-check version-lockstep + mcp-publisher;
  BUILD.md LAW "NO publish/server.json"). Owner note, not an autonomous ship.
- **UMBRIEL_TRACE_SNAPSHOTS undocumented in server.json/AI.md** — refuted: already classified owner-reserved /
  deliberately-deferred in `2026-06-20-converge-2`; second-order debug knob, AGENTS.md env list also omits it.
- Prior declines unchanged (DockPattern, TextEditPattern, ItemContainer VARIANT-segfault, OLE drag-drop,
  clipboard-history, toast, SetWindowDisplayAffinity, RegisterHotKey, virtual-desktop move, manage_task RUN slots).

## READY-TO-BUILD QUEUE (verified findings, NOT yet built — next iteration)
HARDEN (no huddle — byte-identical/description-only):
- **H8 (token, LOW):** drop the ` Gated behind the "os"/"fs" category[; destructive].` boilerplate from the ~21 os/fs
  tool descriptions (the `destructiveHint`/`openWorldHint` annotations + the blocked-call remedy error already carry
  gating+destructiveness; `category` is stripped from tools/list so the note is non-actionable in BOTH visibility
  states). KEEP the `restricted to UMBRIEL_FS_ROOT when set` clause (the only sandbox signal; UMBRIEL_FS_ROOT absent
  from INSTRUCTIONS). ~827 B / ~207 tokens off the always-paid full-profile tools/list. No test asserts these substrings.
- **H9 (token, LOW):** the `maxDepth caps DEPTH only / does NOT bound a flat-wide tree` caveat is stated 3× (INSTRUCTIONS
  + desktop_snapshot description + its maxDepth property). Shorten it in INSTRUCTIONS (keep the actionable maxNodes/{root}
  directive there per the line-1487-1490 "contract lives ONCE in INSTRUCTIONS" precedent); the tool carries the caveat
  at point-of-use. ~55-65 B off the per-session safe banner.

CAPABILITY (DESIGN-HUDDLE each before building):
- **C2 (MED): screenshot_marked WGC fallback.** It's PrintWindow-only (`screenshotWithMarks` → captureWindowRGB) →
  blank on GPU/occluded, unlike sibling screenshot/capture_window. Add `screenshotWithMarksLive` (captureWindowLive ??
  captureWindowRGB) then `drawMarks` over the won Bitmap. **TRAP (verified):** WGC frames are PHYSICAL-pixel
  textureWidth/Height (origin from GetWindowRect) — under per-monitor DPI the texture dims ≠ rect dims, so scale each
  mark's (bounds−origin) by texture/rect ratio before blitting or the numbered boxes misplace. Huddle the DPI math.
- **C3 (HIGH): wait_visual_idle.** wait_idle hashes only the UIA tree → returns "settled" instantly on a no-a11y
  surface (game/canvas/WebGL/video) while pixels animate; the only alternative is computer.ts's blind `Bun.sleep`.
  Poll captureWindowLive (BG) / captureScreen (FG), compare CONSECUTIVE same-size frames by mean-abs RGB delta, resolve
  when under tolerance for quietMs (false at timeout). Needs a NEW small same-size comparator (match.ts `meanDifference`
  is private + needle/haystack-shaped). category 'read'. Mirrors waitForIdle's quietMs/interval/timeout contract.
- **C6 (MED, SEGFAULT-RISK): TextRange ScrollIntoView.** find_text/selectText selects a found range but can't reveal it
  in a scrolled/virtualized document (the only ScrollIntoView is ScrollItemPattern, element-granularity). Bind
  IUIAutomationTextRange::ScrollIntoView (slot **19** per UIAutomationClient.h, sig `BOOL alignToTop`) as a local const
  like TEXTRANGE_SELECT=16, call after Select in selectText, surface `scroll:bool` on find_text. **A WRONG SLOT
  SEGFAULTS — live-verify slot 19 in isolation BEFORE chaining + extend slot-gate.test's um/UIAutomationClient.h block
  + literal-pin.**
- **C7 (LOW): click {ref, position:{x,y}}** element-local offset (Playwright locator.click({position}) parity) — resolve
  bounds, add offset, route the EXISTING cursor-free postClickToHwnd (occlusion-correct, which click_point loses).
  Composable today via inspect_element bounds + click_point (degraded). Pure bounds arithmetic, no new FFI.
- **C8 (LOW): multi-select mode through find_and_act/reveal** — act()'s select branch hardwires element.select()
  (replace); thread `mode:'replace'|'add'|'remove'` to addToSelection/removeFromSelection (already wired only to the
  dedicated by-ref select tool). Composable today via the 2-call reveal→snapshot→select{ref,mode} path.

## CLEAN lanes (CONSTRAINTS — next pass can skip; evidence on file)
- **Dead-Code/Dup** — HANDLERS↔TOOLS exactly aligned (now pinned by handlers-align.test); all 5 categories profile-reachable;
  10 env vars read; 298 exports each used-or-public-SDK; no unused internal helper/import; readPackedWide/utf16le-inline
  dup remains REPORT-ONLY (1024 vs 2048 differ; per-site inlining is the convention).
- **Segfault-Safety** — no `.ptr` cached across await; structs at the call site; offsets/strides/slots correct; UAF
  vectors (events.ts queueMicrotask, clipboard sync copy) guarded; slot-gate green (104+24+18).
- **Fabrication-Verify** — every high-risk UIA id / pattern-state enum / VARIANT tag / HRESULT / IID / WGC+OCR GUID /
  D3D struct offset / FFI signature spot-checked vs the installed @bun-win32 binding + SDK headers; all match.

## CONVERGED-this-turn note
8 real slices, 0 speculative edits, 1 reasoned decline, 3 lanes clean. NOT a full one-turn convergence: the queue above
(H8/H9 + C2/C3/C6/C7/C8) is verified-but-unbuilt — the next loop iteration design-huddles the capabilities (C6 wants a
live slot-19 proof) and ships the token trims. No version bump / server.json / MCP-registry (owner releases).
