# AGENTS

Rules for working in **skry** — Playwright for the Windows desktop, from [Bun](https://bun.sh). A single, zero-native-dependency package that drives and tests native Windows GUIs through the UI Automation accessibility tree (find by name, invoke, type, assert), plus synthetic input, full-screen capture + image matching, native-window introspection (Spy++-style), an LLM computer-use adapter, OCR, and a stdio **MCP server**. No node-gyp, no prebuilt binaries, no sidecar process. Follow these rules exactly.

skry is pure TypeScript over [`bun:ffi`](https://bun.sh/docs/api/ffi). It does not bind any DLL itself — it consumes the published `@bun-win32/*` FFI binding packages (`core`, `user32`, `oleacc`, `combase`, `kernel32`, `gdi32`, `shell32`, `shcore`, `oleaut32`, `advapi32`, `dwmapi`, `d3d11`) as ordinary pinned npm dependencies, and composes them into a high-level desktop-automation API.

> skry was extracted from the `bun-win32` monorepo (formerly `@bun-win32/uia` + `bun-uia`) into its own standalone repo and unscoped npm package. The FFI layer it stands on still lives in `@bun-win32/*`; only the product is standalone.

---

## Core Principles

- **Plan before implementing.** Read and understand the problem, the existing code, and the surrounding context before writing anything. Do not guess at what code does — read it.
- **No fabrication — verify every claim.** This drives a real OS through real accessibility and input APIs. Never guess a signature, HRESULT, pattern id, or nullability. Verify against the Microsoft Learn docs page and the upstream `@bun-win32/*` binding. Incorrect FFI usage segfaults; incorrect information is worse than none. If you do not know, say so.
- **Minimal, surgical diffs.** Change only what the task requires. Do not "clean up," reformat, or refactor code you were not asked to touch.
- **No premature abstraction.** No helpers, wrappers, or utilities unless explicitly requested. Keep the public facade thin.
- **Verify at every step.** After every meaningful change, prove it works: run the file (`bun run …`), type-check (`bunx tsc --noEmit`), and run the relevant example/test. Do not pile changes on a broken state.
- **Safety is load-bearing.** The MCP server exposes this machine to an LLM. Capability profiles, credential redaction, and the cursor-free input paths are security features — never weaken them to make a demo pass.

---

## Repository Layout

skry is a **flat single package** (the repo root *is* the package), not a monorepo.

```
index.ts            the public surface: `export const skry = { … }` facade + re-exports of every module
mcp.ts              the stdio MCP server (the `skry` bin); ~3.3k lines, the largest single file
automation.ts       IUIAutomation lifecycle (initialize/uninitialize/automation/trueCondition)
element.ts          Element + Window classes (attach, find, act, type, focus, …)
condition.ts        selector compilation + matching
constants.ts        ControlType / PatternId / PropertyId / TreeScope / SLOT …
patterns.ts         UIA control-pattern wrappers (invoke, toggle, scroll, grid, transform, …)
com.ts reads.ts     COM vtable invoker (vcall), BSTR/VARIANT/HANDLE/RECT decoders
input.ts coords.ts  synthetic + cursor-free input; DPI-aware coordinate mapping
screen.ts match.ts marks.ts   capture, image/color matching, set-of-marks overlay
wgc.ts png.ts       Windows.Graphics.Capture background capture; pure-TS PNG encoder
ocr.ts              Windows.Media.Ocr text recognition
refmap.ts tree.ts diff.ts   agent-facing snapshot/grounding tree + structural diff
events.ts idle.ts desktop.ts window.ts spy.ts   window/event watchers, virtual desktops, Spy++ introspection
msaa.ts jab.ts      MSAA (oleacc) + Java Access Bridge fallbacks
cache.ts clipboard.ts computer.ts agent.ts safety.ts   cache requests, clipboard, computer-use adapter, agent loop, redaction/audit
example/            runnable demos + in-example integration tests (≈200 files)
AI.md README.md server.json   binding/usage docs + MCP registry manifest
```

The single entry object is **`skry`** (`import { skry } from 'skry'`). Classes (`Element`, `Window`), enums, and free functions are also named exports from `index.ts`.

---

## Toolchain

- **Runtime: Bun.** Default to Bun in everything. Use Bun-native APIs (`Bun.file`, `Bun.write`, `Bun.env`, `Bun.argv`, `Bun.sleep`, `bun:test`, `bun:ffi`) over the `process.*`/Node equivalents. Never use `npm`, `yarn`, or `npx`.
- **Formatter: Biome** (`@biomejs/biome`, formatter only — linter and assist are disabled). Settings are fixed in `biome.json`: 2-space indent, **line width 240**, LF line endings; JS uses **single quotes**, **always semicolons**, **all** trailing commas, **always** arrow parens. Do not introduce Prettier or any other formatter/linter.
- **TypeScript: strict**, self-contained `tsconfig.json`: `strict`, `verbatimModuleSyntax`, `noImplicitOverride`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `types: ["bun"]`, `skipLibCheck`. (`noUncheckedIndexedAccess` is intentionally `false`.)
- **`bunfig.toml` pins `linker = "hoisted"`** so the IDE TS server sees `@types/bun` and the `@bun-win32/*` deps hoisted at the root.
- **No build step.** Sources are `.ts` and ship as `.ts`; Bun runs and publishes them directly (`"type": "module"`, `main`/`module`/`exports` all point at `.ts`).

### Commands

```bash
bun install                          # resolve @bun-win32/* deps from npm
bun run index.ts                     # smoke-test the package loads
bun run example/{file}.ts            # run a demo / integration test
bunx tsc --noEmit                    # type-check — must be zero errors before anything ships
bunx biome format --write .          # format
bun run mcp.ts                       # start the stdio MCP server locally
```

---

## FFI Binding Rules (inherited, non-negotiable)

skry does not declare new FFI symbols, but it calls into the `@bun-win32/*` bindings and decodes their buffers. The conventions still apply to every line that touches a pointer or handle:

- **`u64` (TS `bigint`)** for all handles (`HWND`, `HANDLE`, COM interface pointers, …), pointer-sized integers, and remote/opaque addresses. **NULL is `0n`**; check `=== 0n`.
- **`ptr` (TS `Pointer`)** for local buffers the caller allocates (`Buffer`/`TypedArray.ptr`), strings, by-ref structs, and callbacks. **NULL is `null`**.
- **Assemble structs immediately before the blocking call.** An `await` between building a `Buffer` and passing its `.ptr` can relocate the backing store and hand the native side a stale address — read `.ptr` inline at the call site, never cache it.
- **No type casts. Ever.** No `as any`, no `as unknown as T`. The only allowed narrowing is `!`, `BigInt()` (number → handle), and explicit annotations to break circular inference. Prefer `satisfies` over `as`.
- **CoInitialize before COM-backed calls.** `skry.initialize()` owns the apartment; COM pattern/OCR/WGC paths assume it has run.

---

## TypeScript Conventions

- Separate type-only imports with `import type`.
- Prefer `#privateField` syntax over the `private` keyword.
- Use explicit `void` when deliberately discarding a return value; honor `noImplicitOverride` with `override`.
- Never weaken type safety to make code compile. Prefer `unknown` + type guards over `any`.
- Full words, not abbreviations — except exact Win32 parameter names (`hWnd`, `lpBuffer`) where they cross the FFI boundary.

---

## The MCP Server

`mcp.ts` is the `skry` bin: a stdio Model Context Protocol server exposing the automation surface as tools. It is security-gated by environment variables — treat these as a contract:

- **`SKRY_PROFILE`** — capability profile: `readonly` (inspect/read only), `safe` (read + input + window — default), or `full` (also OS + filesystem tools).
- **`SKRY_OS`** — `1` to allow OS-level tools (`launch_app`, `run_program`, `open_path`) and filesystem tools regardless of profile.
- **`SKRY_ALLOW` / `SKRY_DENY`** — comma-separated tool names/categories to add or remove on top of the profile (deny wins).
- **`SKRY_CURSOR`** — `never` to forbid the real-cursor fallback entirely (strictly cursor-free).
- **`SKRY_FS_ROOT`** — sandbox root that `read_file`/`write_file`/`list_dir` are confined to.
- **`SKRY_TRACE` / `SKRY_AUDIT` / `SKRY_REDACT`** — journaling and credential-masking controls.

Credentials (password fields, secret-typed input) are redacted and never journaled. Do not add a tool or code path that bypasses redaction or the profile gate. `server.json` is the MCP-registry manifest; keep its env-var docs in sync with `mcp.ts`.

---

## Examples / Tests

- **Examples live in `example/`.** Two flavors: `*.ts` demos (creative + professional) and `*.integration.test.ts` in-example integration tests (the example *is* the test). Never a separate `test/` directory.
- **Use `bun:test`; add no other test framework.**
- **Tests that spawn windows MUST close them.** Any test that launches Calculator / Settings / Explorer / Notepad / Task Manager must `closeWindow()` them in a `finally` — `dispose()` is not `close()`. Leaking windows floods the user's desktop.
- **JSDoc header is mandatory** on every example: Title, Description, APIs demonstrated (bulleted), and a `Run: bun run example/{file}.ts` line.
- **Console rendering uses ANSI escape codes** via `console.log`/`process.stdout`, never `WriteConsoleW` (fails silently under ConPTY).
- **Verify visual/automation demos by observing real behavior**, not just a numeric assertion — a world-space or pixel count is easily fooled.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description` — lowercase, imperative, no trailing period. `type` ∈ `feat fix refactor docs test chore perf ci build style`. Commit or push only when asked.

---

## Releasing

skry publishes as the **unscoped `skry`** package and registers a server on the **MCP registry** as `io.github.ObscuritySRL/skry`.

```bash
bunx tsc --noEmit                    # gate: zero type errors
bun publish --access public --otp <code>   # unscoped, but pass --access public explicitly
# MCP registry: bump server.json version to match, then publish with mcp-publisher
```

- **Always `bun publish`, never `npm publish`.**
- **Pin `@bun-win32/*` deps to published versions** (caret ranges). Never reintroduce `workspace:*` — this repo has no workspace.
- **Keep `server.json` `version` in lockstep with `package.json`**, and `mcpName` (in `package.json`) equal to `server.json` `name`.
- The `skry` npm name and the MCP `identifier` must stay identical.

---

## Things to Never Do

- Add helpers/utilities, abstractions, or polyfills that were not requested.
- Use `as any` / `as unknown as T` or any cast that bypasses the type system — fix the types instead.
- Reintroduce `workspace:*`, a monorepo layout, or the `@bun-win32/uia` / `bun-uia` names.
- Weaken the MCP capability profiles, credential redaction, or cursor-free guarantees to make something pass.
- Cache a `Buffer.ptr` across an `await`.
- Use shortform variable names (except exact Win32 parameter names at the FFI boundary).
- Add new linters, formatters, or build tooling.
- Leave the codebase in a broken or unverified state.
