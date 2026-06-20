# Drive MS Paint (draw a picture) + a launch() Store-alias gap — 2026-06-20

User ask (vision/illustration): "open MS Paint and draw me a picture" — exercise the "drive ANY app to ANY end"
thesis end-to-end with umbriel's GENERAL input primitives.

## What umbriel CAN do here (proven live this session)

- **Launch Win11 Paint (a Store-aliased app).** `openPath('mspaint')` (Shell32.ShellExecuteW) resolves the App
  Execution Alias and launches the new Paint. ✓
- **Attach + introspect.** Attached the `MSPaintApp` top-level; it hosts the canvas in a WinUI island
  (`Microsoft.UI.Content.DesktopChildSiteBridge` → `InputSiteWindowClass`). Found the canvas viewport (a no-own-HWND
  `Pane`, ct=50033, screen rect ~{8,181,1584,625}). ✓
- **Select a tool cursor-free.** `element.invoke()` on the "Pencil" WinUI button selected it with no cursor/foreground. ✓
- **Stroke geometry computed** (house + sun + ground, normalized to the canvas rect) and the per-stroke draw path is
  ready (`dragTo` interpolated strokes).

## What blocked the actual pixels tonight (environmental, not an umbriel limit)

The WinUI canvas takes drawing only via **real-cursor SendInput** (it is a Chromium/WinUI-class surface that reads
GetCursorPos and **ignores posted WM_MOUSE moves** — documented in `input/coords.ts postDragToHwnd`, re-confirmed:
"Chromium/Electron/games that read GetCursorPos ignore posted moves"). So cursor-free posted drawing on the Paint
canvas is a WALL — the canvas needs the real cursor, which needs Paint FOREGROUND.

Tonight a **concurrent session was actively holding Discord (0x50bc2) foreground**, and a background automation process
cannot win the Windows foreground-lock (`raiseWindow` can't SetForegroundWindow from a non-foreground process). The
per-stroke foreground guard correctly **ABORTED** rather than leak strokes into Discord. So the drawing did not render —
purely because Paint could not hold the foreground on the shared desktop, not because umbriel lacks the capability.
When Paint can hold foreground (no contending session), the same script draws the picture (the mechanism — launch,
attach, tool-select, dragTo strokes — is all proven; only the foreground precondition was unmet).

LESSON: real-cursor acts (drawing/dragging on Chromium/WinUI/game canvases) are inherently foreground-gated; under a
contended desktop they must defer to whoever owns the foreground. The cursor-FREE umbriel paths (UIA invoke/toggle/
set_value, posted WM_* to classic own-HWND controls) remain background-capable; the GetCursorPos-reading surfaces do not.

## Real finding — `launch()` library fn can't launch Store-aliased apps (the MCP tool can) — candidate HARDEN

- `element/element.ts launch()` spawns ONLY via `Bun.spawn` (CreateProcess) — which does NOT resolve an App Execution
  Alias, so `umbriel.launch(['mspaint.exe'], …)` / `launch(['mspaint'])` FAILS for the new Paint (and any Store-aliased
  exe). Verified live: `Bun.spawn(['mspaint.exe'])` → "Executable not found in $PATH"; `['C:/Windows/System32/mspaint.exe']`
  → ENOENT (Win11 has no classic mspaint there).
- The MCP `launch_app` tool already handles this: it tries the `$PATH` spawn first, then **falls back to
  `openPath` (ShellExecuteW)** which resolves App-Paths + Store aliases (mcp.ts ~3426/3435). So the tool is correct; the
  **library `launch()` is the inconsistency** — it cannot launch Store apps, so examples/tests targeting them break.
- CANDIDATE (general, byte-shaped — owner/loop decision): give `launch()` the same ShellExecuteW fallback the MCP tool
  has (spawn → on no-window-appeared, `openPath(command)` → keep polling). General (helps every Store-aliased target),
  no new tool, no new binding (Shell32 already imported). Not yet shipped — flagged here for a fixer to pick up with a
  live test (launch the new Paint via the library fn, assert a window appears, close it).

## Constraints for future passes
- Cursor-free drawing on a Chromium/WinUI/game canvas (GetCursorPos surfaces) = WALL (posted WM_MOUSE ignored). Real
  cursor + foreground required. Don't re-attempt a posted-message draw on these surfaces.
- Drawing/real-cursor demos on a CONTENDED desktop are foreground-gated; not an umbriel defect.
