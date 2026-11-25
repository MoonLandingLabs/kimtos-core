// The tool-call PARSER: the boundary between an untrusted model and code that runs on the
// user's device.
//
// It lives apart from agentTools.ts because it is PURE — text in, a validated call or null out —
// and because agentTools imports the app registry (`apps/index.ts`), which uses Vite's
// `import.meta.glob` and therefore cannot even be loaded outside a bundler. The parser was
// untestable for that reason alone, and it is the one piece here that most needs tests: it had a
// hole where any tool name the model invented came back as a real call (#236).

export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface NativeToolCall {
  name?: string;
  function?: { name?: string; arguments?: unknown };
  arguments?: unknown;
}

function looseArgs(inner: string): Record<string, unknown> {
  const s = (inner || '').trim();
  if (!s) return {};
  const tryParse = (x: string): Record<string, unknown> | null => {
    try {
      const o: unknown = JSON.parse(x);
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  if (s.startsWith('{')) {
    const o = tryParse(s) || tryParse(s.replace(/'/g, '"'));
    if (o) return o;
  }
  const quoted = `{${s}}`.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
  return tryParse(quoted) || tryParse(quoted.replace(/'/g, '"')) || {};
}

// Pull a { tool, arguments } out of a JSON object, tolerating the shapes small
// models emit (tool/name/function keys; arguments/args/parameters/input; a
// nested OpenAI `function`; or `{ "<toolName>": {…} }`).
function fromJsonObject(o: unknown, known: Set<string>): ToolCall | null {
  if (!o || typeof o !== 'object') return null;
  const obj = o as Record<string, unknown>;
  const fn = obj.function as { name?: unknown; arguments?: unknown } | undefined;
  const name =
    (typeof obj.tool === 'string' && obj.tool) ||
    (typeof obj.name === 'string' && obj.name) ||
    (typeof obj.function === 'string' && obj.function) ||
    (fn && typeof fn.name === 'string' && fn.name) ||
    null;
  if (name) {
    // THE NAME MUST BE A TOOL THAT EXISTS. `known` was built and then, on this path, ignored —
    // so any name the model invented parsed as a real call (#236). Small models invent
    // plausible tool names constantly: benchmarking SmolLM2-360M against our own tools with our
    // own prompt, "create a task called review the PR" produced
    // `{"tool": "list_notes", ...}` — a tool that does not exist — on 2 of 6 prompts.
    //
    // Returning null (rather than the invented call) is what the caller already wants: it makes
    // `looksLikeToolCall` fire, the model is told "that wasn't a valid tool call" and asked to
    // retry, and after two failures it answers in plain text. Passing the name through instead
    // pushed the failure into the runtime and made `toolNames` a gate in name only.
    if (!known.has(name)) return null;
    let a: unknown = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? fn?.arguments ?? {};
    if (typeof a === 'string') a = looseArgs(a);
    return { tool: name, arguments: a && typeof a === 'object' ? (a as Record<string, unknown>) : {} };
  }
  const keys = Object.keys(obj);
  if (keys.length === 1 && known.has(keys[0])) {
    const v = obj[keys[0]];
    return {
      tool: keys[0],
      arguments: v && typeof v === 'object' ? (v as Record<string, unknown>) : {},
    };
  }
  return null;
}

// Scan `s` for the first balanced {…} that yields a tool call.
function scanJson(s: string, known: Set<string>): ToolCall | null {
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) {
        try {
          const call = fromJsonObject(JSON.parse(s.slice(i, j + 1)), known);
          if (call) return call;
        } catch {
          /* keep scanning */
        }
        break;
      }
    }
  }
  return null;
}

// Scan for function-call syntax — name(args) — where name is a known tool.
function scanFuncCall(s: string, known: Set<string>): ToolCall | null {
  for (const name of known) {
    const idx = s.indexOf(name + '(');
    if (idx === -1) continue;
    const start = idx + name.length; // points at '('
    let depth = 0;
    for (let j = start; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) {
        return { tool: name, arguments: looseArgs(s.slice(start + 1, j)) };
      }
    }
  }
  return null;
}

/**
 * A native tool call from the model's chat template (Qwen/Llama). It is authoritative — tried
 * BEFORE scraping JSON out of the text — which is exactly why it has to be checked.
 *
 * This path had the same hole as the JSON one (#236): it returned whatever name the template
 * produced, so a hallucinated tool bypassed the allowlist on the path we trust MOST. A model
 * emitting a well-formed call to a tool that does not exist has still invented a tool;
 * "well-formed" is not "real".
 */
export function parseNativeToolCall(toolCalls: NativeToolCall[] | null, toolNames: string[] = []): ToolCall | null {
  const tc = toolCalls?.[0];
  if (!tc) return null;
  const name = tc.function?.name || tc.name;
  if (typeof name !== 'string') return null;
  if (!new Set(toolNames).has(name)) return null;
  let a: unknown = tc.function?.arguments ?? tc.arguments ?? {};
  if (typeof a === 'string') a = looseArgs(a);
  return { tool: name, arguments: a && typeof a === 'object' ? (a as Record<string, unknown>) : {} };
}

// Parse a tool call from the model's reply (prefer a fenced ```tool/```json block, then the
// whole text; JSON shapes first, then function-call syntax). null ⇒ this was an answer, not a
// call.
//
// `toolNames` IS A GATE, not a hint. Every shape is checked against it — the `{"tool": …}` JSON
// our own prompt asks for, the `{ "<name>": … }` shorthand, and `name(...)` syntax. It used to
// be built and then ignored on the JSON path, so a name the model invented came back as a real
// call (#236).
//
// AN EMPTY LIST MEANS NOTHING IS CALLABLE. It used to mean "allow anything", which is the bug
// in its purest form: with no tools available, there is no name a model could emit that would
// be valid. The runtime always passes the real tool list, so this only binds direct callers.
export function parseToolCall(text: string, toolNames: string[] = []): ToolCall | null {
  if (!text) return null;
  const known = new Set(toolNames);
  const fence = text.match(/```(?:tool|json)?\s*([\s\S]*?)```/i);
  for (const src of [fence?.[1], text]) {
    if (!src) continue;
    const call = scanJson(src, known) || scanFuncCall(src, known);
    if (call) return call;
  }
  return null;
}

// A reply that looks like an ATTEMPTED tool call (used to hide raw JSON
// mid-stream, and to trigger a "fix your format" retry when parsing failed).
export function looksLikeToolCall(text: string, toolNames: string[] = []): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/```(?:tool|json)/i.test(t)) return true;
  if (t.startsWith('{') && /["']?(tool|name|function|arguments|args)["']?\s*:/i.test(t)) return true;
  return toolNames.some((n) => t.includes(n + '('));
}
