# Changelog

All notable changes to **umbriel** are documented in this file.

## [Unreleased]

### Fixed
- `SendInput` callers now require the exact requested event count instead of silently reporting success after Windows inserted zero or only part of a batch. Clipboard paste also stops before `Ctrl+V` when the clipboard write failed, avoiding accidental paste of stale clipboard contents.
- MCP `type` now acquires and verifies a short foreground/focus lease before typing into a no-own-HWND Chromium, WPF, or WinUI editor, restores the previous foreground window by default, and can verify text before and after submission. This gives controlled editors such as Discord/Slate an honest paste-and-submit path without claiming that UIA `set_value` updates their internal editor model.
- Export `activateWindow(hWnd)`, a boolean `SetForegroundWindow` wrapper for callers that need to observe whether Windows accepted an activation request instead of assuming it did.
- Verified clearing no longer mistakes an empty controlled search field's accessible placeholder for entered text. Placeholder-only Discord GIF/sticker searches can now use `clear:true` without a false timeout.

### Changed
- The MCP initialization guidance is shorter and Codex-oriented: it leads with the latest-ref workflow, selector-first actions, verified controlled-editor input, and accessibility-first grounding instead of spending prompt tokens on implementation detail.
- README and AI guidance now include the Codex MCP registration command and distinguish genuinely background-capable posted/semantic input from foreground-gated `SendInput`.

### Added
- `desktop_snapshot {root, tail:N}` renders only the newest N direct children of a scoped chronological list. Long Discord chats and logs no longer exhaust the response cap on old rows before the agent can see new messages.
- `attach` accepts `maxDepth`/`maxNodes` and the same `root`/`tail` scoping, avoiding a broad initial tree plus a second snapshot call when the target subtree is already known.

## [1.14.0] - 2026-06-26

### Fixed
- **Chromium/Electron page-scroll crash.** `scroll` on a Chromium page node (the `RootWebArea`/`Document`, or any element with no usable `ScrollPattern`) could hard-crash the MCP process (uncatchable segfault → stdio drop) on a heavy/hostile renderer such as Opera or Electron (Discord). The wheel branch found the render-widget host window via `Element.chromiumHostHandle()`, a cross-process UIA `GetParentElement` ancestor walk that marshals into the renderer's provider and can fault `uiautomationcore.dll`. The host is now resolved through the WINDOW tree — `renderWidgetHandleAt()` (`EnumChildWindows` for `Chrome_RenderWidgetHostHWND` + `GetWindowRect`), pure user32 — which cannot fault.
- **Erratic page under-scroll.** The page wheel now posts one `WM_MOUSEWHEEL` notch per requested step (a deterministic per-notch delta) to the resolved render-widget host, instead of a single large multiplied delta that Chromium coalesces/clamps inconsistently.
- **Stale ref on a live-walked Chromium web-root.** When a heavy Chromium render widget refused the one-shot `BuildUpdatedCache`, the snapshot's live-walk fallback stored the caller-owned web-root in the ref map, which `buildWindowSnapshot` then released — zeroing the element so by-ref actions on the page root (`scroll`/`find_and_act`) threw "null interface pointer" instead of acting. The snapshot now takes its own `AddRef`'d reference (new `Element.addRef()`), so the ref stays live for the snapshot's lifetime.

### Added
- `UMBRIEL_FFI_TRACE` — a flush-before-call diagnostic journal of every COM `vcall` (slot, this-pointer, arg count). Each line is written and flushed to disk BEFORE the native call, so after an uncatchable crash the last line names the exact faulting call. Off by default (per-call overhead). Pair with `UMBRIEL_TRACE` (per-tool JSONL) to map a crashing vcall to its MCP tool call.
- `renderWidgetHandleAt()` and `renderWidgetHandles()` are now exported.

### Changed
- `vcall` asserts `argTypes.length === args.length` — a zero-cost contract guard that turns an arg/argType arity mismatch (a caller bug or a future binding ABI drift) into a named throw instead of a malformed native frame / stack corruption.
- Pinned `@bun-win32/*` dependencies to the current major line (`core`/`combase`/`oleacc`/`oleaut32`/`kernel32`/`ntdll`/… `^2.0.1`, `user32` `^4.0.1`). Every symbol umbriel calls is signature-identical across the bump (verified), so this is a hygiene update, not an API change — but a globally-installed copy on the old 1.x/3.x line should be reinstalled to stay in lockstep.

## [1.13.0] - 2026-06-24

### Added
- `OwnedWindow` and `launchOwned()` — `using app = await umbriel.launchOwned(['notepad.exe'], { className: 'Notepad' })` launches an app and closes it (WM_CLOSE + element-ref release) when the binding leaves scope. `attach()`/`launch()` keep the non-closing contract: their `dispose()` releases the COM element reference only and never closes the window.
- `[Symbol.dispose]` on `CacheRequest` and `WindowWatcher`, so COM/handle cleanup works with `using` (joining `Element`, `Window`, and `Snapshot`).
- `delete_file { recycle: true }` — recoverable delete through the Recycle Bin (`SHFileOperationW` / `FOF_ALLOWUNDO`).

### Changed
- `snapshot()` and `serialize()` use `using` for their internal cache requests.
- Converted 32 example integration tests from `try/finally { closeWindow; dispose }` to `using launchOwned`.

### Fixed
- `CacheRequest.release()` is now idempotent (zeroes its pointer on release), fixing a latent double-`Release` segfault on the `using`-then-explicit-dispose path.
- `findFirstMatch`, `findAll`, and `findAllCached` free in-flight and already-materialized COM proxies when a walk throws mid-traversal.
- MSAA `accRole` VARIANT (`VT_BSTR`) leak — `VariantClear` on the non-`VT_I4` path.

## [1.12.0] - 2026-06-22

### Added
- `find_image` / `find_color` pixel and template grounding tools (plus `decodePNG`) to locate targets on surfaces with no accessibility tree.
- `wait_visual_idle`, a pixel/frame-delta idle wait for no-a11y surfaces that have no settled tree node.
- `wait_for_alert`, listening for transient accessibility announcements (modal dialogs, alerts, live-region updates) and returning `{type, text, hWnd, processId}`.
- `act_batch` to run N `act` steps in a single call with one deferred snapshot rebuild at the end (optional `stopOnError`).
- `list_modules` for per-process loaded-DLL enumeration (base name, load address, mapped size, on-disk path).
- `find_files` for recursive glob inside the FS sandbox in one call, with no shell-out or `list_dir` fan-out.
- Element-local `{x, y}` interior offset for a cursor-free `click`, and `select` add/remove mode threaded through `find_and_act` and `reveal`.

### Changed
- Expand `system_status` with battery percentage/time/charging state, battery-saver, and the active power plan.
- Cursor-free `BM_CLICK` for a classic radio on `select` (replace mode), avoiding the UIA foreground-steal.
- WGC-first computer-use screenshot so the CUA observation is not blank on GPU-rendered windows.
- `UMBRIEL_ALLOW` / `UMBRIEL_DENY` entries are matched case-insensitively (deny still wins).
- Multi-coordinate verb errors now name the full required parameter set instead of a single missing argument.

### Fixed
- COM proxy leaks on throw paths: the mid-serialize tree walk, the `find()` cached-filter loop, and the `wait_for_alert` child VARIANT.
- GDI object leaks on the throw path in `captureScreen` / `captureWindowRGB`.
- MSAA `AccessibleChildren` array sized and strided at the true x64 `sizeof(VARIANT)` (24 bytes).
- Removed the phantom `sendKeys` tool from the server initialize instructions.

### Security
- Complete credential redaction across every read path — snapshot tree, `find_text`, OCR / `click_text`, `inspect_element` (helpText / itemStatus / TextPattern), `inspect_point`, the marked-overlay legend, the snapshot diff, the native / MSAA / Java tree renderers, `list_windows` toast/tray labels, the `desktop_snapshot` scope header, and thrown error messages.

## [1.11.1] - 2026-06-21

### Changed
- Bind the Java Access Bridge through the published `@bun-win32/windowsaccessbridge-64` binding, removing the local `dlopen` hand-roll.

## [1.11.0] - 2026-06-21

### Added
- `list_volumes` — enumerate mounted drives natively (type, label, filesystem, free/total), removing the `wmic` / `Get-Volume` shell-reach.
- `registry_key` — create and delete registry keys natively, removing the `reg add` / `reg delete` shell-reach.
- `list_firewall_rules` — enumerate Windows Firewall rules natively, removing the `netsh` shell-reach.
- `manage_task` — create and delete scheduled tasks natively, removing the `schtasks` shell-reach.
- `power_state` — lock, log off, restart, shut down, sleep, and hibernate natively (OS-gated, confirmation-required), removing the `shutdown.exe` / PowerShell shell-reach.
- `set_display` — change resolution, orientation, and refresh rate via `ChangeDisplaySettingsEx`.
- `wait_responsive` — probe a hung window via a `WM_NULL` send (FlaUI `Wait.UntilResponsive` parity).
- `list_adapters` and `list_connections` — native network adapter and TCP/UDP enumeration (with owning PID) via `@bun-win32/iphlpapi`, removing the `ipconfig` / `netstat` shell-reach.
- Realize virtualized WinUI3 list items so modern virtualized lists become drivable.
- `hold_key` can hold a key chord (e.g. Control+Shift+A), not just a single key; drag strokes support multiple waypoints and held modifiers (Ctrl+drag, lasso/curve) and preserve full OpenAI computer-use drag polylines.

### Changed
- `manage_window` gains `topmost` and `set_opacity` (background-capable window-state controls).
- `process_info` now reports the on-disk image path, command line, and working directory (ntdll PEB walk).
- `control_service` can read a service's config (start type, binary path, account) and reports an accurate already-running / already-stopped state instead of a misleading access-denied error.
- Library `launch()` resolves Store-aliased apps via a `ShellExecuteW` fallback.

### Fixed
- Size the firewall `IEnumVARIANT::Next` out-VARIANT to 24 bytes (x64), fixing an 8-byte native heap out-of-bounds write per rule.
- Release in-flight COM proxies on throw paths across three collection walks, and release the D3D11 device / context / factories (and apartment) when WGC `ensureBundle` partially initializes.
- Close WinRT capture objects (`IClosable::Close`), stopping a per-capture USER-object and handle leak.
- Validate drag-stroke modifier names before pressing, preventing a stuck key on a bad name.

### Security
- Mask the `registry_set` `data` payload in the audit and trace journals.
- Disclose the foreground-steal side effect across the click, double-click, `select_option`, and `semantic_click` paths on classic own-HWND controls (parity with the invoke / toggle / set-value verbs).

## [1.10.1] - 2026-06-19

### Changed
- Document the native OS-control pillar in the README and sync `server.json` environment-variable docs with `mcp.ts`.

## [1.10.0] - 2026-06-19

### Added
- 22 native OS-control tools (61 → 83 tools), all direct FFI with no shell-out:
  - **Processes** — `process_info`, `manage_process` (suspend / resume / reprioritize), `kill_process`, `current_user`, `system_resources`.
  - **Services** — `list_services`, `control_service` over the native Service Control Manager.
  - **Registry** — `registry_get`, `registry_list`, confirm-gated `registry_set`.
  - **Scheduled tasks** — `list_scheduled_tasks` via a native COM Task Scheduler walk.
  - **Environment variables** — `get_env`, `set_env` across user / machine scopes.
  - **Event log** — `read_event_log`.
  - **Displays** — `get_displays` (resolution, refresh rate, color depth, topology).
  - **Filesystem** — `stat_path`, `make_dir`, `copy_file`, `move_file`, `delete_file`, sandbox-confined.
- `system_status` and `hover` tools.
- Auto-wait for `ENABLED` (not just present) in `find_and_act`, matching Playwright actionability.
- `toggle {state}` to set a checkbox / switch to a known state idempotently.
- `read_table {startRow}` paging for large grids; `wait_for {ref}` and `wait_for_process {gone}`.
- Per-word `click_point` centre from `ocr` on multi-word lines.
- Attach-miss steering toward `list_windows` with candidate suggestions, and owned-dialog parent breadcrumbs.

### Fixed
- Harden `kill_process` with exact image-name matching plus self / host exclusion.
- Stage a real MOVE drop effect for `copy_files {move}` (previously a silent copy-as-move).
- Recover registry value names larger than 16 KB instead of corrupting them.
- Floor `system_resources` sampling to 50 ms so sub-tick windows no longer report a misleading 0% CPU.
- Stop `wait_for_process {gone}` from reporting an elevated / access-denied process as gone.

### Security
- Keep secret environment-variable and registry values out of the trace journal.
- Replace silent file-operation data loss with steered errors and opt-in overwrite.

## [1.9.3] - 2026-06-18

### Changed
- Rename all `SKRY_*` environment variables to `UMBRIEL_*`.
- Refresh the npm README (banner, highlights table, token-first benchmark comparison).

## [1.9.1] - 2026-06-18

### Changed
- Finish the **skry → umbriel** rename and claim the `umbriel` npm name.
- Group source modules into concern folders (`com`, `element`, `input`, `capture`, `desktop`, `agent`).
- Add a standalone `release-check` gate; fix `SERVER_INFO` version drift and the MCP manifest (`mcpName`, stale subfolder).

## [1.9.0] - 2026-06-17

### Changed
- Extracted `@bun-win32/uia` + `bun-uia` from the [bun-win32](https://github.com/ObscuritySRL/bun-win32) monorepo into this standalone, single-package repository, first published to npm as **`skry`** — the same desktop-automation surface (UIA tree, synthetic input, capture + OCR, Spy++ introspection, computer-use adapter, stdio MCP server), now shipping as one zero-native-dependency package over `bun:ffi`.

### Fixed
- `Element.release()` / `Window.dispose()` are idempotent, closing a use-after-free double-`Release()` segfault. (The `CacheRequest` analog of this fix arrived in 1.13.0.)

## [1.8.0] - 2026-06-17

### Added
- Selector enhancements: `index`/`last`/`controlTypes` locators, `has`/`hasText` structural filters, and region-scoped image locators for matching by on-screen picture.
- MCP `wait_for_state` assertions to block on a control reaching an expected state, plus a `BUN_UIA_TRACE` journal and a policy-refused audit trail.
- WGC cold-frame warming so the first background capture is not blank.

### Fixed
- MCP `serverInfo` reports the correct version (was stale at 1.6.4).
- Example teardowns force-kill Notepad by window PID, eliminating stray unsaved-changes save dialogs.

## [1.7.0] - 2026-06-17

### Added
- Java Access Bridge engine: read Swing/AWT trees (`java_tree`) and drive them cursor-free via `java_invoke` / `java_set_text`.
- Clipboard image support (`CF_DIB`) — copy a screenshot and read a copied picture — and file-drop write (`CF_HDROP`) via `copy_files` / `writeClipboardFiles`.
- Definitive virtual-desktop detection through `IVirtualDesktopManager`.

### Fixed
- Chromium/Electron web pages scroll cursor-free (fixes a silent no-op by posting the wheel to the host).

## [1.6.4] - 2026-06-17

### Added
- `inspect_element` surfaces `AcceleratorKey` / `AccessKey`, and `list_windows` flags DWM-cloaked windows (cold-tree steering is now cloak-aware).

### Fixed
- Details-view read-only cell echoes are pruned so file-dialog `Open`/`Cancel` survive the snapshot size cap.

## [1.6.3] - 2026-06-16

### Added
- Semantic-first `click` that prefers toggle/select over a coordinate hit, cursor-free triple-click, and slider range/read-only reporting.

## [1.6.2] - 2026-06-16

### Added
- `msaa_tree` carries `accLocation` coordinates, enabling a cursor-free `click_point` path for MSAA-only content.

### Fixed
- Refuse `press_key` copy/cut of a password field even when it has no own `HWND`, closing a credential leak.
- `launch_app` settles a cold WinUI/Store app and forces a final full render so late content lands in the launch snapshot.
- A failed or ambiguous re-attach no longer destroys the working attachment, and a below-cap change on a heavy window is no longer masked as "no UI change".

## [1.6.1] - 2026-06-16

### Fixed
- Correct MCP `serverInfo` version and add the `published-deps` release gate.

## [1.6.0] - 2026-06-16

### Added
- Cursor-free drag-select via posted mouse messages (`drag {select:true}`), horizontal scroll (`WM_MOUSEHWHEEL`), scroll-to-position, and cursor-free copy/cut/paste/undo for own-`HWND` Edits.
- New `focus`, `cut`, and `grid_cell` tools (act on a data-grid cell by row/column); `waitForGone` / `wait_for {gone:true}` for spinner/modal-dismissed gates.
- Discovery of owned and title-less popups — dropdowns, context menus, toasts, system-tray overflow, and modal dialogs that never grabbed the foreground — surfaced in `list_windows`.
- Cursor-free context menu via `IUIAutomationElement3::ShowContextMenu` with a posted right-click fallback, and `MultipleViewPattern` view switching (`list_views`/`set_view`).
- Snapshots surface disabled controls and signal when a container has off-screen content.

### Fixed
- `waitForWindow` no longer segfaults when the awaited window appears (deferred `JSCallback` teardown).
- Cursor-free correctness: clicks target the control's own window (occlusion-correct), epoch-stamped refs fail loud instead of mis-resolving, and dead-window/closing-action paths report honestly instead of looping on a cold-tree re-snapshot.
- Security hardening: enforce `BUN_UIA_CURSOR=never` across `click_point`/`click_text`/synthetic keys, withhold password values in reads, close an `open_path` command injection, and close FS-sandbox reparse-point/case-sensitivity escapes in `resolveFsPath`.
- The process is made per-monitor DPI-aware on `initialize()` for correct mixed-DPI multi-monitor coordinates.

## [1.5.0] - 2026-06-15

### Fixed
- `vcall` guards a null vtable or method pointer, so a use-after-free is a catchable error instead of a segfault.

## [1.4.0] - 2026-06-15

### Added
- Cursor-free Explorer navigation (Invoke-first open with `LegacyIAccessible.DoDefaultAction`) and `reveal()` to reach virtualized/off-screen list items by scroll-to-realize.
- See and drive Chromium/Electron web content (browsers, VS Code, Discord), plus in-document text find + select — the desktop `getByText`.
- OCR text recognition from raw pixels (`Windows.Media.Ocr`) with `click_point` and `click_text` (OCR a window and click the text that says X).
- Window/process event hooks (`SetWinEventHook`), cursor-free window snap (left/right/top/bottom/center), `read_table` GridPattern reads, and cursor-free multi-select.

### Fixed
- Safety floor for the GPU/accessibility engines: gate WGC/MSAA/D3D11, add null-pointer guards, dispose the WGC bundle, and clamp MSAA reads.

## [1.3.0] - 2026-06-14

### Added
- Drive-in-the-dark MCP surface: economical desktop snapshots with delta-diff, pruning, a size cap, and live `maxDepth`.
- WGC background/GPU capture (`Windows.Graphics.Capture`).
- MCP registry listing for the `bun-uia` server.

## [1.2.0] - 2026-06-14

### Added
- Container `ScrollPattern` for cursor-free scrolling and `GetClickablePoint` targeting.
- Clipboard read/write/paste/copy tools and an agent-loop example.

## [1.1.0] - 2026-06-14

### Added
- AI-control suite: a stdio MCP server, a computer-use adapter, cursor-free input, a Set-of-Marks overlay, full-screen capture with template matching, and a native `HWND` spy.

## [1.0.0] - 2026-06-13

### Added
- Initial release of `@bun-win32/uia` (with the unscoped `bun-uia` alias): a high-level Windows desktop-automation facade over UI Automation — `attach`/`waitFor`, `Window` and `Element`, and a typed hybrid selector (server-side conditions plus client-side filter).
- COM `vcall` invoker and activation, control-pattern wrappers (invoke, value/text, toggle, expand, select, range, window), and `SendInput`-based DPI-aware typing/keys/click.
- `CacheRequest`/`BuildCache` batching for one round-trip per subtree, tree-to-JSON agent grounding, `PrintWindow` screenshots, an oleacc MSAA fallback, and an agent tool-call adapter (JSON action-list executor + LLM tool schema).
