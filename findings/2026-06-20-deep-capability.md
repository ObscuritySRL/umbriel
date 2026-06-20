# Deep capability hunt — 8-seat fleet under the total-control mandate — 2026-06-20

The "don't coast on convergence" pass. After three harden convergences, an aggressive 8-seat capability-gap fleet
(live-prototyping, rival study, thesis stress-test) found 11 real wins the harden-focused passes missed. SHIPPED the
6 highest-value/lowest-risk; the rest are recorded with verified recipes (ready-to-ship) or declined with evidence.

## SHIPPED this pass (each live-proven + tested + gated)
- **`15fdb87` fix(capture/wgc): IClosable::Close** — CRITICAL. captureWindowLive leaked +1 USER object + ~14 handles
  per call (no Close() on the WinRT session/pool/frame/surface/item) → exhausts the 10k USER quota → crashes the
  long-lived MCP server on the headline background-capture path. closeAndRelease() each before Release. Measured: USER
  Δ +24→+0 over 24 captures. slot-gate: IClosable Close=6 header-verified.
- **`eedf544` feat(element/reveal): realize WinUI3 virtualized-list items** — CRITICAL capability. reveal() returned a
  found-but-UNREALIZED ghost ({0,0,0,0}, no pattern) and scrolled the non-scrollable List instead of its ScrollViewer
  Pane, so the AI could read but not click a deep row in Settings/Store/Photos/Xbox (the dominant modern UI). Fix:
  don't accept unrealized finds + fall back to the most-specific scrollable Pane. Live: item realized {0,0,0,0}→{336,123,842x69}.
- **`0c12227` feat(window): manage_window topmost + set_opacity** (+ fixed the false 'resize' action in the description).
  Always-on-top band + layered alpha on a background window (user32, no new binding). Rivals had these; umbriel didn't.
- **`e39cffb` feat(desktop/process): process_info image path** — QueryFullProcessImageNameW on the existing handle;
  disambiguates same-named processes without a shell.
- **`a8b61e8` feat(input/drag): dragStroke (multi-waypoint + modifiers)** — Ctrl+drag copy, Shift+constrain, lasso/curve;
  extends the existing drag tool ({path, modifiers}); finally-guarded key release.

## UPDATE — 2 more SHIPPED since the checkpoint
- **`147c000` feat(mcp/task): manage_task create/delete** — kills the schtasks shell-reach; extends tasks.ts ITaskService
  (NewTask@9/put_XmlText@20/RegisterTaskDefinition@17/DeleteTask@15, slot-gated vs taskschd.h); 83→84 tools; `xml` arg
  masked; live create+delete probe (no residue).
- **`5f5a0f9` feat(desktop/service): control_service config** — start-type/binary/account via QueryServiceConfigW
  (reuses readPackedWide); a new control_service action (no new tool); live on RpcSs.

REMAINING queue after these (each a fresh-context slice): **firewall read** (the riskiest — a net-new
desktop/firewall.ts with IEnumVARIANT COM enumeration + a new tool + a netfw.h slot-gate block; slots verified live
above), **TextChildPattern** (slots verified; needs an MCP-surface decision), **CUA drag-path un-flatten** (needs a
ComputerAction `path` field), **secondary click-chain disclosure** (route clickElement's raw toggle/select through the
now-existing disclosingPatternAct 4th-param). 7 of 11 deep-capability wins shipped; the 4 remaining are recorded with
verified recipes.

## READY-TO-SHIP queue (verified live by the fleet; each warrants its own careful slice — NOT yet built)
- **Scheduled-task CREATE/DELETE (kills the schtasks shell-reach — HIGH).** desktop/tasks.ts extend + a new manage_task
  tool. ITaskService COM, slots VERIFIED vs taskschd.h + full round-trip proven live (registered + deleted a probe task,
  every HRESULT S_OK): GetFolder@7, NewTask@9, Connect@10, DeleteTask@15, RegisterTaskDefinition@17, put_XmlText@20.
  put_XmlText keeps it general (caller composes the task XML). Mutates the system → test must create+delete+verify-gone
  in a finally; grows the tool count 83→84 (update tool-count.test.ts). Extend the slot-gate taskschd.h block.
- **Firewall rule READ (kills netsh — HIGH).** new desktop/firewall.ts (mirror tasks.ts) + a list_firewall_rules tool.
  INetFwPolicy2 COM, proven live (732 rules enumerated via umbriel's own vcall): CLSID_NetFwPolicy2
  {E2B3C97F-6AE1-41AC-817A-F6F92166D7DD}, get_Rules@18 → get_Count@7, get__NewEnum@11 → IEnumVARIANT::Next, per-rule
  INetFwRule get_Name@7/get_Protocol@15/get_LocalPorts@17/get_Direction@27/get_Enabled@33/get_Action@41. Pure read (no
  mutation). New FIREWALL_SLOT block + slot-gate vs netfw.h. Grows tool count 83→84.
- **Service CONFIG read (start-type / binary path / account).** desktop/services.ts extend via QueryServiceConfigW
  (advapi32, two-call sizing; QUERY_SERVICE_CONFIGW dwStartType@4, lpBinaryPathName@16, lpServiceStartName@48; decode
  with readPackedWide). Proven live (Spooler/BITS/Dnscache/wuauserv). Surface decision: a control_service action:'config'
  (os-gated) or a small read tool — pick the read-gated path since it's non-mutating.
- **TextChildPattern wrapper (leaf→document grounding — most prevalent unwrapped pattern, 1193 live).** patterns.ts
  textChildContainer/textChildRange, slots VERIFIED vs UIAutomationClient.h (get_TextContainer=3 line 10140,
  get_TextRange=4 line 10143; plain out-ptrs, no VARIANT, no segfault). Element methods + slot-gate. Needs an MCP
  surface (an inspect_element field or a small action) to actually reach the AI — design that before shipping.
- **CUA drag-path un-flatten (follow-on to a8b61e8).** input/computer.ts fromCuaAction discards path[] waypoints
  (keeps only first/last); needs a ComputerAction-type `path` field + dispatch → dragStroke. Deferred (type change).
- **Secondary parity: click cursor-free chain** (mcp.ts clickElement raw element.toggle()/select() report "(cursor-free)"
  with an undisclosed own-HWND steal) — now disclosingPatternAct's 4th-param + SELECT_STEAL_NOTE exist, route those two
  through them; needs a clickElement-fallback test. (From converge-2.)

## OWNER / binding gaps (re-confirmed — TODO.md territory, not buildable here)
- **Process COMMAND-LINE + cwd:** NtQueryInformationProcess has NO @bun-win32 binding (PEB walk proven via a last-resort
  dlopen probe; ReadProcessMemory IS bound). Owner: add @bun-win32/ntdll → then process_info gains commandLine/workingDir.
- **Network state (adapters/connections/routes):** iphlpapi/ws2_32 — no binding (already in TODO.md).

## DECLINED with evidence (re-confirm before re-proposing — STILL walls / below bar)
- DockPattern: slots header-verified but ZERO instances live on Win11 (custom IDockProvider only; a WinForms ToolStrip
  host exposed only LegacyIAccessible) → unprovable, ~0 targets. Transform+bounds remains the reach.
- TextEditPattern: 137/137 instances ALSO support plain Text → shipped readText/selectText already reach them; only IME
  composition (GetActiveComposition) is additive (niche).
- Drag/DropTarget patterns: read-only inspection (no programmatic drag-start in UIA); the drag ACT stays synthetic input.
- ItemContainer/VirtualizedItem FindItemByProperty: VARIANT-by-value SEGFAULTS uiautomationcore under Bun FFI
  (UIAutomationClient.h:9052) — scroll-reveal (now WinUI-fixed) is the replacement.
- OLE programmatic drag-DROP (SHDoDragDrop/IDataObject): segfault-prone in-proc vtable, not cursor-free, modal — files
  covered by copy_files+paste, in-app drops by the real-cursor dragTo. Reject.
- Clipboard history (Win+V), toast notification (needs a registered AUMID): bespoke single-purpose, async/fragile — reject.
- SetWindowDisplayAffinity (exclude-from-capture): own-process-only — FAILED cross-process live. Wall.
- Global hotkey (RegisterHotKey): structural mismatch with stateless MCP (no persistent message pump). Reject.
- Virtual-desktop move-window: IVirtualDesktopManager public MoveWindowToDesktop = E_ACCESSDENIED. Wall.

## Gates after the 6 ships: tsc 0; 48 unit tests pass; slot-gate 105+ slots (incl. IClosable Close=6), 0 mismatched.
