// Can a small on-device model actually call our tools?
//
// Every app declares agent tools and they are all DORMANT, because the models we ship
// cannot drive them (CLAUDE.md, convention 5). That claim was measured once, in a transcript,
// and then lived only in a comment on #77 — so it could not be re-run, and it could not be
// checked. This is that measurement, committed.
//
// It uses the PRODUCTION prompt and the PRODUCTION parser — `buildAgentSystemPrompt()` and
// `parseToolCall()` from src/lib/agentTools.ts — so a change to either changes the score. A
// harness that reimplements them would be measuring itself.
//
//   node --import tsx scripts/bench-agent-tools.mjs
//   node --import tsx scripts/bench-agent-tools.mjs --model onnx-community/Qwen2.5-0.5B-Instruct
//   node --import tsx scripts/bench-agent-tools.mjs --model X --native   # the model's own template
//   node --import tsx scripts/bench-agent-tools.mjs --json results.json
//
// (`--import tsx` because the harness imports the production TypeScript directly — the whole
// point is that it measures the shipped prompt and parser, not a copy of them.)
//
// Models are downloaded to the HF cache on first run (hundreds of MB) and run on CPU.

import { writeFileSync } from 'node:fs';
import { register } from 'node:module';

// The production app registry uses Vite's `import.meta.glob`, which Node does not have. That
// ONE module is redirected to a stub rebuilt from the real meta.ts files (bench-apps-stub.mjs).
// Everything under measurement — the prompt builder, the parser — is the shipped code.
register('./bench-loader.mjs', import.meta.url);

const { buildAgentSystemPrompt, parseToolCall } = await import('../src/lib/agentTools.ts');
const { DEFAULT_MODEL, supportsNativeTools, toFunctionSpecs } = await import('../src/lib/engines/kimtai.ts');

// ── the tools ────────────────────────────────────────────────────────────────
// Five real tools, taken from real apps, so the catalogue in the prompt is the size and shape
// the model would actually see.
const TOOLS = [
  {
    name: 'list_tasks',
    appId: 'tasks',
    appName: 'Tasks',
    description: 'List the user’s tasks. Use to answer any question about what they have to do.',
    parameters: { type: 'object', properties: { when: { type: 'string', enum: ['today', 'all'] } } },
  },
  {
    name: 'create_task',
    appId: 'tasks',
    appName: 'Tasks',
    description: 'Create a new task.',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'search_notes',
    appId: 'notes',
    appName: 'Notes',
    description: 'Search the user’s notes by keyword.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'list_clips',
    appId: 'clipboard',
    appName: 'Clipboard',
    description: 'List recently copied clipboard items.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'open_app_store',
    appId: 'system',
    appName: 'System',
    description: 'Open the App Store so the user can install an app.',
    parameters: { type: 'object', properties: {} },
  },
];

// ── the suite ────────────────────────────────────────────────────────────────
// Six turns a real user would take. `expect` is the tool that MUST be called; `args` is checked
// only where the answer is unambiguous.
const SUITE = [
  { prompt: 'what tasks do I have today?', expect: 'list_tasks' },
  { prompt: 'show me my todo list', expect: 'list_tasks' },
  { prompt: 'create a task called review the PR', expect: 'create_task', args: { title: /review the pr/i } },
  { prompt: 'add a task to buy milk', expect: 'create_task', args: { title: /milk/i } },
  { prompt: 'what did I copy recently?', expect: 'list_clips' },
  { prompt: 'find my notes about the invoice', expect: 'search_notes', args: { query: /invoice/i } },
];

// The failure that matters most. A model that answers "You have no tasks today" without ever
// calling the tool is worse than one that fails loudly: it is confidently lying to the user
// about their own data. Counted separately, because the pass rate alone hides it.
const CONFIDENT_LIE = /\b(you have no|there are no|you don't have any|no tasks|nothing (in|on) your)\b/i;

// ── run ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const model = arg('--model', DEFAULT_MODEL);
const native = argv.includes('--native');
const jsonOut = arg('--json', null);
const maxTokens = Number(arg('--max-tokens', 160));

if (native && !supportsNativeTools(model)) {
  console.warn(`WARNING: --native, but supportsNativeTools('${model}') is false. Measuring it anyway.`);
}

console.log(`\nmodel:    ${model}`);
console.log(`protocol: ${native ? 'native tool template' : 'prompt-based (our fallback)'}`);
console.log(`tools:    ${TOOLS.length}   suite: ${SUITE.length} prompts   greedy decoding\n`);

const { pipeline } = await import('@huggingface/transformers');
console.log('loading (first run downloads the weights)...');
const t0 = Date.now();
const generate = await pipeline('text-generation', model, { dtype: 'q4', device: 'cpu' });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const system = buildAgentSystemPrompt(TOOLS, {}, undefined, native);
const toolNames = TOOLS.map((t) => t.name);
const results = [];

for (const item of SUITE) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: item.prompt },
  ];
  const started = Date.now();
  const out = await generate(messages, {
    max_new_tokens: maxTokens,
    do_sample: false, // greedy: exactly what a tool turn does
    return_full_text: false,
    ...(native ? { tools: toFunctionSpecs(TOOLS) } : {}),
  });
  // With a chat-format input, generated_text comes back as the MESSAGE ARRAY, not a string.
  // Stringifying it gives "[object Object]" — which would parse as no-tool-call and score every
  // model 0/6 regardless of what it actually said. The reply is the last assistant message.
  const raw = out?.[0]?.generated_text;
  const text = Array.isArray(raw) ? String(raw.at(-1)?.content ?? '') : String(raw ?? '');
  const call = parseToolCall(text, toolNames);

  // parseToolCall returns { tool, arguments } — NOT { name }. Reading the wrong field scores
  // every model 0/6 no matter what it emitted, which is exactly the number this bench exists to
  // check. Read the shape the production parser actually returns.
  const calledRight = call?.tool === item.expect;
  const argsRight =
    !item.args || Object.entries(item.args).every(([k, re]) => re.test(String(call?.arguments?.[k] ?? '')));
  const pass = Boolean(calledRight && argsRight);
  const lied = !call && CONFIDENT_LIE.test(text);

  results.push({
    prompt: item.prompt,
    expected: item.expect,
    got: call?.tool ?? null,
    args: call?.arguments ?? null,
    pass,
    lied,
    ms: Date.now() - started,
    reply: text.slice(0, 240),
  });

  const mark = pass ? 'PASS' : lied ? 'LIED' : call ? 'WRONG' : 'NO CALL';
  console.log(`  [${mark.padEnd(7)}] ${item.prompt}`);
  console.log(
    `            expected ${item.expect}, got ${call ? `${call.tool}(${JSON.stringify(call.arguments)})` : '(no tool call)'}`,
  );
  if (!pass) console.log(`            reply: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
}

const passed = results.filter((r) => r.pass).length;
const lies = results.filter((r) => r.lied).length;
const noCall = results.filter((r) => !r.got).length;

console.log(`\n  score:              ${passed}/${SUITE.length}`);
console.log(`  no tool call:       ${noCall}/${SUITE.length}`);
console.log(`  confidently lied:   ${lies}/${SUITE.length}   <- the dangerous failure`);
console.log(
  `  median latency:     ${results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)]}ms\n`,
);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ model, native, passed, total: SUITE.length, lies, results }, null, 2));
  console.log(`  wrote ${jsonOut}\n`);
}
