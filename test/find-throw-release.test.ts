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
