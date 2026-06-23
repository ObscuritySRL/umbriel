import { expect, test } from 'bun:test';

// findFirstMatch()'s cached client-filter loop holds an array of AddRef'd COM element proxies and releases them
// as it walks. If a per-candidate cached read (readCachedProperties / subtreeMatches) vcall-throws the
// use-after-free guard (a candidate torn down between FindAllBuildCache and the read, on a fast-changing tree),
// the in-flight current proxy + the un-walked remainder must still be freed — the surrounding `finally` releases
// only the cache request. This is the same leak-on-throw class as fix ae54a76, at the one site it did not cover.
// The throw is a tree-timing race (not deterministically reproducible in a unit test), so pin the guard structurally.
const src = await Bun.file(`${import.meta.dir}/../element/element.ts`).text();
const start = src.indexOf('function findFirstMatch(');
const body = src.slice(start, src.indexOf('\nfunction ', start + 1));

test('findFirstMatch parsed', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('findAllCachedPointers'); // the cached client-filter loop is present
});

test('findFirstMatch frees the in-flight + remaining proxies on the throw path, and still releases the cache request', () => {
  expect(body).toContain('} catch (error) {'); // the throw-path handler exists
  expect(body).toMatch(/for \(let rest = index; rest < pointers\.length; rest \+= 1\) comRelease\(pointers\[rest\]!\)/); // releases current + remainder
  expect(body).toContain('throw error;'); // rethrows (does not swallow)
  expect(body).toContain('request.release();'); // cache request still freed in finally
});

// findAll() shares findFirstMatch's cached client-filter loop and the SAME leak-on-throw class — the find-ALL path
// must release the already-materialized matches AND the un-walked remainder when a per-candidate read throws, or every
// match accumulated so far leaks (the array never returns, so the caller cannot release it). Pinned structurally.
const findAllStart = src.indexOf('  findAll(selector: Selector');
const findAllCachedStart = src.indexOf('  findAllCached(selector');
const findAllBody = src.slice(findAllStart, findAllCachedStart);

test('findAll parsed (the cached client-filter path is present)', () => {
  expect(findAllStart).toBeGreaterThan(-1);
  expect(findAllCachedStart).toBeGreaterThan(findAllStart);
  expect(findAllBody).toContain('findAllCachedPointers');
});

test('findAll frees the materialized matches + the in-flight + remaining proxies on the throw path', () => {
  expect(findAllBody).toContain('} catch (error) {');
  expect(findAllBody).toContain('for (const element of result) element.release();'); // the matches already pushed
  expect(findAllBody).toMatch(/for \(let rest = index; rest < pointers\.length; rest \+= 1\) comRelease\(pointers\[rest\]!\)/); // current + un-walked remainder
  expect(findAllBody).toContain('throw error;');
  expect(findAllBody).toContain('request.release();'); // cache request still freed in finally
});

// findAllCached() fetches candidates lazily from pArray (no pre-materialized pointer array), so its un-walked remainder
// is freed by the existing comRelease(pArray); the leak-on-throw is the accumulated matches + the in-flight candidate
// currently being classified — guarded via the `pending` ref. Same class, pinned structurally.
const buildUpdatedStart = src.indexOf('  buildUpdatedCache(');
const findAllCachedBody = src.slice(findAllCachedStart, buildUpdatedStart);

test('findAllCached frees the materialized matches + the in-flight candidate on the throw path', () => {
  expect(findAllCachedStart).toBeGreaterThan(-1);
  expect(buildUpdatedStart).toBeGreaterThan(findAllCachedStart);
  expect(findAllCachedBody).toContain('} catch (error) {');
  expect(findAllCachedBody).toContain('if (pending !== 0n) comRelease(pending);'); // the candidate whose read threw mid-decision
  expect(findAllCachedBody).toContain('for (const element of result) element.release();'); // the matches already pushed
  expect(findAllCachedBody).toContain('throw error;');
  expect(findAllCachedBody).toContain('comRelease(pArray);'); // the element array (with the un-walked remainder) still freed in finally
});
