/**
 * Claude drives Windows — the computer-use agent loop
 *
 * Wires the Anthropic Messages API (the `computer_20251124` tool) directly to skry's computer-use
 * adapter so Claude autonomously operates a real Windows app. Each turn: Claude sees a screenshot of the
 * Calculator window and emits a pixel action; `dispatch` resolves that coordinate to the UIA element
 * under it and `invoke()`s it — SEMANTIC-FIRST and CURSOR-FREE (the real mouse never moves, works on a
 * locked session). The model thinks it is clicking pixels; skry grounds every click in the a11y tree,
 * erasing the coordinate-hallucination / downscaling-miss failure modes of screenshot-only control.
 *
 * Zero shipped dependency on @anthropic-ai/sdk — this example calls the Messages API with raw `fetch`.
 * Deterministic + self-verifying: it tasks Claude with "compute 5 + 3", then asserts the Calculator
 * display reads 8 via the UIA tree and exits non-zero on failure (so the example doubles as a live
 * integration test). Gated on ANTHROPIC_API_KEY — without a key it prints how to run and exits cleanly.
 *
 * APIs demonstrated:
 *   - skry.launch / attach / find (skry)   (spawn + attach + read ground truth from the a11y tree)
 *   - Window.screenshot / boundingRectangle         (PrintWindow PNG + window-local coordinate frame)
 *   - dispatch(window, ComputerAction)              (Anthropic computer action -> cursor-free UIA invoke)
 *   - Anthropic Messages API (computer_20251124)    (raw fetch tool-use loop; no SDK dependency)
 *
 * Run: ANTHROPIC_API_KEY=sk-... bun run example/agent-loop.ts
 */
import { ControlType, dispatch, skry } from 'skry';

const API_KEY = Bun.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-4-8';
const BETA = 'computer-use-2025-11-24';
const TOOL_TYPE = 'computer_20251124';
const MAX_ITERATIONS = 10;

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}
interface MessagesResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  error?: { message: string };
}

if (API_KEY === undefined) {
  console.log('\x1b[93mSKIP\x1b[0m  ANTHROPIC_API_KEY not set — this example drives Claude over the live Messages API.');
  console.log('      Run it with:  ANTHROPIC_API_KEY=sk-... bun run example/agent-loop.ts');
  process.exit(0);
}
const apiKey = API_KEY;

/** Map an Anthropic `computer` tool action (snake_case) to a skry ComputerAction (camelCase), translating
 *  the model's window-local screenshot coordinates into virtual-screen-absolute pixels for dispatch. */
function toComputerAction(input: Record<string, unknown>, originX: number, originY: number): Parameters<typeof dispatch>[1] {
  const action = typeof input.action === 'string' ? input.action : 'screenshot';
  const point = (value: unknown): [number, number] | undefined => (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number' ? [originX + value[0], originY + value[1]] : undefined);
  return {
    action,
    coordinate: point(input.coordinate),
    startCoordinate: point(input.start_coordinate),
    text: typeof input.text === 'string' ? input.text : undefined,
    scrollDirection: input.scroll_direction === 'up' || input.scroll_direction === 'down' || input.scroll_direction === 'left' || input.scroll_direction === 'right' ? input.scroll_direction : undefined,
    scrollAmount: typeof input.scroll_amount === 'number' ? input.scroll_amount : undefined,
    duration: typeof input.duration === 'number' ? input.duration : undefined,
  };
}

async function callClaude(messages: object[], displayWidth: number, displayHeight: number): Promise<MessagesResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': BETA, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: 'You operate a Windows desktop through screenshots and mouse/keyboard actions. Act one step at a time and take a screenshot to verify each result. Be concise.',
      tools: [{ type: TOOL_TYPE, name: 'computer', display_width_px: displayWidth, display_height_px: displayHeight, display_number: 1 }],
      messages,
    }),
  });
  const data: MessagesResponse = JSON.parse(await response.text());
  if (!response.ok) throw new Error(`Messages API ${response.status}: ${data.error?.message ?? JSON.stringify(data)}`);
  return data;
}

const calc = await skry.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
const shot = (): { png: Uint8Array; width: number; height: number; x: number; y: number } => {
  const rect = calc.boundingRectangle;
  return { png: calc.screenshot(), width: rect.width, height: rect.height, x: rect.x, y: rect.y };
};

const first = shot();
const messages: object[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'This is the Windows Calculator. Use it to compute 5 + 3 by clicking the buttons (5, then +, then 3, then =). Take a screenshot to confirm the display shows 8, then stop.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(first.png).toString('base64') } },
    ],
  },
];

console.log(`\x1b[96mClaude drives Calculator\x1b[0m  (${MODEL}, ${TOOL_TYPE}, ${first.width}x${first.height})`);
for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
  const frame = shot();
  const response = await callClaude(messages, frame.width, frame.height);
  messages.push({ role: 'assistant', content: response.content ?? [] });

  for (const block of response.content ?? []) {
    if (block.type === 'text' && block.text) console.log(`  \x1b[2mClaude:\x1b[0m ${block.text.trim().slice(0, 120)}`);
  }
  if (response.stop_reason !== 'tool_use') break;

  const toolResults: object[] = [];
  for (const block of response.content ?? []) {
    if (block.type !== 'tool_use' || block.id === undefined) continue;
    const action = toComputerAction(block.input ?? {}, frame.x, frame.y);
    const result = await dispatch(calc, action);
    console.log(`  \x1b[94maction:\x1b[0m ${action.action}${action.coordinate ? ` @${action.coordinate}` : ''} -> ${result.output ?? (result.ok ? 'ok' : result.error)}`);
    const after = shot();
    toolResults.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: [
        { type: 'text', text: result.ok ? (result.output ?? 'done') : `error: ${result.error}` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(after.png).toString('base64') } },
      ],
      is_error: result.ok ? undefined : true,
    });
  }
  messages.push({ role: 'user', content: toolResults });
}

const display = calc.find({ automationId: 'CalculatorResults' });
const reading = display?.name ?? '';
display?.release();
const passed = /\b8\b/.test(reading);
console.log(`\n${passed ? '\x1b[92mPASS\x1b[0m' : '\x1b[91mFAIL\x1b[0m'}  Calculator display: ${JSON.stringify(reading)}`);
calc.dispose();
skry.uninitialize();
process.exitCode = passed ? 0 : 1;
