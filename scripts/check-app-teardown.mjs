// An app that takes hold of the device must hand back a way to let go of it.
//
// `render()` returns `(() => void) | void`, so returning nothing is legal TypeScript. An app that
// starts an audio element, a MediaRecorder, a microphone or an interval and forgets its teardown
// therefore compiles, ships, and goes on running after its window is closed — audio the user can
// hear but not find, a microphone still held, a recording light still on.
//
// That is not hypothetical: it is the shape of #1172. The reported symptom was a clip still playing
// after Denoise was closed. Every teardown turned out to be present and correct, and the real cause
// was elsewhere — but the only reason that investigation could conclude anything was that someone
// read all twenty-one apps by hand. Nothing made it TRUE, and nothing would have noticed the day it
// stopped being true. This guard is what makes it true.
//
// WHAT IT CHECKS. Two rules, both of the same shape — take hold of something, hand back the way to
// let go of it.
//
//  1. If an app's `index.ts` mentions any resource-acquiring API, its `render()` must return
//     something. TypeScript already constrains WHAT it may return (a function or nothing), so
//     "returns something" is exactly "returns a teardown" — the two guards compose, and neither has
//     to re-derive the other's job.
//  2. If ANY file in `extension/src` mounts the shared history sidebar, it must call that sidebar's
//     `destroy()`. The sidebar redraws from work that outlives the window — a history load, an undo
//     window committing on a plain timer — so a host that never destroys it rebuilds rows for a
//     closed pane and keeps its entries reachable (#1329). Six hosts mount it; the flag lives in the
//     component precisely so they cannot each get it subtly different, and this is what stops the
//     seventh forgetting.
//
// It is dependency-free (it runs in the `conventions` CI job, which has no `npm ci`), so it reads
// the source text rather than parsing it.
//
//   node scripts/check-app-teardown.mjs

import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', 'extension', 'src');
const APPS_DIR = join(HERE, '..', 'extension', 'src', 'apps');
const LIB_DIR = join(HERE, '..', 'extension', 'src', 'lib');

/**
 * APIs that take hold of something the browser will not release on its own.
 *
 * Deliberately a short, concrete list rather than a clever heuristic: a guard nobody understands is
 * a guard that gets disabled the first time it is inconvenient. Add to it when a new way to hold a
 * device or a timer appears.
 */
export const HOLDING_APIS = [
  'createAudioPlayer',
  'createVideoPlayer',
  'createAudioInput',
  'getUserMedia',
  'getDisplayMedia',
  'MediaRecorder',
  'setInterval',
  'new Audio(',
];

/**
 * Strip comments and string contents, so a mention in prose or a message never counts as a call.
 *
 * A scanner, not a chain of regexes. The regexes this replaces stripped block comments FIRST, with
 * no idea what was a string — so the slash-star inside Retouch's `accept: 'image/…'` wildcard opened
 * a comment that ran to the next real close two hundred lines away, and every holding API, every
 * render return and every sidebar mount in between was invisible. A guard that reports "all clear"
 * for a span it never read is worse than no guard; found while adding the sidebar rule below (#1329).
 *
 * A plain string is terminated at the end of its line. That is not how JavaScript reads one, and it
 * is deliberate: it bounds the damage when something we mis-read as code (a regex literal holding a
 * quote, say) opens a string by accident, to that line instead of to the rest of the file.
 */
export function code(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue; // the newline itself is emitted by the next turn of the loop
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'; // keep line numbers honest for anything reading them
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) break;
        if (c === '\n') {
          if (quote !== '`') break; // only a template may span lines
          out += '\n';
        }
        i++;
      }
      if (source[i] === quote) i++;
      out += "''";
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/** Which holding APIs this source actually uses. */
export function holdingApisUsed(source) {
  const src = code(source);
  return HOLDING_APIS.filter((api) => src.includes(api));
}

/**
 * The name each sidebar is bound to. Both `const history = …` and `history = …` count — the shared
 * media-text factory declares its sidebar `let … | null` and assigns it later.
 */
const mountsIn = (src) => [
  ...new Set([...src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*createHistorySidebar\s*\(/g)].map(([, name]) => name)),
];

/**
 * Does this source let go of the sidebar bound to `name`?
 *
 * Not `\b`: `$` is legal in a JavaScript identifier and is an anchor in a regular expression, so a
 * sidebar named `$history` would match nothing and be reported as never destroyed. The name is
 * escaped, and the boundary is spelled out as "not preceded by a name character".
 */
const releases = (src, name) =>
  new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}\\s*\\??\\.\\s*destroy\\s*\\(`).test(src);

/** Every history sidebar this source mounts, by the name it bound it to. */
export function sidebarsMounted(source) {
  return mountsIn(code(source));
}

/**
 * Of those, the ones it never lets go of.
 *
 * Matching the BOUND NAME rather than a bare `.destroy()` is the whole point: five of the six hosts
 * already call `responsive.destroy?.()` or `shell.responsive.destroy?.()` in the same teardown, so a
 * substring check for `.destroy(` would report every one of them as fine while none of them had
 * touched the sidebar. `history?.destroy()` counts as a release.
 */
export function undestroyedSidebars(source) {
  const src = code(source); // stripped once and shared — `code()` walks the whole file
  return mountsIn(src).filter((name) => !releases(src, name));
}

/**
 * Does `render()` return a value?
 *
 * Brace-matches the render body and looks for a `return` at ITS top level — a `return` inside a
 * nested helper is that helper's, not the teardown, and counting it is how a check like this
 * quietly passes everything. `return;` on its own does not count: an early exit is not a teardown.
 *
 * Returns null when there is no `render(` at all, which the caller reports differently — an app
 * built by a shared factory keeps its teardown in the factory.
 */
export function renderReturnsTeardown(source) {
  const src = code(source);
  const start = src.search(/\brender\s*\(/);
  if (start === -1) return null;

  // Walk to the `{` that opens the body (past the parameter list).
  let i = src.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const bodyStart = src.indexOf('{', i);
  if (bodyStart === -1) return false;

  let braces = 0;
  for (let j = bodyStart; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') braces++;
    else if (ch === '}') {
      braces--;
      if (braces === 0) return false; // body ended with no top-level return
    } else if (braces === 1 && src.startsWith('return', j) && !/[\w$]/.test(src[j - 1] ?? '')) {
      const after = src.slice(j + 'return'.length);
      // BOTH boundaries, or the guard is defeatable by an identifier that merely starts with the
      // word: `let returnValue = compute();` at the top level of a render body matched, and an app
      // holding a microphone with no teardown at all would have sailed through the one check that
      // exists to stop it. A guard that can be fooled by a variable name is not a guard.
      if (/^[\w$]/.test(after)) continue;
      if (/^\s*[^;\s]/.test(after)) return true; // `return <something>`
    }
  }
  return false;
}

/**
 * Everything that owns an app's render lifecycle: every shipped app, plus the shared app factories
 * in `lib/create*App.ts`.
 *
 * The factories have to be in scope because several apps have no `render()` of their own — Voice to
 * Text hands its audio input to `createMediaTextApp` and the factory's teardown is what destroys
 * it. Deriving the factories from the `create*App.ts` naming rather than naming one keeps a future
 * factory covered without an edit here; hardcoding `createMediaTextApp` would have been one more
 * hand-maintained list of exactly the kind this repo keeps finding out of date.
 */
function lifecycleOwners() {
  const apps = readdirSync(APPS_DIR)
    .filter(
      (d) =>
        statSync(join(APPS_DIR, d)).isDirectory() &&
        existsSync(join(APPS_DIR, d, 'meta.ts')) &&
        existsSync(join(APPS_DIR, d, 'index.ts')),
    )
    .map((id) => ({ id, file: join(APPS_DIR, id, 'index.ts') }));

  const factories = readdirSync(LIB_DIR)
    .filter((f) => /^create.*App\.ts$/.test(f))
    .map((f) => ({ id: `lib/${f}`, file: join(LIB_DIR, f) }));

  return [...apps, ...factories];
}

/**
 * Every non-test source file in the extension.
 *
 * Rule 2's scope, and deliberately wider than rule 1's: a sidebar can be mounted from any file, not
 * only from an app's `index.ts`. That is the lesson `check-orchestrated-jobs.mjs` already learned —
 * it reads every `.ts` in an app precisely because the thing it polices had been hidden one file
 * away from the one being read. Rule 1 stays on the lifecycle owners, since only a `render()` can
 * return a teardown.
 */
function extensionSources() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(SRC_DIR);
  return files.map((file) => ({ id: file.slice(SRC_DIR.length + 1), file }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [];
  let checked = 0;
  let sidebars = 0;

  // Rule 2 — over the whole extension, on its own pass. A file that mounts the sidebar need not own
  // a render() or hold a device, so it would be nowhere near rule 1's list (Retouch mounts one and
  // acquires nothing).
  for (const { id, file } of extensionSources()) {
    const source = readFileSync(file, 'utf8');
    if (!sidebarsMounted(source).length) continue;
    sidebars++;
    const undestroyed = undestroyedSidebars(source);
    if (!undestroyed.length) continue;
    problems.push(
      `  ${id}: mounts the history sidebar (${undestroyed.join(', ')}) but never calls its destroy().\n` +
        `      Call it FIRST in the teardown — stopping everything else is itself what asks the\n` +
        `      sidebar to repaint. Without it a load or an undo commit that lands after the window\n` +
        `      closed rebuilds rows for a dead pane and keeps its entries reachable (#1329).`,
    );
  }

  // Rule 1 — only a render() can hand back a teardown, so this one stays on the lifecycle owners.
  for (const { id, file } of lifecycleOwners()) {
    const source = readFileSync(file, 'utf8');
    const used = holdingApisUsed(source);
    if (!used.length) continue;
    checked++;

    const returns = renderReturnsTeardown(source);
    // No render() of its own means this file does not own the lifecycle — it hands its input to a
    // shared factory, and that factory is itself in `lifecycleOwners()`, so the teardown is checked
    // where it actually lives rather than reported as missing here.
    if (returns === null) {
      checked--;
      continue;
    }
    if (returns === true) continue;

    problems.push(
      `  ${id}: uses ${used.join(', ')} but its render() returns nothing.\n` +
        `      Return a teardown that stops it; appsController calls it on close, and that is the\n` +
        `      only thing standing between a closed window and audio that keeps playing (#1172).`,
    );
  }

  if (problems.length) {
    console.error('check-app-teardown: something is taken hold of with no way to let go.\n');
    console.error(problems.join('\n\n'));
    console.error('\nSee the app conventions in CLAUDE.md.');
    process.exit(1);
  }
  console.log(
    `check-app-teardown: ${checked} app(s) acquire a device or timer and every one returns a teardown; ` +
      `${sidebars} mount the history sidebar and every one destroys it.`,
  );
}
