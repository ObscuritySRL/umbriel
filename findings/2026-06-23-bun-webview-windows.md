# Bun.WebView on Windows: ERR_DLOPEN_FAILED, the fix already exists upstream (PR #30483), shelved for now — 2026-06-23

## Verdict (shelved, not abandoned)

`Bun.WebView` is **unusable on Windows in every Bun build available today** (tested through the newest canary
`1.4.0-canary.1+be6a664e8`). The headless-web capability it would give umbriel (an agent doing invisible web tasks —
log in with supplied creds, fill a form, buy something, scrape) is sound and on-mission, but it CANNOT be built or
verified here until Bun ships the fix. **No umbriel code was written for it.** Re-evaluate when the upstream fix lands
(see "Re-check trigger").

## What Bun.WebView actually is (the name misleads)

It is **headless browser automation** (Playwright-style: `navigate`/`evaluate`/`click`/`type`/`screenshot`/`scroll`/`cdp`),
NOT an embeddable desktop-GUI window (that's `webview-bun`/`bunview`/Tauri). On macOS it uses WebKit (WKWebView); on
**Windows/Linux it drives an installed Chrome/Chromium over the Chrome DevTools Protocol** — it requires a Chromium-family
browser, which is itself a tension with umbriel's "zero-native-dependency / no sidecar process" core. It implements BOTH
`Symbol.dispose` and `Symbol.asyncDispose` (so `await using view = new Bun.WebView()` is the intended lifecycle — the same
explicit-resource-management pattern umbriel itself uses for `Element`/`Window`/`Snapshot`/`CacheRequest`/`WindowWatcher`).
Shipped in Bun v1.3.12 (2026-04-10), flagged experimental.

## The bug

`new Bun.WebView('chrome')` — and the object form with `backend.path` or `BUN_CHROME_PATH` pointed at an installed
Chrome — fails immediately:

```
error: Failed to spawn Chrome (set BUN_CHROME_PATH, backend.path, or install Chrome/Chromium)
 code: "ERR_DLOPEN_FAILED"
```

**Diagnostic that pinpoints it:** pointing `backend.path` at a NONEXISTENT file gives the *identical* error. So the path
override never takes effect — the failure is a **native-backend dlopen** that happens BEFORE any browser is spawned. The
"install Chrome/Chromium" wording is misleading: Chrome IS installed (`C:\Program Files\Google\Chrome\Application\chrome.exe`,
confirmed) and there are Playwright Chromium caches under `%LOCALAPPDATA%\ms-playwright`; none are reached. `backend.type`
must be `"webkit"` or `"chrome"`; `"chrome"` is the only Windows option and it's the one that dlopen-fails.

**Reproduced on:** 1.3.12+700fc117a (issue #29367), 1.3.14-canary.1+fe735f8f0 (issue #30480), and **1.4.0-canary.1+be6a664e8**
(this machine, 2026-06-23, the latest canary — 166 commits past the prior local build). A commit-message scan of those 166
commits found NO WebView/Chrome/dlopen fix, and the empirical re-probe after upgrading confirmed: still broken.

## Root cause + the fix (already written, NOT merged)

- **Tracking issue: [#29102](https://github.com/oven-sh/bun/issues/29102)** (OPEN). `#29367` and `#30480` are closed as
  duplicates of it.
- **The fix: [PR #30483](https://github.com/oven-sh/bun/pull/30483)** (OPEN, not merged; branch
  `oven-sh:farm/0f707fcd/webview-chrome-windows`; +600/-81 across `src/runtime/webview/ChromeBackend.cpp`, `ChromeBackend.h`,
  `ChromeProcess.zig`, `test/js/bun/webview/webview-chrome.test.ts`). Per the maintainer-bot note it implements the Windows
  Chrome spawn path — two anonymous `uv_pipe` pipes, child inherits fds 3/4 via MSVCRT `lpReserved2` where Chromium's
  `DevToolsPipeHandler` reads them, parent drives I/O through libuv — and teaches `findChrome()` the Windows installer paths
  (Chrome stable/beta/dev/canary, Chromium, Brave, Edge) under `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LOCALAPPDATA%`,
  so `BUN_CHROME_PATH`/`backend.path` and auto-discovery all start working.
- **Why it isn't merged:** the PR is reportedly green on every lane that touches the chrome code; **Windows x64 CI is red on
  an unrelated pre-existing flake** (`test/js/bun/test/expect-assertions.test.ts` — expects 1 assertion, gets 0). It needs a
  maintainer to re-trigger / land it. That is exactly why even `be6a664` still throws.

**LESSON:** the misleading "install Chrome" error sent the whole first investigation chasing the browser path. The real
signal was the error CODE (`ERR_DLOPEN_FAILED`) — a native-library load failure inside Bun, not a missing browser. Read the
code, not the message.

## Our upstream actions (2026-06-23)

Posted as `ObscuritySRL`, with the owner's approval:
- Repro confirmation on the latest canary → https://github.com/oven-sh/bun/issues/29102#issuecomment-4784951238
- Land-it nudge on the fix PR → https://github.com/oven-sh/bun/pull/30483#issuecomment-4784951328

## Environment changes made this session (unrelated to umbriel source)

- Upgraded local Bun to **`1.4.0-canary.1+be6a664e8`** (the latest canary) via `D:\.bun\install.ps1`. Old binary backed up
  to `D:\.bun\bin\bun.exe.bak`.
- Pinned `D:\.bun\install.ps1` to canary-only (`$Version = "canary"` was already hard-set; removed the now-dead semver
  branch, added a comment). umbriel still passes on the new runtime: `tsc` clean, 113/113 unit tests.

## Re-check trigger — UPDATED 2026-06-27: PR #30483 is CLOSED (dead); watch issue #29102 instead

**Correction (2026-06-27).** PR #30483 is **closed, unmerged** — verified via the GitHub API
(`state=closed`, `merged=false`, `merged_at=null`, closed 2026-06-26). robobun closed it: it
*predates Bun's Rust rewrite and modifies Zig / `src/bun.js` sources that no longer exist on `main`
(now reorganized into `src/jsc`); it cannot merge and needs a from-scratch reimplementation against
the current tree.* Tracking issue **#29102 stays OPEN**. So the in-process headless path moved from
"imminent, one maintainer re-trigger away" to **indefinite — no PR in flight**. Empirical re-probe on
**Bun 1.4.0 (now stable, up from the canary above)** today: `new Bun.WebView(chrome)` still throws
`ERR_DLOPEN_FAILED`. STOP watching #30483; watch **#29102** for a NEW PR against the Rust/`src/jsc`
tree, and keep the `bun -e` `ERR_DLOPEN_FAILED` probe below as the empirical gate.

Re-probe with an isolated profile (Chrome single-instances otherwise — a bare launch hands off to a running Chrome and the
CDP port never opens):

```sh
TMP="$TEMP/umbriel-wv"; bun -e "
  await using v = new Bun.WebView({ backend:{ type:'chrome',
    path:'C:/Program Files/Google/Chrome/Application/chrome.exe', url:false, stderr:'ignore', stdout:'ignore',
    argv:['--user-data-dir=$TMP','--no-first-run','--no-default-browser-check'] } });
  await v.navigate('data:text/html,<h1 id=x>ok</h1>');
  console.log(await v.evaluate('document.getElementById(\"x\").textContent')); "
```

Today this prints `STILL FAILS: [ERR_DLOPEN_FAILED] ...`. When it prints `ok`, the fix has landed.

## Integration spec for when it works (so the future build is mechanical)

A gated, opt-in headless-web tool family in `mcp.ts`. The plumbing (verified this session):
- **Add tools** to the `TOOLS: McpTool[]` array (mcp.ts ~1562); shape is `{ name, category, description, inputSchema }`.
  Proposed: `web_navigate`, `web_evaluate`, `web_screenshot` (and maybe `web_read`). Add handlers to `HANDLERS` (mcp.ts ~2534).
- **Gate** behind a NEW high-privilege category (e.g. `'web'`) NOT in any default profile, requiring `UMBRIEL_ALLOW=web`
  (or fold into `'os'` so `UMBRIEL_OS=1` / `full` enables it). The arbitrary-URL + arbitrary-JS surface is an
  exfiltration/SSRF risk and must be opt-in. Profile map: `PROFILES` (mcp.ts ~238); enforcement: `toolAllowed()` (mcp.ts ~345).
- **Redact** all tool output through `redactSecrets()` (mcp.ts ~212); honor `UMBRIEL_AUDIT`/`UMBRIEL_TRACE` like other tools.
- **Lifecycle:** `await using view = new Bun.WebView(...)` per call (Bun.WebView is Symbol.asyncDispose-able), with an
  isolated `--user-data-dir`.
- **Housekeeping:** bump `package.json` `engines.bun` to the fixed version; update the counts in `test/tool-count.test.ts`
  (~15) and the README/AI.md tool tables; keep `SERVER_INFO.version` (mcp.ts ~169) in lockstep (release-check gates it).

## The capability we ALREADY have today (no Bun.WebView needed)

umbriel already drives browser/Electron web content via the UIA tree — `window.webRoots()` →
`snapshot(window, { extraRoots })` — cursor-free and in the BACKGROUND (no focus steal), proven in
`example/web-content.integration.test.ts` (read an input, `set_value` it, `invoke` a button, read the DOM update) and
`example/chromium-scroll.integration.test.ts` (AI.md:214). So "launch a browser, log in, click Buy" is achievable now
against a real (backgrounded) Chrome/Edge — the only thing Bun.WebView would add is TRUE headlessness (no window at all).
If true-headless is ever required before Bun lands #30483, the functional alternative is a minimal CDP client
(`Bun.spawn` chrome `--headless --remote-debugging-port` + drive the DevTools WebSocket from Bun) — but that reintroduces
a browser-subprocess dependency, the same departure from umbriel's no-sidecar core.
