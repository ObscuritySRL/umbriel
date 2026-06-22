import { expect, test } from 'bun:test';

// PowerGetActiveScheme LocalAllocs the active-scheme GUID and hands it back via the out-param; the caller MUST
// LocalFree it or every activePowerPlan() call (a system_status read an agent may poll) leaks 16 bytes. That leak
// is far below the JS-allocation noise floor of an RSS measurement, so it is pinned structurally here: the GUID
// read out of the scheme buffer must be released in a finally.
const src = await Bun.file(`${import.meta.dir}/../desktop/power.ts`).text();
const start = src.indexOf('export function activePowerPlan(');
const body = src.slice(start); // activePowerPlan is the last export in the file

test('activePowerPlan parsed', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('PowerGetActiveScheme');
  expect(body).toContain('PowerReadFriendlyName');
});

test('activePowerPlan frees the LocalAlloc-d scheme GUID in a finally', () => {
  const finallyIndex = body.search(/\}\s*finally\s*\{/);
  expect(finallyIndex).toBeGreaterThan(-1); // there IS a finally
  expect(body).toContain('Kernel32.LocalFree(schemeGuid)'); // and the GUID is freed
  expect(body.slice(finallyIndex)).toContain('Kernel32.LocalFree(schemeGuid)'); // the free sits in the finally, not the try body
});
