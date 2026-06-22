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
