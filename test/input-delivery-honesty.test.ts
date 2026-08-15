import { expect, test } from 'bun:test';

const input = await Bun.file(`${import.meta.dir}/../input/input.ts`).text();
const clipboard = await Bun.file(`${import.meta.dir}/../agent/clipboard.ts`).text();
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('every SendInput call goes through the exact-count delivery check', () => {
  const directCalls = [...input.matchAll(/User32\.SendInput\(/g)];
  expect(directCalls).toHaveLength(1);
  expect(input).toContain('if (inserted !== count) throw new Error');
  expect(input).toContain('SendInput inserted ${inserted}/${count} input events');
});

test('paste never injects Ctrl+V after a failed clipboard write', () => {
  const paste = clipboard.slice(clipboard.indexOf('export function paste('));
  expect(paste).toContain("if (!writeClipboard(text)) throw new Error('paste:");
  expect(paste.indexOf('if (!writeClipboard(text))')).toBeLessThan(paste.indexOf("sendKeys('Control+V')"));
});

test('verified rich-editor input tolerates accessible emoji aliases without trusting stale text', () => {
  expect(mcp).toContain(".split(/[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\uFE0F\\u200D]+/gu)");
  expect(mcp).toContain('if (actual === normalizedEditorText(beforeInput)) return false;');
  expect(mcp).toContain('editorContainsRequested(value, text, beforeInput)');
});

test('an empty controlled search field does not mistake its placeholder for content', () => {
  expect(mcp).toContain("return normalizedEditorText(text) === normalizedEditorText(element.name) ? '' : text;");
  expect(mcp).toContain('waitForEdit(element, timeoutMs, (value) => normalizedEditorText(value).length === 0)');
  expect(mcp).toContain('Search fields retain their query after Enter');
});
