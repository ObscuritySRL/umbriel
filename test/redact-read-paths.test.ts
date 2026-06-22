import { expect, test } from 'bun:test';

// Every on-screen read path must route its text through redactSecrets before it reaches the model — a
// secret-shaped token (AWS key / Bearer / JWT / PEM / high-entropy run) read off the screen is a leak into a
// persisted/loggable sink. act('read'), read_table, inspect_element's `value`, and read_clipboard already do.
// This pins the paths that fence-without-redacting: the OCR handler, inspect_element's TextPattern body, and
// click_text (which OCRs the same window pixels and echoes the matched + nearest words). (redactSecrets behavior
// itself is covered by the trace-redaction integration test; this guards the WIRING — that a future edit cannot
// silently drop the call on these paths.)
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('ocr handler redacts both the line text and per-word text', () => {
  expect(mcp).toContain('redactSecrets(line.text)');
  expect(mcp).toContain('redactSecrets(word.text)');
  // and never emits the raw OCR text unmasked into the row/word render
  expect(mcp).not.toContain('${line.text}`');
  expect(mcp).not.toContain('JSON.stringify(word.text)');
});

test('inspect_element TextPattern body is redacted (the sibling value line already is)', () => {
  expect(mcp).toContain('redactSecrets(value)'); // pre-existing sibling, sanity
  expect(mcp).toContain('const redacted = redactSecrets(text)'); // the newly-wired TextPattern body
});

test('click_text redacts the matched word and the nearest-words list (it OCRs the same pixels as the ocr tool)', () => {
  expect(mcp).toContain('JSON.stringify(redactSecrets(hit.text))'); // the matched-text echoes are masked
  expect(mcp).not.toContain('JSON.stringify(hit.text)'); // never the raw matched OCR text to the model
  expect(mcp).not.toContain('.map((word) => word.text)'); // the nearest-on-no-match list is masked too
});

test('the snapshot render chokepoint redacts — the most frequent on-screen read surface (every withSnapshot + desktop_snapshot)', () => {
  // a non-password Edit/combo/list-item holds a pasted key; nodeState emits its ValuePattern value, withholding only IsPassword.
  // renderTree is the single tree→string boundary, so masking there covers every snapshot caller (none can be missed).
  expect(mcp).toContain('capSnapshot(redactSecrets(renderSnapshot(');
});

test('find_text redacts the matched on-screen TextPattern text', () => {
  expect(mcp).toContain('found and selected ${JSON.stringify(redactSecrets(matched))}');
});

test('the snapshot DIFF fast-path + the MSAA / Java / native tree renderers redact too (the renderTree siblings)', () => {
  // a value-changing action (type/paste/set_value) returns the DIFF, not the full body — it re-emits value=/name and must mask
  expect(mcp).toContain('${redactSecrets(delta.text)}');
  expect(mcp).toContain('redactSecrets(formatMsaa(tree))'); // msaa_tree (legacy accName is on-screen text)
  expect(mcp).toContain('redactSecrets(renderJavaTree(tree))'); // java_tree + javaObservation (java_invoke/java_set_text)
  expect(mcp).toContain('redactSecrets(renderWindowTree('); // native_tree (window text)
});

test('the echoed control NAME is redacted (named() + act() target — a list/tree/text item name is on-screen text)', () => {
  expect(mcp).toContain('JSON.stringify(redactSecrets(element.name))'); // named() live path + act() target
  expect(mcp).toContain('JSON.stringify(redactSecrets(element.cachedName))'); // named() cached fast path
});

test('NO handler echoes a raw control name — every element/match/description/mark name reaching the model is redacted', () => {
  // negative pin: any future `JSON.stringify(<control>.name)` without redactSecrets is an on-screen-content leak.
  // (window.name = the window TITLE, app identity not field content, is intentionally NOT masked; node.name inside
  // formatMsaa is covered by the formatMsaa OUTPUT wrap at the msaa_tree handler, so it is excluded here.)
  for (const raw of ['JSON.stringify(element.name)', 'JSON.stringify(element.cachedName)', 'JSON.stringify(match.name)', 'JSON.stringify(description.name)', 'JSON.stringify(mark.name)', 'JSON.stringify(root.name)']) {
    expect(mcp).not.toContain(raw);
  }
  // the desktop_snapshot {root} scope HEADER is built OUTSIDE the renderTree chokepoint, so it masks the scoping control's name itself
  expect(mcp).toContain('scoped to ${JSON.stringify(redactSecrets(root.name))}');
});

test('the catch boundary redacts thrown error messages — a lib message can embed live control names (describeNoMatch)', () => {
  // formatNoMatch (element/condition.ts, a pure lib) renders up to 8 live candidate names into the no-match error;
  // redacting at the single dispatch catch covers it AND any future lib-thrown message that embeds on-screen content.
  expect(mcp).toContain('errorResult(redactSecrets(error instanceof Error ? error.message : String(error)))');
});

test('inspect_element redacts helpText and itemStatus (sibling on-screen strings to the masked value/text)', () => {
  expect(mcp).toContain('helpText: ${JSON.stringify(redactSecrets(helpText))}');
  expect(mcp).toContain('itemStatus: ${JSON.stringify(redactSecrets(itemStatus))}');
});
