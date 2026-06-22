/**
 * serialize-leak — a fault mid-walk in tree.ts serialize() must not leak COM refs. Unlike refmap.ts snapshot()
 * (which defers every release to a top-level owned[] catch), serialize() releases each child INLINE after its
 * sub-walk — so a throw between a child's materialization (firstChildCached / nextSiblingCached) and its inline
 * release() orphans that child (plus one in-flight child per recursion level). The vcall guards turn a torn-down
 * tree's use-after-free into a catchable THROW, so this is reachable: serialize() runs on every waitForIdle poll
 * (idle.ts) and every agent groundingTree (agent.ts), so a long-lived MCP server polling a tearing-down window
 * would leak per poll. The fix wraps the walk() recursion AND nextSiblingCached in a try that releases the
 * in-flight child before re-throwing.
 *
 * Proof: instrument Element — count release() calls and children materialized via firstChildCached /
 * nextSiblingCached (the path serialize() uses), inject a throw mid-walk, then assert releases >= materialized
 * (every AddRef'd child was released). Mirrors snapshot-leak.integration.test.ts, but targets serialize().
 *
 * bun test is broken repo-wide for FFI; runnable harness (Notepad):
 * Run: bun run example/serialize-leak.integration.test.ts
 */
import { CacheRequest, closeWindow, Element, serialize, umbriel } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
let notepad = 0n;
const prior = new Set(umbriel.windows().filter((w) => /Notepad/i.test(w.className)).map((w) => w.hWnd));
Bun.spawn(['notepad.exe'], { stdout: 'ignore', stderr: 'ignore' });
for (let attempt = 0; attempt < 40 && notepad === 0n; attempt += 1) {
  await Bun.sleep(150);
  notepad = umbriel.windows().find((w) => /Notepad/i.test(w.className) && !prior.has(w.hWnd))?.hWnd ?? 0n;
}

const proto = Element.prototype;
const releaseDescriptor = Object.getOwnPropertyDescriptor(proto, 'release');
const firstChildDescriptor = Object.getOwnPropertyDescriptor(proto, 'firstChildCached');
const nextSiblingDescriptor = Object.getOwnPropertyDescriptor(proto, 'nextSiblingCached');
const controlTypeDescriptor = Object.getOwnPropertyDescriptor(proto, 'cachedControlType');
let releases = 0;
let materialized = 0;
let armed = false;
let controlTypeReads = 0;
const THROW_AT = 6; // mid-tree: after a few nodes are walked, so the unfixed code would orphan the in-flight child

try {
  assert(notepad !== 0n, 'launched Notepad');
  if (notepad !== 0n) {
    await Bun.sleep(500);
    const win = umbriel.attach(notepad);
    Object.defineProperty(proto, 'release', { configurable: true, value() { if (armed) releases += 1; return releaseDescriptor!.value.call(this); } });
    Object.defineProperty(proto, 'firstChildCached', { configurable: true, value(request: CacheRequest) { const child: Element | null = firstChildDescriptor!.value.call(this, request); if (armed && child !== null) materialized += 1; return child; } });
    Object.defineProperty(proto, 'nextSiblingCached', { configurable: true, value(request: CacheRequest) { const child: Element | null = nextSiblingDescriptor!.value.call(this, request); if (armed && child !== null) materialized += 1; return child; } });
    Object.defineProperty(proto, 'cachedControlType', { configurable: true, get() { if (armed && ++controlTypeReads === THROW_AT) throw new Error('injected mid-walk fault'); return controlTypeDescriptor!.get!.call(this); } });

    armed = true;
    let threw = false;
    try {
      serialize(win, { maxDepth: 25 }); // plain JSON tree — nothing to dispose; the fault must still release every materialized child
    } catch {
      threw = true;
    }
    armed = false;

    assert(threw, `injected a fault mid-walk (controlType read #${THROW_AT})`);
    assert(materialized > 0, `serialize materialized children before the fault (${materialized})`);
    assert(releases >= materialized, `every materialized child was released — no leak (releases ${releases} >= materialized ${materialized})`);
    win.dispose();
  }
} finally {
  if (releaseDescriptor) Object.defineProperty(proto, 'release', releaseDescriptor);
  if (firstChildDescriptor) Object.defineProperty(proto, 'firstChildCached', firstChildDescriptor);
  if (nextSiblingDescriptor) Object.defineProperty(proto, 'nextSiblingCached', nextSiblingDescriptor);
  if (controlTypeDescriptor) Object.defineProperty(proto, 'cachedControlType', controlTypeDescriptor);
  if (notepad !== 0n) closeWindow(notepad); // cursor-free WM_CLOSE (no unsaved changes — nothing typed); dispose≠close
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a fault mid-walk in serialize() releases every materialized child (no COM leak).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
