// @kimtos/prompts — a tiny SDK over the Markdown prompt library. Each prompt is
// a `prompts/<id>.md` file with simple frontmatter (id/title/description/version/
// vars + freeform model defaults like temperature) and `## system`, `## examples`,
// `## user` sections. `renderPrompt(id, vars)` fills the {{vars}} and returns both
// a chat `messages` array and a single-string `text` form.
//
// It is intentionally MODEL-AGNOSTIC: it only renders prompt text. Running a
// rendered prompt through a model (e.g. the extension's on-device KimtAI chat
// engine) is the caller's job — pass `renderPrompt(...).messages` to your chat
// session and clean the reply with `stripPreamble`.
import { RAW } from './generated.js';

export type Role = 'system' | 'user' | 'assistant';
export interface ChatMessage {
  role: Role;
  content: string;
}
export interface FewShot {
  input: string;
  output: string;
}
export type PromptDefaults = Record<string, string | number | boolean>;
export interface PromptMeta {
  id: string;
  title: string;
  description: string;
  version: number;
  vars: string[];
  /** Freeform model params from frontmatter (temperature, maxTokens, …). */
  defaults: PromptDefaults;
}
export interface PromptTemplate {
  meta: PromptMeta;
  system: string;
  user: string;
  examples: FewShot[];
}
export interface RenderedPrompt {
  id: string;
  /** System-message content (empty string if the prompt has no system section). */
  system: string;
  /** User-message content with {{vars}} filled. */
  user: string;
  /** Chat form: system, then few-shot user/assistant pairs, then the final user turn. */
  messages: ChatMessage[];
  /** Single-string form (system + inlined examples + user) for models with no role split. */
  text: string;
  defaults: PromptDefaults;
}

const RESERVED = new Set(['id', 'title', 'description', 'version', 'vars']);

function coerce(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function parse(fallbackId: string, md: string): PromptTemplate {
  // Frontmatter (--- … ---): simple `key: value` lines.
  const fm: Record<string, string> = {};
  let body = md;
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fmMatch) {
    body = fmMatch[2] ?? '';
    for (const line of (fmMatch[1] ?? '').split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      if (key) fm[key] = line.slice(idx + 1).trim();
    }
  }

  // Sections delimited by `## system` | `## examples` | `## user`.
  const buf: Record<string, string[]> = {};
  let current = '';
  for (const line of body.split('\n')) {
    const head = line.match(/^##\s+(system|user|examples)\s*$/i);
    if (head) {
      current = (head[1] ?? '').toLowerCase();
      buf[current] = [];
      continue;
    }
    if (current) (buf[current] ??= []).push(line);
  }
  const section = (name: string): string => (buf[name] ?? []).join('\n').trim();

  // Few-shot pairs from the examples section: `Input: …` / `Output: …`.
  const examples: FewShot[] = [];
  const exText = section('examples');
  if (exText) {
    const re = /Input:\s*([\s\S]*?)\nOutput:\s*([\s\S]*?)(?=\n\s*Input:|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(exText)) !== null) {
      examples.push({
        input: (m[1] ?? '').trim(),
        output: (m[2] ?? '').trim(),
      });
    }
  }

  const defaults: PromptDefaults = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!RESERVED.has(k)) defaults[k] = coerce(v);
  }

  const meta: PromptMeta = {
    id: fm['id'] ?? fallbackId,
    title: fm['title'] ?? fallbackId,
    description: fm['description'] ?? '',
    version: Number(fm['version'] ?? '1') || 1,
    vars: (fm['vars'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    defaults,
  };
  return { meta, system: section('system'), user: section('user'), examples };
}

const cache = new Map<string, PromptTemplate>();

/** Parse (and memoize) a prompt template by id. Throws on an unknown id. */
export function getPrompt(id: string): PromptTemplate {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = RAW[id];
  if (raw === undefined) {
    throw new Error(`Unknown prompt "${id}". Available: ${Object.keys(RAW).join(', ') || '(none)'}`);
  }
  const parsed = parse(id, raw);
  cache.set(id, parsed);
  return parsed;
}

/** All available prompts' metadata. */
export function listPrompts(): PromptMeta[] {
  return Object.keys(RAW).map((id) => getPrompt(id).meta);
}

// Neutralize the block delimiters inside a value so user text can't break out of
// the <<< >>> box (defense-in-depth against prompt injection).
function sanitize(value: string): string {
  return value.replace(/<<<|>>>/g, (d) => d.split('').join('​'));
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_whole, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing variable "${name}"`);
    return sanitize(value);
  });
}

/** Render a prompt: fill its {{vars}} and return chat `messages` + single-string `text`. */
export function renderPrompt(id: string, vars: Record<string, string> = {}): RenderedPrompt {
  const t = getPrompt(id);
  for (const required of t.meta.vars) {
    if (!(required in vars)) throw new Error(`Prompt "${id}" requires variable "${required}".`);
  }

  const system = t.system;
  const user = fill(t.user, vars);

  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const ex of t.examples) {
    messages.push({ role: 'user', content: ex.input });
    messages.push({ role: 'assistant', content: ex.output });
  }
  messages.push({ role: 'user', content: user });

  const parts: string[] = [];
  if (system) parts.push(system);
  if (t.examples.length) {
    parts.push(t.examples.map((e) => `EXAMPLE:\nInput: ${e.input}\nOutput: ${e.output}`).join('\n\n'));
  }
  parts.push(user);

  return {
    id,
    system,
    user,
    messages,
    text: parts.join('\n\n'),
    defaults: t.meta.defaults,
  };
}

/**
 * Safety net for small models that ignore the "output only" rule: strip a leading
 * preamble ("Here is…", "Sure,", "Rephrased:", …) and surrounding quotes. Apply to
 * the model's raw reply, not the prompt.
 */
export function stripPreamble(text: string): string {
  let t = text.trim();
  // Strip a leading conversational preamble, possibly stacked
  // ("Sure! Here's the rephrased text:"). Loop until it stops shrinking.
  const preamble =
    /^\s*(?:the\s+)?(?:sure|okay|ok|certainly|of course|here(?:'s| is)|here you go|rephrased(?:\s+(?:text|version|sentence))?|paraphrased(?:\s+\w+)?|output|result)\b[\s,:!.–—-]*/i;
  for (let i = 0; i < 5; i += 1) {
    const next = t.replace(preamble, '');
    if (next === t) break;
    t = next.trim();
  }
  // Unwrap a single pair of surrounding quotes.
  const quoted = t.match(/^["'“”‘’]([\s\S]*)["'“”‘’]$/);
  if (quoted && quoted[1] !== undefined) t = quoted[1];
  return t.trim();
}
