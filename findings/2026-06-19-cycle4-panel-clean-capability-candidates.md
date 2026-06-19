# Cycle 4 — fresh panel: in-scope dimensions CLEAN; 2 owner-decision capability candidates

Spawned a fresh focused panel (live-proof-required; independently verified). Result: no in-scope actionable
defect. The only output is a prioritized capability-gap list for the maintainer (Panel B's job) — adding any
of these is a NEW FEATURE, which AGENTS.md reserves for the owner (no unrequested abstractions), so they are
documented, NOT built autonomously.

## Critic seats — CLEAN (with evidence)

- **Perf (Chandrasekaran):** nothing material. Hot paths already optimized — module-scoped scratch buffers,
  scalar-VARIANT fast path (skips VariantClear for ~94% of cached reads), regex memoization, compile-once
  waitFor, one-round-trip FindAllBuildCache prefetch. Bench: snapshot ~660 µs/node (FFI-dominated, not
  allocation), diff 0.31 ms for a 500-item list (not O(n^2) in practice). No surgical win.
- **Agent-ergonomics (Vasquez):** ~60 tool descriptions + ~80 error messages reviewed; all accurate, with
  actionable steers, disclosed preconditions (cursor-free limits, ⚠ foreground-steal), and no silent failures
  or misdirecting errors. No surgical message/doc fix found.
- **Code-hygiene (direct):** `bunx tsc --noEmit` exit 0; `bunx biome format .` exit 0 (no tracked source would
  change). Clean.
- **Segfault-safety / slot coverage (direct):** re-ran `slot-gate.test.ts` — 104 UIA + 22 WGC/MSAA/D3D11 + 18
  OCR = 144 vtable slots verified against the SDK headers, **0 not-in-header, 0 mismatched**, with the two-way
  drift guard green (every called slot gated, every gated slot called); 16 pass / 0 fail. The goal's "extend
  slot-gate" mandate is already satisfied — every SLOT entry is verified; there is no uncovered slot to add.

## Owner-decision capability candidates (Panel B — flagged, NOT built)

Both are UIA patterns enum-defined in `com/constants.ts` but with no wrapper in `element/patterns.ts` (verified
by grep). Both are standard COM vtable invokes — NO new `@bun-win32` FFI binding required. Adding either is a
maintainer call (new tool + facade method = unrequested feature per AGENTS.md "Never Do").

1. **DockPattern** (`PatternId.Dock = 10011`, constants.ts:117) — MODERATE value. Rivals (FlaUI
   `Patterns.Dock.SetDockPosition`/`DockPosition`) expose it. Unblocks: dock/undock a floating pane to an edge
   in an IDE / pro tool (Visual Studio, Notepad++). MS Learn: IUIAutomationDockPattern (get_CurrentDockPosition,
   SetDockPosition). Workaround today: TransformPattern move + bounds math (approximate).
2. **TableItem (10013) + Spreadsheet/SpreadsheetItem (10026/10027)** — LOW value. Cell-level metadata
   (row/column headers, merged cells, formula state) beyond what GridPattern's `read_table`/`grid_cell` already
   give (those cover ~95% of real grid/Excel automation: iterate rows/cols, read/edit/select a cell). Niche.

## Bottom line

Cycle 4 adds no product change — correctly. Perf/ergonomics/hygiene are clean with evidence; the only genuine
"missing" items are owner-decision features. Combined with cycles 1-3 (zero product bugs, four disproven
"bugs"/dead-ends, 7 real test/doc fixes shipped), the conclusion is firm: the product is in excellent shape.
The open decisions for the maintainer remain: (a) the 5 Notepad-coupled tests' strategy, (b) `SERVER_INFO`
version sync (1.9.0 → 1.9.3), and now (c) whether to implement Dock / TableItem-Spreadsheet patterns.
