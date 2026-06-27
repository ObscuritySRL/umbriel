import { expect, test } from 'bun:test';

// find_image and find_color are a documented paired cohort (their handlers share the identical `${region ? ' in
// region' : ' on screen'}` miss tail and the identical `— click_point {x,y} to act` hit tail). find_image's no-match
// errorResult names recovery next-steps ("… or screen_capture to see what is there"); find_color's named none, leaving
// an agent that finds no pixel with no actionable next step its sibling already provides. This pins find_color's miss
// to cohort parity — it must carry a recovery steer ending in the shared `screen_capture to see what is there` tail,
// faithful to find_color's own knobs (tolerance, region). The miss is an error path; the hit path is unchanged, so
// this is the same error-text-only class as the shipped capture-null / set_clipboard consistency fixes. Source-pinned
// (static handler text, no window), red-before / green-after.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('find_color no-match error carries a recovery steer (cohort parity with find_image)', () => {
  expect(mcp).toMatch(/find_color: no pixel within[^`]*— try a wider tolerance, a larger region, or screen_capture to see what is there/);
});

test('both find_* miss errors end in the shared recovery tail', () => {
  // find_image emits the tail at its all-match AND single-match miss branches; find_color now joins → 3 occurrences.
  expect((mcp.match(/screen_capture to see what is there/g) ?? []).length).toBe(3);
});
