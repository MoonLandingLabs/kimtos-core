// How many agent tools the extension declares, and across how many apps — read from the
// app descriptors themselves, which are the only place that fact exists.
//
// Imported by BOTH www-docs/scripts/build-content.mjs (which substitutes it into the KimtAI
// handbook as a `{{token}}`) and scripts/check-agent-tool-count.mjs (which fails CI when a
// doc states a different number). One derivation, two consumers — never a second copy of
// the parse.
//
// WHY THIS EXISTS. The count was typed out by hand in four places — the project notes, the
// bench write-up, the KimtAI handbook and the bench harness — and no two of them agreed, while
// the descriptors held a fifth, larger number (#1099). Every new app moved the truth and none
// of the four sentences; Voice Studio (#1090) added four tools and all four copies stayed put.
// One of them is published to the docs site, so the public documentation stated a wrong
// count of the product's own capabilities.
//
// It is dependency-free on purpose. It runs in the `conventions` CI job, which deliberately
// installs nothing, so it reads the descriptors as TEXT rather than importing them — and it
// has to read them as text anyway: the app registry is built with Vite's `import.meta.glob`,
// which Node does not have (the same reason apps/appIds.test.ts reads meta.ts directly).
//
// WHY A SCANNER AND NOT A REGEX. A regex over `name:` keys counts nested ones too (a tool's
// `parameters.properties.name` is a legitimate shape) and an indentation-anchored one breaks
// the first time a file is reformatted. This walks the array from its opening bracket to the
// matching one, counting only the objects that open at the array's own depth, and skips over
// comments, strings, template literals and regex literals the way a tokenizer would. Its
// result is cross-checked against the independent `name:` count in the tests.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repo root, resolved from this file so it works from any working directory. */
export const ROOT = join(HERE, '..');

/** Where the app descriptors live, relative to the repo root. */
export const APPS_DIR = join('extension', 'src', 'apps');

/** The descriptor property that declares an app's agent tools. */
const TOOLS_PROPERTY = /(^|[\s{,])tools:\s*\[/m;

/** After these characters a `/` is a division or a comment, never a regex literal. */
const REGEX_FORBIDDEN_AFTER = /[A-Za-z0-9_$)\]'"`]/;

/**
 * Skip a template literal, including any `${…}` expressions (which may themselves contain
 * braces, strings and further template literals).
 *
 * @param {string} src
 * @param {number} i index of the opening backtick
 * @returns {number} index just past the closing backtick
 */
function skipTemplate(src, i) {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      let depth = 0;
      i++;
      while (i < src.length) {
        const k = src[i];
        if (k === '`') {
          i = skipTemplate(src, i);
          continue;
        }
        if (k === "'" || k === '"') {
          i = skipQuoted(src, i);
          continue;
        }
        if (k === '{') depth++;
        else if (k === '}') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Skip a single- or double-quoted string.
 *
 * @param {string} src
 * @param {number} i index of the opening quote
 * @returns {number} index just past the closing quote
 */
function skipQuoted(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/**
 * Skip a regex literal, honouring character classes (a `/` inside `[…]` does not end it).
 *
 * @param {string} src
 * @param {number} i index of the opening slash
 * @returns {number} index just past the flags
 */
function skipRegex(src, i) {
  i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < src.length && /[dgimsuvy]/.test(src[i])) i++;
      return i;
    } else if (c === '\n') {
      // A regex literal cannot span lines; this was a division after all.
      return i;
    }
    i++;
  }
  return i;
}

/**
 * Count the entries of the array literal that starts at `open`.
 *
 * Only objects that open at the array's own nesting level are entries — a `{` inside a
 * tool's `parameters` or `run` body is not another tool.
 *
 * @param {string} src the file source
 * @param {number} open index of the array's `[`
 * @returns {number} how many object entries the array holds
 * @throws if the array is never closed (an unreadable descriptor, not a zero-tool one)
 */
export function countArrayEntries(src, open) {
  let i = open + 1;
  let depth = 0; // nesting relative to the array itself
  let entries = 0;
  let previous = '['; // last significant character, for telling regex from division

  while (i < src.length) {
    const c = src[i];
    const pair = src.slice(i, i + 2);

    if (pair === '//') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (pair === '/*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(src, i);
      previous = c;
      continue;
    }
    if (c === '`') {
      i = skipTemplate(src, i);
      previous = '`';
      continue;
    }
    if (c === '/' && !REGEX_FORBIDDEN_AFTER.test(previous)) {
      i = skipRegex(src, i);
      previous = '/';
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      if (c === '{' && depth === 0) entries++;
      depth++;
      previous = c;
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      if (depth === 0 && c === ']') return entries;
      depth--;
      previous = c;
      i++;
      continue;
    }
    if (!/\s/.test(c)) previous = c;
    i++;
  }
  throw new Error('unterminated array literal');
}

/**
 * Blank out every comment and string body, so the search for the `tools:` property cannot
 * land on one. The header of `lib/agentTools.ts` documents the descriptor shape in a comment
 * that reads `tools: [{ name, … }]`, and a descriptor is free to do the same above its own
 * array — matching that would bracket-match from inside a comment.
 *
 * LENGTH-PRESERVING (blanked spans become spaces), so an index into the result is an index
 * into the original and the caller can go on scanning the real source.
 *
 * @param {string} src
 * @returns {string}
 */
export function blankCommentsAndStrings(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  let previous = '';
  while (i < src.length) {
    const c = src[i];
    const pair = src.slice(i, i + 2);
    if (pair === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (pair === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(src, i);
      blank(i + 1, end - 1); // keep the quotes, so `previous` still reads as a value
      i = end;
      previous = c;
      continue;
    }
    if (c === '`') {
      const end = skipTemplate(src, i);
      blank(i + 1, end - 1);
      i = end;
      previous = '`';
      continue;
    }
    if (c === '/' && !REGEX_FORBIDDEN_AFTER.test(previous)) {
      const end = skipRegex(src, i);
      blank(i, end);
      i = end;
      previous = '/';
      continue;
    }
    if (!/\s/.test(c)) previous = c;
    i++;
  }
  return out.join('');
}

/**
 * The tools one descriptor source declares.
 *
 * @param {string} src the contents of an app's index.ts
 * @returns {number} how many tools it declares (0 when it declares no `tools` array)
 */
export function toolsIn(src) {
  // Locate the property in the comment- and string-free view, then count in the real source —
  // the two are the same length, so the index carries over.
  const match = TOOLS_PROPERTY.exec(blankCommentsAndStrings(src));
  if (!match) return 0;
  return countArrayEntries(src, src.indexOf('[', match.index + match[0].length - 1));
}

/**
 * Every app that declares agent tools, and how many each declares.
 *
 * Apps are read from their descriptor (`index.ts`) rather than the registry, because the
 * registry is assembled by `import.meta.glob` at bundle time and cannot be imported here.
 * An app with no `tools` array (KimtAI itself) is not counted as a tool-declaring app.
 *
 * @param {string} [root] repo root; defaults to this file's own repo
 * @returns {{ tools: number, apps: number, byApp: Record<string, number> }}
 * @throws if the apps directory is unreadable — never guess a count
 */
export function countAgentTools(root = ROOT) {
  const dir = join(root, APPS_DIR);
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch (err) {
    throw new Error(
      `Cannot read the app descriptors: ${dir} (${err.code ?? err.message}).\n` +
        `  The agent-tool count is derived from them; publishing a guessed one is the drift ` +
        `this module exists to remove.`,
    );
  }

  const byApp = {};
  let tools = 0;
  for (const name of names) {
    const file = join(dir, name, 'index.ts');
    if (!existsSync(file)) continue;
    let count;
    try {
      count = toolsIn(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Cannot count the tools in ${join(APPS_DIR, name, 'index.ts')}: ${err.message}`);
    }
    if (!count) continue;
    byApp[name] = count;
    tools += count;
  }

  if (!tools) {
    throw new Error(
      `No agent tools found under ${dir}. Every app declares an MCP-shaped \`tools\` array ` +
        `(CLAUDE.md convention 5), so zero means this module stopped understanding the ` +
        `descriptors — not that the tools were removed.`,
    );
  }
  return { tools, apps: Object.keys(byApp).length, byApp };
}
