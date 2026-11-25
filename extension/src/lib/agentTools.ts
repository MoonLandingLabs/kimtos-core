// The KimtAI agent runtime: collect each installed app's declared `tools`, tell
// the model about them (a model-agnostic, prompt-based protocol), parse the tool
// call it emits, run the tool on-device, feed the result back, and loop until the
// model gives a plain-text answer.
//
// Tools are MCP-shaped and declared on each app descriptor:
//   tools: [{ name, description, parameters (JSON-Schema), needs?, run(args, ctx) }]
//   run(args, ctx) -> { ok, result: <string for the model>, summary: <short label>, artifact? }
//
// The LLM runs in the worker (createChat session); tools run here on the main
// thread (they use IndexedDB + the on-device engines). See kimtai/index.js.

import { apps } from '../apps/index.js';
import { parseToolCall, parseNativeToolCall, looksLikeToolCall, type NativeToolCall } from './toolCall.js';
import { isInstalled } from '../models/installed.js';
import { buildMessages, supportsNativeTools, toFunctionSpecs } from './engines/kimtai.js';

// --- Shapes ---------------------------------------------------------------

interface JsonSchema {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
}

export interface ToolResult {
  ok?: boolean;
  result?: string;
  summary?: string;
  artifact?: unknown;
}

export interface AgentCtx {
  openAppStore?: (id?: string) => void;
  attachment?: (kind: string) => unknown;
  [key: string]: unknown;
}

export interface AgentTool {
  name: string;
  description?: string;
  parameters?: JsonSchema;
  needs?: { attachment?: 'image' | 'audio' };
  appId?: string;
  run: (args: Record<string, unknown>, ctx: AgentCtx) => Promise<ToolResult> | ToolResult;
}

export interface Message {
  role: string;
  content: string;
}

interface AppDescriptor {
  id: string;
  name?: string;
  description?: string;
  tools?: AgentTool[];
}

// `apps` is auto-discovered from untyped app modules; view it through the subset
// of the descriptor this runtime cares about. Read it LAZILY (a getter, not a
// module-eval snapshot): an app module (e.g. kimtai) importing this file creates
// an import cycle, so `apps` can still be undefined when this module is evaluated.
// Reading at call time (after all modules load) always sees the full registry.
const appList = (): AppDescriptor[] => (apps as unknown as AppDescriptor[]) ?? [];

// How the agent should behave once it has tools — the "Claude Code"-style working
// posture: decisive, autonomous, tool-first, then a short confirmation. Shared by
// the native and prompt-based system prompts so behaviour is identical either way.
const AGENT_STYLE =
  'Act like an agent, not a chatbot: infer sensible defaults instead of asking, chain tools until the request is done, then confirm briefly. Never claim an action unless a tool result confirmed it. Keep replies short.';

// Every tool of every INSTALLED app, flattened + stamped with its app id.
export function availableTools(): AgentTool[] {
  return appList()
    .filter((a) => isInstalled(a.id))
    .flatMap((a) => (a.tools || []).map((t) => ({ ...t, appId: a.id })));
}

// Apps that declare tools but AREN'T installed yet — the agent has no access to
// them, but should tell the user and offer to install them.
function installableApps(): { id: string; name: string; description: string }[] {
  return appList()
    .filter((a) => !isInstalled(a.id) && (a.tools || []).length)
    .map((a) => ({ id: a.id, name: a.name || a.id, description: a.description || '' }));
}

// A built-in tool (not tied to any app; stamped appId 'system' so it stays out of
// the per-app catalog) that sends the user to the App Store to install an app the
// agent doesn't have access to. `ctx.openAppStore` is provided by the chat host.
const openAppStoreTool: AgentTool = {
  name: 'open_app_store',
  appId: 'system',
  description:
    "Open the App Store so the user can install an app you don't have access to yet. Call this when the user wants something only a not-installed app can do.",
  parameters: {
    type: 'object',
    properties: { app: { type: 'string', description: 'name or id of the app to install' } },
    required: [],
  },
  run: async (args, ctx) => {
    const want = String(args.app || '').toLowerCase();
    const info = installableApps().find((a) => a.id === want || a.name.toLowerCase() === want);
    ctx.openAppStore?.(info?.id);
    return {
      ok: true,
      result: info ? `Opened the App Store so the user can install ${info.name}.` : 'Opened the App Store.',
      summary: info ? `open store · ${info.name}` : 'open store',
    };
  },
};

// Built-in tools that are always available regardless of which apps are installed.
//
// There is no `web_search` here any more, and adding one back is a decision, not a patch.
// It sent a chat-derived query to a third party while the store listing promised "your data
// never leaves your browser" — undisclosed in both the README and the privacy page. It was
// unreachable in practice (the agent loop is dormant, and #637 made `https://*/*` optional
// so the fetch would have failed anyway), which meant the privacy page was honest by
// accident. Removed for the 0.5.0 resubmission (#885). If KimtAI is ever to search the web,
// it needs an explicit opt-in, a declared host permission and a disclosure — see #886.
export const systemTools: AgentTool[] = [openAppStoreTool];

// The system prompt: who KimtAI is + what kimtos is + what it can do through the
// installed apps (the tool catalog, grouped by app) + the strict call protocol.
export function buildAgentSystemPrompt(
  tools: AgentTool[],
  { hasImage, hasAudio }: { hasImage?: boolean; hasAudio?: boolean } = {},
  userSystemPrompt?: string,
  nativeTools = false,
): string {
  // Identity + system awareness. A user-set persona (from Settings/tune) leads.
  const identity = [
    'You are KimtAI, the private AI assistant built into Kimtos — a "developer home" that opens on every new browser tab, with a suite of small on-device apps.',
    'Everything runs entirely in the user’s browser on their device; nothing is ever uploaded or sent to any server. You are not a cloud model and have no external/internet tools — only the on-device app tools listed below.',
  ];
  const persona = (userSystemPrompt || '').trim();
  if (persona) identity.unshift(persona);

  // Split real app tools from built-in/system tools (e.g. open_app_store), and
  // gather the apps the user could install (whose tools we don't have access to).
  const appTools = tools.filter((t) => t.appId !== 'system');
  const hasStore = tools.some((t) => t.name === 'open_app_store');
  const installable = installableApps();

  // A compact note about apps that aren't installed — ONLY when the agent actually
  // has the open_app_store tool to offer them (i.e. tools are on). Otherwise it's
  // just noise. Names only, to keep the per-turn prompt small on weak models.
  const notInstalled =
    hasStore && installable.length
      ? [
          `Not installed (no access yet): ${installable.map((a) => a.name).join(', ')}.`,
          'If the user wants one of those, say it isn’t installed and call open_app_store (pass the app name) — don’t pretend.',
        ]
      : [];

  const media: string[] = [];
  if (hasImage) media.push('The user has attached an IMAGE.');
  if (hasAudio) media.push('The user has attached an AUDIO clip.');

  // No tools at all → plain chat (this is the v1 path: agent tools are gated off).
  // Use a clean chat identity that doesn't dangle a reference to (absent) tools.
  if (!appTools.length && !hasStore) {
    return [
      ...(persona ? [persona] : []),
      'You are KimtAI, a private AI assistant that runs entirely on the user’s device — nothing is uploaded. Be helpful, concise, and direct.',
    ].join('\n');
  }

  // Native mode: the model's own template renders the tool definitions (passed as
  // `tools`), so we DON'T restate a catalog or a hand-rolled JSON protocol — that
  // just confuses a function-calling model. Keep the system prompt lean.
  if (nativeTools) {
    return [
      ...identity,
      '',
      'You have tools available (provided to you as functions). When the user asks for something one of your tools can do — save a note, add a task, read an image, calculate, … — CALL the tool instead of describing it or asking follow-up questions you can infer. Chain tools when useful. If no tool fits, just answer. Never invent tools or claim external services.',
      AGENT_STYLE,
      ...notInstalled,
      ...(media.length ? ['', media.join(' ')] : []),
    ].join('\n');
  }

  // Group the installed tools under their app's real name so the model understands
  // what each app lets it do for the user.
  const appName = (id: string | undefined): string => appList().find((a) => a.id === id)?.name || id || 'app';
  const groups = new Map<string, AgentTool[]>();
  for (const t of appTools) {
    const name = appName(t.appId);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(t);
  }
  const catalog = [...groups.entries()]
    .map(([app, ts]) => {
      const lines = ts.map((t) => {
        const props = t.parameters?.properties || {};
        const required = t.parameters?.required || [];
        const params = Object.entries(props)
          .map(([k, v]) => `${k}${required.includes(k) ? '' : '?'}: ${v.type || 'string'}`)
          .join(', ');
        return `  • ${t.name}(${params}) — ${t.description}`;
      });
      return `${app} app:\n${lines.join('\n')}`;
    })
    .join('\n');

  // A concrete worked example — the strongest, cleanest way to get a small model to
  // actually emit a call (rather than describe what it would do). Pick a demo that
  // matches an installed tool so it's always valid.
  const has = (n: string): boolean => appTools.some((t) => t.name === n);
  const firstTool = appTools[0]?.name || tools[0]?.name || 'a_tool';
  const demo = has('create_note')
    ? {
        ask: 'Create a note called Ideas in a collection called Work',
        call: '{"tool": "create_note", "arguments": {"title": "Ideas", "collection": "Work"}}',
      }
    : has('create_task')
      ? {
          ask: 'Add "Buy milk" to my to-do list',
          call: '{"tool": "create_task", "arguments": {"title": "Buy milk"}}',
        }
      : has('calculate')
        ? {
            ask: "What's 15% of 240?",
            call: '{"tool": "calculate", "arguments": {"expression": "240 * 0.15"}}',
          }
        : { ask: 'do that', call: `{"tool": "${firstTool}", "arguments": { }}` };

  const lines = [...identity, ''];
  if (appTools.length) {
    lines.push(
      'You can DO things for the user by calling the tools of their installed Kimtos apps. These are your ONLY tools (grouped by app) — no others exist; never invent tools or claim external services:',
      catalog,
    );
  }
  lines.push(...notInstalled);
  if (media.length) lines.push('', media.join(' '));
  lines.push(
    '',
    'To call a tool, reply with ONLY a fenced block (no other text before or after):',
    '```tool',
    `{"tool": "${firstTool}", "arguments": { ... }}`,
    '```',
    `Example — when the user says "${demo.ask}", you reply with EXACTLY:`,
    '```tool',
    demo.call,
    '```',
    'You then receive a message beginning with [tool:<name>] containing the result; use it, then call another tool or answer in plain text.',
    'When a request maps to one of these tools, DO it by calling the tool — do not reply with a plan or questions when you already have enough to act. Chain tools when needed (e.g. read an image, then save the text as a note). One tool call per turn. If truly no tool fits, just answer in plain text.',
    AGENT_STYLE,
    'When the user asks who you are or what you can do, explain that you are KimtAI running privately in Kimtos and summarise the app capabilities above in plain language — do not make up features.',
  );
  return lines.join('\n');
}

// Loosely parse a tool's argument text into an object. Accepts real JSON, or a
// bare "key: value, …" list (quoting unquoted keys, single→double quotes).
// Merge consecutive same-role turns into one. The agent loop can legitimately append
// two user turns in a row (e.g. a tool result then a "just answer" nudge), but many
// chat templates (Qwen, Gemma, Mistral) reject non-alternating roles with
// "Conversation roles must alternate…". Coalescing keeps the transcript valid.
function coalesceRoles(msgs: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

export interface AgentStep {
  tool: string;
  ok: boolean;
  summary: string;
}

export interface AgentSession {
  send: (
    msgs: Message[],
    handlers: {
      onToken?: (token: string, acc: string) => void;
      onDone?: (text: string | null, toolCalls: NativeToolCall[] | null) => void;
      onError?: (e: unknown) => void;
    },
    opts?: Record<string, unknown>,
  ) => void;
}

export interface RunAgentOptions {
  session: AgentSession;
  history: Message[];
  systemPrompt?: string;
  model: string;
  tools: AgentTool[];
  ctx?: AgentCtx;
  genOpts?: Record<string, unknown>;
  mediaFlags?: { hasImage?: boolean; hasAudio?: boolean };
  onStream?: (acc: string) => void;
  onStep?: (info: { tool: string; args?: unknown; ok?: boolean; summary?: string; status: 'run' | 'done' }) => void;
  onFinal?: (text: string, steps: AgentStep[]) => void;
  onError?: (e: unknown) => void;
  maxSteps?: number;
  /**
   * Force the native (template `tools`) protocol on/off. Defaults to the model's
   * capability. Set false to use the model-agnostic prompt-based protocol even on
   * a "native" model — needed while Transformers.js's chat-template tool rendering
   * is unreliable (it throws on some templates).
   */
  nativeTools?: boolean;
}

export interface RunAgentResult {
  text?: string;
  steps?: AgentStep[];
  error?: unknown;
}

// Drive the agent: generate → (tool call → run → feed back → repeat) → final answer.
export async function runAgent({
  session,
  history,
  systemPrompt,
  model,
  tools,
  ctx = {},
  genOpts = {},
  mediaFlags = {},
  onStream,
  onStep,
  onFinal,
  onError,
  maxSteps = 5,
  nativeTools,
}: RunAgentOptions): Promise<RunAgentResult> {
  const byName = new Map<string, AgentTool>(tools.map((t) => [t.name, t]));
  const toolNames = tools.map((t) => t.name);
  // Native function-calling when the model's template supports it (Qwen/Llama): pass
  // the tools into the template and keep the system prompt lean. Otherwise fall back
  // to our prompt-based protocol (catalog + fenced-JSON). Callers can force the mode
  // via `nativeTools` (e.g. off, when the template's tool rendering is unreliable).
  const native = tools.length > 0 && (nativeTools ?? supportsNativeTools(model));
  const sys = buildAgentSystemPrompt(tools, mediaFlags, systemPrompt, native);
  // Tool turns want tight, well-formed output. A hot temperature makes a weak
  // (prompt-based) model ramble a description instead of emitting a call, so decode
  // GREEDILY (temperature 0) while deciding on a tool — deterministic and the best
  // for structured/JSON output. The plain-answer path keeps the user's setting.
  const toolGenOpts = tools.length ? { ...genOpts, temperature: 0 } : genOpts;
  const turnOpts = native ? { ...toolGenOpts, tools: toFunctionSpecs(tools) } : toolGenOpts;
  // The latest user request — lets us notice when the model role-plays an action
  // (answers as if it's done) without actually calling the matching tool.
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const wantsAction =
    tools.length > 0 &&
    !/\?\s*$/.test(lastUser.trim()) &&
    /\b(create|add|make|new|save|write|note|jot|delete|remove|rename|move|mark|complete|finish|schedule|remind|record|transcribe|denoise|calculate|list|fix|correct)\b/i.test(
      lastUser,
    );
  const work: Message[] = buildMessages(history, sys); // {role,content}[] with the system turn
  const steps: AgentStep[] = [];
  let fails = 0; // invalid / duplicate / failed tool calls this turn
  let lastCall = ''; // signature of the previous call, to catch loops
  let claimedRetry = false; // used once if the model claims an action it didn't do

  const runTurn = (opts: Record<string, unknown> = turnOpts) =>
    new Promise<{ text: string; toolCalls: NativeToolCall[] | null }>((resolve, reject) => {
      let acc = '';
      session.send(
        coalesceRoles(work),
        {
          onToken: (_t, a) => {
            acc = a;
            onStream?.(a);
          },
          onDone: (text, toolCalls) => resolve({ text: text ?? acc, toolCalls: toolCalls || null }),
          onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
        },
        opts,
      );
    });

  // Give up on tools and get a clean plain-text reply (e.g. the model kept
  // misfiring on a greeting). Never surfaces raw tool-JSON.
  const answerPlainly = async (): Promise<RunAgentResult> => {
    work.push({ role: 'user', content: 'Do not use any tool. Reply to the user directly in plain text.' });
    const { text } = await runTurn(genOpts); // no tools → can't loop back into a call
    const clean = looksLikeToolCall(text, toolNames) ? 'Hi! How can I help?' : text;
    onFinal?.(clean, steps);
    return { text: clean, steps };
  };
  // Feed a short correction back and loop (bounded by `fails`).
  const correct = (text: string, msg: string): void => {
    work.push({ role: 'assistant', content: text });
    work.push({ role: 'user', content: msg });
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      const { text, toolCalls } = await runTurn();
      const call = parseNativeToolCall(toolCalls, toolNames) || parseToolCall(text, toolNames);

      // No tool call → it's the answer (or a botched attempt we won't show raw).
      if (!call) {
        if (looksLikeToolCall(text, toolNames)) {
          if (++fails >= 2) return await answerPlainly();
          correct(
            text,
            `That wasn't a valid tool call. Use \`\`\`tool\\n{"tool":"<name>","arguments":{...}}\\n\`\`\` with one of: ${toolNames.join(', ')} — or just answer in plain text.`,
          );
          continue;
        }
        // Anti-hallucination: a weak model often ROLE-PLAYS the action — it answers
        // as if it saved/created something without calling any tool, so nothing
        // actually happened. Nudge it once to really do it when either the user's
        // request was clearly actionable, or the reply asserts a data action.
        const claimsAction =
          !steps.length &&
          !claimedRetry &&
          (wantsAction ||
            (/\b(created|saved|added|noted|updated|deleted|stored|scheduled|renamed|moved|marked|completed)\b/i.test(
              text,
            ) &&
              /\b(note|task|to-?do|collection|board|pdf|reminder|event|recording)\b/i.test(text)));
        if (claimsAction) {
          claimedRetry = true;
          correct(
            text,
            `STOP — you did NOT call any tool, so nothing actually happened. Do not describe or claim the action. Reply with ONLY a tool call for one of: ${toolNames.join(', ')}, e.g.\n\`\`\`tool\n{"tool":"<name>","arguments":{...}}\n\`\`\`\nPut the full content in the arguments. If truly no tool fits, answer in plain text.`,
          );
          continue;
        }
        onFinal?.(text, steps);
        return { text, steps };
      }

      const tool = byName.get(call.tool);
      const missing = tool
        ? (tool.parameters?.required || []).filter((k) => {
            const v = call.arguments?.[k];
            return v == null || (typeof v === 'string' && v.trim() === '');
          })
        : [];
      const signature = `${call.tool}:${JSON.stringify(call.arguments || {})}`;

      // Invalid call (unknown tool / missing required args / exact repeat): don't
      // run it, don't show a junk step — correct once, then just answer.
      if (!tool || missing.length || signature === lastCall) {
        if (++fails >= 2) return await answerPlainly();
        const why = !tool
          ? `There is no tool named "${call.tool}". Tools: ${toolNames.join(', ')}.`
          : missing.length
            ? `The ${call.tool} tool needs: ${missing.join(', ')}. Provide them, or if no tool is needed just answer in plain text.`
            : `You already called ${call.tool} with the same arguments — use the previous result or answer in plain text.`;
        correct(text, why);
        continue;
      }

      lastCall = signature;
      onStep?.({ tool: call.tool, args: call.arguments, status: 'run' });
      let res: ToolResult;
      try {
        res = await tool.run(call.arguments || {}, ctx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res = { ok: false, result: `Error: ${msg}`, summary: msg };
      }
      const ok = res?.ok !== false;
      steps.push({ tool: call.tool, ok, summary: res?.summary || (ok ? 'done' : 'failed') });
      onStep?.({ tool: call.tool, ok, summary: res?.summary || (ok ? 'done' : 'failed'), status: 'done' });
      if (ok) {
        fails = 0;
      } else if (++fails >= 2) {
        return await answerPlainly();
      }
      // Cap a huge result (e.g. a long OCR dump) so re-prefilling it each turn
      // doesn't crawl on a small on-device model.
      let result = String(res?.result ?? '');
      if (result.length > 6000) result = result.slice(0, 6000) + '\n…(truncated)';
      work.push({ role: 'assistant', content: text });
      work.push({ role: 'user', content: `[tool:${call.tool}] ${result}` });
    }
    return await answerPlainly(); // ran out of steps
  } catch (e) {
    onError?.(e); // the caller's onError is the single error sink — don't rethrow
    return { error: e };
  }
}

// The parser lives in toolCall.ts (pure, and therefore testable — see its header).
export {
  parseToolCall,
  parseNativeToolCall,
  looksLikeToolCall,
  type ToolCall,
  type NativeToolCall,
} from './toolCall.js';
