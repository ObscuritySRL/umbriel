# Fresh two-panel sweep — 6 harden/token/test ships + a recycle-bin capability — 2026-06-22 (cycle 2)

A fresh adversarial cycle over the post-`4eea9dd` (v1.12.0, 99 tools, 102 unit tests) HEAD. A 14-seat
finder sweep (10 HARDEN + 4 CAPABILITY/REDESIGN) returned **A-perf CLEAN-with-evidence** and 24 candidate
findings; triaged against my own hands-on read of the COM/element spine (com/reads/patterns/tree/element/
window). The prior cycle's convergence held broadly — the spine is genuinely hardened — but the sweep + read
surfaced real *defect-class-completeness* gaps the prior pass missed, plus one strong safety capability.

## SHIPPED (each tsc 0 + gated + live-or-structurally proven, committed & pushed 1/slice)
- **`63d8596` fix(element)** — `findAll`/`findAllCached` leak the accumulated + un-walked candidate COM proxies
  on a mid-walk `vcall` throw (a torn-down proxy on a fast-changing tree). The exact leak class `findFirstMatch`
  was hardened against (the "Sibling of fix ae54a76" catch) and `readTable`/`tree.walk` each got — left unfixed
  in these two siblings. `findAll` now mirrors findFirstMatch (pre-materialize + release result[] + remainder);
  `findAllCached` guards the in-flight candidate via a `pending` ref. Happy path byte-identical. 3 new structural
  pins in `test/find-throw-release.test.ts`; `filter-has-hastext` live integration green.
- **`e040cf9` test(slot-gate)** — `events.ts IACC_GET_ACCNAME = 10` was the THIRD bare local-const vtable slot
  with no header pin (unlike the TEXTRANGE_SELECT / ENUM_NEXT pins). Added it to `GATED_SLOTS_BY_FILE` + a
  literal pin. Proven with teeth: flipping the literal to 11 fails both new tests; previously it passed silently.
  Test-only; production byte-identical.
- **`2acb879` fix(msaa)** — `accRole` never VariantClear'd a VT_BSTR role VARIANT (the one VARIANT read in the
  codebase that neither switched on a resource-owning vt nor cleared). VT_I4 hot path byte-identical; the rare
  non-I4 path now frees the BSTR. Live `msaa-children-stride` (Character Map, 955 nodes) green.
- **`11d0508` refactor(wgc)** — `wgc.ts:78`'s `invoke(...) as number` was the sole avoidable `as <primitive>`
  cast in shipping source; replaced with the cast-free `Number(...)` idiom com.ts already uses. Byte-identical
  (all wgc vcalls return i32/u32/void). `grep ' as (number|string|boolean|bigint)'` over all source now empty.
- **`2ae0478` perf(mcp)** — cut `launch_app`'s "Gated — disabled unless …" boilerplate (the lone os-tool with a
  gating sentence; gating is conveyed structurally by `category`). Tightened `no-gating-boilerplate.test.ts` to
  `/\bGated\b/` so neither phrasing recurs. ~60 B off the always-paid tools/list wire; contract identical.
- **`04cbf2f` perf(mcp)** — `desktop_snapshot`'s maxDepth/maxNodes field descriptions verbatim-restated the main
  description's narrative; shrunk to the `Default N` convention every sibling lever field uses. ~234 B saved, zero
  meaning lost (narrative + defaults remain in the main description).

## CAPABILITY (shipped)
- **`13cfa42` feat(delete_file) — `{recycle:true}` recoverable Recycle-Bin delete** (the top B-capgap finding).
  `delete_file` was a permanent unlink with no undo; `{recycle:true}` (default false = byte-identical permanent
  path) routes through `Shell32.SHFileOperationW(FO_DELETE | FOF_ALLOWUNDO)` on the INSTALLED shell32 binding — no
  new package, no hand-roll. Design-huddled (struct-verifier + adversary, both GO 0.9) before build: the verified
  56-byte x64 `SHFILEOPSTRUCTW` (`recycleToBin` in window.ts), a DOUBLE-NUL `pFrom` (matching clipboard.ts's
  CF_HDROP), the adversary's highest-severity **embedded-NUL guard** (a NUL would terminate the pFrom list early and
  recycle a path OUTSIDE the sandbox — rejected up front), modal-suppressing fFlags (no UI thread on a stdio host),
  the existing `resolveFsPath` sandbox + empty-dir floor preserved, and a documented best-effort hard-delete
  fallback. Live-proven 9/9 over the real stdio server (`example/delete-recycle.integration.test.ts`); tsc 0, 107
  unit tests, biome clean, 99 tools (a flag, not a new tool), AI.md synced. The test never empties the Recycle Bin.

## DECLINED — with reasons (not bugs; re-confirmed, do not re-flag without NEW evidence)
- **get_env / read_event_log "redaction bypass" (A-security, MED×2)** — DECLINED as a unilateral fix. The prior
  cycle DELIBERATELY documented "explicit OS DATA reads (run_program stdout, registry/env/file/event-log) by-design
  unmasked," consistent with umbriel's core thesis (SEE anything kernel→pixels): a human reading the event log /
  env vars sees the raw values, and masking explicit data-reads would cripple the tool's purpose. The redaction
  floor exists to stop INCIDENTAL on-screen-secret leakage during automation (snapshot/OCR/clipboard), not to blind
  explicit reads. The genuine signal is the *inconsistency* with the redacted `process_info` commandLine — a policy
  question for the OWNER (redact incidental OS-read secrets too, or document env/event-log as deliberately raw), not
  a reversal an autonomous cycle should make. Recorded for owner adjudication.
- **HTTP fetch / download (B-capgap, LOW)** — confirmed still needs run_program today; Bun.fetch could close it with
  no binding, but arbitrary outbound HTTP from the automation host is an SSRF/exfiltration surface. A product/security
  decision (own `net` category, default-off, host allowlist), not an autonomous ship.
- **Audio volume/mute + monitor brightness (B-capgap, LOW)** — confirmed STILL-WALLED: no winmm/mmdevapi/dxva2 binding
  installed; these are whole missing DLLs (NEW bindings), owner-reserved per the FFI rule — NOT hand-roll candidates.

## ARTICLE.md version drift (A-doc, LOW) — moot for the tracked repo
ARTICLE.md is gitignored (".gitignore: Local-only dev docs — never publish", alongside DISCORD_POST.md) — not tracked, not in package.json `files`, not published. Its "Current version is 1.11.1" was a
local-draft drift; corrected locally to 1.12.0, nothing to commit. (Future doc-fidelity sweeps: ARTICLE.md is a
local draft, not a shipped doc.)

## OWNER-GATED / RECORD-ONLY (real but contract/behavior-changing → owner decides; not shipped autonomously)
- **`type` append-vs-replace (B-doubt, MED)** — the `type` verb inserts at the caret and does NOT clear, diverging
  silently from set_value's whole-control replace; an agent typing into a pre-filled field gets concatenated text.
  Minimal fix is a one-sentence description disclosure (option a); owner may prefer a `{clear:true}` opt-in.
- **LocalizedControlType fallback for Custom controls (B-rivals, LOW)** — `controlTypeName` renders "Custom" for
  ControlType.Custom (50025) instead of the provider's LocalizedControlType ("split button", "carousel item");
  common on WinUI3/WPF/Electron. Uses existing primitives but CHANGES snapshot/inspect output for Custom controls.
- **Classic Win32 menu-bar drive (B-capgap, MED)** — a native HMENU (PuTTY/classic-Notepad/MFC) is not in the UIA
  tree; reachable cursor-free via GetMenu/GetSubMenu/GetMenuItemID + posted WM_COMMAND (all in installed user32),
  but it is a new read+act surface — design-huddle it as its own slice.
- **Read-only get-selection (B-rivals, LOW)** — `getSelectedText` is reachable only via the clipboard-mutating
  copy/cut; surface it as a `selection:` line on inspect_element (read-only, existing prim).
- **list_installed_apps / registry recursive (B-capgap, LOW)** — "what's installed" is an N+1 Uninstall-key fan-out;
  a focused tool composing the existing registry readers would batch it.
- **AI-digestion normalizations (LOW)** — automationId rendered 3 ways across inspect_point/inspect_element/get_focused;
  list_* count-header inconsistency (6 do, 5 don't); read_table omits column count + small-grid extent. Each changes
  read-output bytes (not byte-identical), so owner-gated.
- **Redesign hypotheses (B-redesign, LOW)** — `click` lacks a selector (right-click-by-name needs two calls);
  find_and_act/act_batch require an explicit `do` with no default-to-activate. Registry-visible contract changes.
- **swapAttached fold (A-deadcode, LOW)** — the 6-statement attach/swap-window-state sequence is duplicated across 4
  handlers (one with a divergent order); foldable byte-identical like the prior regionArg() win. Low priority.
- **list_views/set_view/copy_image handler tests (A-test, LOW)** — no direct MCP-handler-layer test (facade covered).

## STILL-WALLED (declined walls re-probed — all hold)
DockPattern, ItemContainer VARIANT segfault, OLE drag-drop, toast AUMID, RegisterHotKey-vs-stateless,
virtual-desktop-move E_ACCESSDENIED — unchanged. Owner-reserved binding nullability gaps remain in TODO.md
(GetVolumeInformationW out-params, EnumServicesStatusExW pszGroupName, d3d11 CreateDirect3D11DeviceFromDXGIDevice).
