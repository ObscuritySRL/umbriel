# 2026-06-27 cycle 3 — two-panel fan-out + HMENU design huddle: 1 harden ship, 2 declines (evidence), 2 fabrication catches, 4 deferred (no-spawn)

Seeded by an owner question — *"what about a `javascript_tool` (claude-in-chrome) equivalent?"* — which became this cycle's
Panel B lead. 9 ultracode finders (6 harden axes + 3 capability). Mid-cycle the owner imposed **no-spawn** (a game was
open), so all live-spawn verification + every mutating-tool build was deferred; this cycle shipped only what is provable
without touching the live desktop (code + tsc + the pure `test/` unit tests + docs/findings).

## Shipped
- **`perf(mcp)` 78b09f3** — trimmed two field descriptions that restate their tool's main narrative: `read_table.startRow`
  (−59 B) and `find_and_act.timeout` (−79 B) = **−138 wire bytes** on every `tools/list` (full + safe), semantics
  identical, no test pins the substrings. Same accepted class as 04cbf2f. tsc 0; tool-count 4/4.
- **web-eval re-check correction** (findings/2026-06-23-bun-webview-windows.md) — see below.

## CLEAN lanes (re-confirmed with fresh evidence, not asserted)
- **Perf / FFI hot paths** — vcall memoized + arity-specialized; reads.ts scratch buffers hoisted; scalar-VARIANT fast
  path; the per-call `argTypes` array is a twice-declined ~5–11 ns wall (166-site blast radius). No new instance.
- **Reliability / leaks / segfault** — full trace of 5 hazard classes (ptr-across-await, early-return COM leak,
  double-release, wrong vtable slot, missing CoInitialize) across the whole COM/handle spine: every `await` is a
  `Bun.sleep` poll with `.ptr` read inline; every early return sits inside a try/finally; slot-gate pins 104+24+18 slots.
  Clean beyond the just-converged throw-path sweep. (Open record-only item unchanged: `reveal()` pane-scan needs a
  raw-pointer null-out restructure, not a byte-identical slice.)
- **Security / policy** — `resolveFsPath` live-tested against 12 escape vectors (dotdot/drive-relative/UNC/root-rel) all
  blocked; deny-wins; fail-closed-to-readonly; all 99 tool↔category pairings correct; redaction chokepoints intact.
- **Code-hygiene / dead-code / fabrication** — 0 dead exports (370 symbols scanned), 0 unused imports; the ~11
  production-unused SLOT entries are header-gated by slot-gate (not dead); sole hand-roll (wgc.ts:62 dlopen) matches the
  d3d11 binding + is in TODO.md.
- **Panel B — generic UIA-pattern dispatcher (`pattern_invoke`)** — **DECLINED (vanity)**. Live prevalence probe (Opera/
  VS Code×4/Discord/Settings/Explorer/Notepad) found the actionable-and-unwrapped tail is essentially empty: Dock/
  SynchronizedInput/CustomNavigation/SpreadsheetItem/Annotation = **0 instances**; VirtualizedItem/ItemContainer are
  already handled by `reveal()`+`scrollIntoView` (or walled by the VARIANT-by-value segfault); TextEdit/Selection2/
  Annotation are reads already covered. A dispatcher would reintroduce exactly the 3 hazards the discrete-prim design
  prevents: (1) LLM-chosen slot/args defeats the hand-verified-signature invariant → uncatchable stack corruption,
  (2) un-gateable by verb (one tool spanning read + destructive), (3) loses per-verb foreground-steal disclosure.

## DECLINED — `menu_command` (classic-Win32 HMENU command invoke)
Three-critic design huddle on the HMENU menu-drive candidate (the cycle's headline). The **decline adversary** gathered
the decisive live evidence (before the no-spawn order):
- The premise *"UIA can't see classic menus"* is **overstated**. On msinfo32 the top MenuBar **is** in UIA
  (MenuBar=2 / MenuItem=5), and the existing `expand` verb opens the classic `#32768` popup **cursor-free, foreground
  unchanged**, then UIA reads the leaves — and this is already wired (`withPopupNote`, mcp.ts:1199).
- `menu_command` (PostMessageW WM_COMMAND(id)) is **fire-and-forget**: PostMessage returns nonzero regardless, with no
  state readback — it cannot honor the verifiable-action / no-false-success doctrine (`assertActionable`,
  `disclosingPatternAct`) the rest of the act surface enforces. Its *only* net-new behavior over `expand → #32768 →
  invoke-by-ref` is firing a possibly-destructive command (Exit/Delete/Clear) on a **background/invisible** window with
  zero confirmation — the exact footgun the doctrine exists to prevent.
- Reliability cliff: bypasses `WM_INITMENUPOPUP` (stale/dynamic ids, unreliable closed-menu `MF_GRAYED`), no-ops on
  `MNS_NOTIFYBYPOS` apps (they send WM_MENUCOMMAND, not WM_COMMAND). Conceded WM_COMMAND **does** fire on a true classic
  app (msinfo32: posting id 32781 opened *About* even minimized) — declined on **doctrine + footgun**, not infeasibility.

## DEFERRED candidate — `list_menu` (classic-Win32 HMENU read) — reshaped, needs live no-spawn verify
A real but **narrower** read edge: enumerate a classic app's *entire* menu tree in ONE cursor-free, background,
zero-side-effect call (UIA yields only the top bar + one popup-per-`expand`, and `expand` fails+steals foreground on a
minimized window). Worth building — but the finder's recipe is **wrong** and must be corrected first:
- `GetMenu(attachedFrame)` returns **0** for resmon / regedit / Win11-Notepad — the HMENU often lives on a **child**
  window, and a sibling child can return a **bogus** handle (`GetMenuItemCount = −1`). Must **menu-hunt** the HWND
  subtree (reuse the spy.ts walk) and reject `GetMenuItemCount < 0`.
- **FFI sentinel fixes (verified):** `GetMenuItemID` and `GetMenuState` are typed `u32`, so the `-1` sentinel arrives as
  **`0xFFFFFFFF`**, never `-1` (a `=== -1` test is dead code) — test against `0xFFFFFFFF` and bail before masking flags.
- Top-level-HWND-only (GetMenu undefined on child windows), `maxDepth`+`visited Set<bigint>` recursion bound, **never**
  `DestroyMenu`, `GetSystemMenu(bRevert=0)` only. All signatures present in `@bun-win32/user32` — no hand-roll. Category
  `'read'`, reuse `resolveHwnd`+`redactSecrets`, disclose empty-submenu / owner-draw / `GetMenu==0` / UIPI-wall.
- **Status: READY to build; live read-verify (against an already-open classic-menu app, no spawn) deferred per no-spawn.**
  Beats the floor (FlaUI must physically open the menu; AHK can't read it structured; Windows-MCP sees 0 items).

## web-eval (the `javascript_tool` analog) — wall re-confirmed + ETA corrected
- Bun 1.4.0 (now stable) still throws `ERR_DLOPEN_FAILED` on `Bun.WebView(chrome)`.
- **PR #30483 is CLOSED/dead** (GitHub API: `state=closed`, `merged=false`, closed 2026-06-26 — predates Bun's Rust
  rewrite, sources gone). Issue #29102 still open. Re-check trigger updated: stop watching #30483, watch #29102.
- Verdict (re-confirmed): do NOT build a CDP/JS-eval client — it can attach only to a browser umbriel itself spawns with
  `--remote-debugging-port`, a STRICT SUBSET of the existing UIA-drives-web reach (which already drives the user's open
  Chrome/Edge/VS Code/Slack/Discord/Teams DOM cursor-free + backgrounded), and a debug-port Chrome is a forbidden sidecar
  + an unauthenticated localhost control channel. Net benefit negative.

## FABRICATION CATCHES (verified against code, not memory)
1. **`process_info` command-line is ALREADY SHIPPED** — the `B:missing-redesign` finder claimed it returns no command
   line and is "newly unblocked." FALSE: `desktop/events.ts:573-586` does the full PEB walk (NtQueryInformationProcess →
   PEB.ProcessParameters@0x20 → CommandLine@0x70 / CurrentDirectory@0x38 via NtReadVirtualMemory), surfaced at
   `mcp.ts:3907` with redaction, covered by `example/process-commandline.integration.test.ts`. TODO.md:79-80 already
   records it shipped. Candidate dropped; TODO.md left unchanged (correct).
2. **ARTICLE.md is gitignored / untracked** (`.gitignore:36`) — a local-only doc with **no git history**. The
   `A:doc-fidelity` finder's "git log shows ARTICLE.md last edited Jun 22" was an mtime misread. Its stale version note
   (1.12.0 → 1.14.0) was corrected in the working tree but is **not a committable slice** (and future doc sweeps must not
   re-flag ARTICLE.md as tracked drift — it's local-only).

## Owner flag (not autonomous — server.json is owner-released)
- **server.json omits `UMBRIEL_TRACE_SNAPSHOTS`** (implemented mcp.ts:320-325, used :853/:859/:4345). The manifest
  documents the sibling diagnostic vars `UMBRIEL_TRACE` + `UMBRIEL_FFI_TRACE` but not this one. Possibly intentional
  folding under TRACE, but the FFI_TRACE precedent argues oversight. Owner to add an `environmentVariables` entry
  (string, not required, not secret) or confirm the omission is deliberate.

## Deferred capability queue (READY — build + live-verify when spawning is OK)
All four are real round-trip/contract wins but need a live window to verify behavior (no-spawn → deferred):
1. **`find_image`/`find_color` `{click?}`** — on a hit, route the won {x,y} through the existing `click_point`; default
   false = byte-identical find-only. Removes the find→click_point round-trip (click_text is the one-call precedent).
2. **`set_view` `{name?}`** — match the MultipleView `GetViewName` list; collapses the list_views→set_view round-trip
   for "flip Explorer to Details". Byte-identical when `{id}` passed.
3. **`manage_window` move-only / resize-only** — allow move with only x,y (SWP_NOSIZE) / resize with only w,h
   (SWP_NOMOVE); removes a read round-trip to nudge a window (AHK WinMove parity). Relaxed-required-args → owner-flag.
4. **`type` `{clear?}`** — `type` silently APPENDS at the caret (concatenates into a pre-filled field with a confident
   success); add `{clear?}` (Playwright `fill()` parity), default false = byte-identical, or at minimum disclose the
   append semantics. Default-change → owner-flag.

## Convergence
Harden panel (perf, reliability, security, hygiene, token-economy, doc-fidelity) **clean / shipped**. Panel B:
generic-dispatcher + menu_command + CDP-eval **declined with evidence**; list_menu + the 4 redesign wins **deferred for
live-spawn verification** (owner no-spawn). tsc 0; `test/` unit suite green. The remaining build work is gated solely on
a live-desktop window, not on missing findings.
