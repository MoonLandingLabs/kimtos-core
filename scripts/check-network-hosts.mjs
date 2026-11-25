// Every external host the extension can talk to must be DECLARED in ./network-hosts.mjs — and
// what is declared there must match what the privacy page tells users. This script is the
// enforcement half; that file is the list.
//
// "KimtOS makes a network request in these cases, and only these" is a claim on a legal page of
// a commercial site (www/pages/privacy.vue). It has now been wrong twice: the README's copy of
// the list omitted the AI's DuckDuckGo search (#54), and the privacy page's copy omitted the
// Tesseract language CDN and a first-party model CDN while listing a GitHub version check that does not
// exist (#244). Prose cannot police this. A grep can.
//
// This fails the build when a NEW external host appears in the extension's source and nobody
// has said so out loud. It does not stop you adding one — it stops you adding one silently.
//
//   node scripts/check-network-hosts.mjs
//
// ---------------------------------------------------------------------------------------------
// AND the disclosure half, which used to be a comment (#886)
// ---------------------------------------------------------------------------------------------
//
// The CI step is called "Every external host is declared and disclosed". Until now it enforced
// only the first word. An entry could carry `told: 'NOT TOLD'` and this script printed a polite
// note and exited 0 — which is exactly the state `html.duckduckgo.com` sat in for months while
// KimtAI's web_search tool sent chat-derived queries to a third party and the store listing
// promised the user's data never leaves their browser (#885). The invariant "no declared host is
// undisclosed" was written at the bottom of network-hosts.mjs, and a paragraph fails no build.
//
// So the declaration now carries the whole contract, and every part of it is checked against the
// real files: what the request sends (`sends`), the words on the privacy page that disclose it
// (`saidAs`, matched against www/pages/privacy.vue), the off-by-default switch that gates it
// (`optIn`, matched against the app's real `settings` schema), and the third party who sees it
// (`subprocessor`, matched against www/data/legal.ts). Plus the rule #886 exists for: a host
// reachable from a file that declares assistant tools must carry that opt-in — so a search tool
// cannot land as a one-line declaration with the disclosure promised for later.
//
// The judgement is exported and covered by check-network-hosts.test.mjs. A guard nobody tests is
// a guard that rots, and this one had no tests at all while it was the only thing standing
// between an undisclosed outbound path and a green build.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_HOSTS as ALLOWED } from './network-hosts.mjs';

const SRC = 'extension/src';
const CONFIG_SRC = 'shared-modules/config/src/index.ts';
const PRIVACY_SRC = 'www/pages/privacy.vue';
const LEGAL_SRC = 'www/data/legal.ts';

// The declared list lives in ./network-hosts.mjs — data only, so it can also be cross-checked
// against the manifest's host_permissions without running this script (#678). Its comments are
// the reference for what each field means and why a host is on the list.

// --- Source scanning primitives ---------------------------------------------------------------

// Strip comments. A URL in a comment is documentation, not a network call, and counting it
// would make this check cry wolf (which is how checks get disabled).
//
// ONE ordered left-to-right pass, and that is a bug fix rather than a preference.
//
// The old version was two regexes: strip every block comment, THEN every line comment. So a
// block-comment OPENER sitting inside a line comment opened a comment that ran to the next
// closer anywhere in the file and swallowed the real code in between. Not hypothetical:
// lib/agentTools.ts explains why web_search was removed and quotes the host match pattern for
// all https origins while doing it — and that pattern contains an opener. It blinded this
// checker to 191 lines of that file, `systemTools` among them. `systemTools` is the exact array
// `web_search` was declared in, so the one guard meant to catch an undisclosed outbound path
// could not see the place it would be added. Taking the comment forms in the order they appear
// closes that: the line comment consumes its own line, closer and all.
//
// Strings are skipped, because the MIRROR of that bug lives in string literals: an opener is
// perfectly ordinary inside one. `lib/hostPermission.ts` holds the all-https match pattern as a
// value, and `apps/index.ts` globs `./apps/*/index.ts` — both contain an opener, and both hid a
// real host on the following line when this pass ignored quotes.
//
// But a naive "every quote opens a string" is wrong the other way, and was measured: the
// apostrophe inside the regex literal in `lib/engines/voicePhonemize.ts` opened a string that
// ran for twenty lines, after which comments read as code and a Wiktionary link cited for a
// pronunciation was reported as a live host. Crying wolf is how a guard gets switched off.
//
// `endOfString` resolves both: a `'` or `"` is a string only if it CLOSES on the same line,
// which JS requires of it anyway. The stray apostrophe finds no partner and is treated as the
// ordinary character it is, while every real string is skipped whole. Template literals are the
// one form allowed to span lines, so only they search past the newline.
//
// The `[^:]` guard on the line comment is kept as a second line of defence: a URL's own slashes
// are preceded by a colon, so even if the string tracking above ever loses its place, a
// `https://…` literal is still not mistaken for a comment.
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(src, i);
      if (end !== -1) {
        out += src.slice(i, end + 1);
        i = end;
        continue;
      }
      // Not a string — an apostrophe in a regex, or a lone backtick. Fall through and emit it.
    }
    if (c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n'; // keep the line structure so reported context stays readable
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Index of the closing quote of the string literal starting at `i`, or -1 if it never closes —
 * which means the quote was not opening a string at all.
 *
 * `'` and `"` must close on their own line, because JS requires that of them. That is the whole
 * defence against an apostrophe inside a regex literal (or in prose) swallowing the rest of a
 * file. Only a template literal may run past the newline.
 */
export function endOfString(src, i) {
  const quote = src[i];
  const lineEnd = src.indexOf('\n', i);
  const limit = quote === '`' || lineEnd === -1 ? src.length : lineEnd;
  for (let j = i + 1; j < limit; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === quote) return j;
  }
  return -1;
}

/**
 * The balanced `[...]` or `{...}` starting at `from`, including both delimiters.
 *
 * String-aware on purpose: a setting's `hint` legitimately contains a bracket, and a naive depth
 * counter would end the slice mid-sentence and silently read half a schema. Returns null if the
 * source never closes it.
 *
 * @param {string} src
 * @param {number} from index of the opening delimiter
 * @returns {string | null}
 */
export function balanced(src, from) {
  const open = src[from];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return null;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(src, i);
      if (end !== -1) i = end; // -1 means it was not a string; step over the one character
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(from, i + 1);
  }
  return null;
}

/** A source token (`'off'`, `false`, `SOME_CONST`) as the value it denotes. An identifier or an
 *  expression comes back as its own text, which never equals a declared `off` value — that is
 *  the point: an opt-in default has to be a literal anyone can read. */
export function literalValue(token) {
  if (token == null) return undefined;
  const t = token.trim().replace(/,$/, '').trim();
  const quoted = /^(['"`])([\s\S]*)\1$/.exec(t);
  if (quoted) return quoted[2];
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return t;
}

/**
 * The `settings:` schema an app descriptor declares, as `{ key, default }` pairs.
 *
 * Regex over source rather than an import, for the same reason as the rest of this file: the
 * Conventions CI job runs with bare `node` and no `npm ci`, so it can neither load TypeScript nor
 * execute the app module.
 *
 * @param {string} source the app's index.ts
 * @returns {{ key: string, default: unknown }[]}
 */
export function settingsSchema(source) {
  const src = stripComments(source);
  const at = /(?:^|\n)\s*settings:\s*\[/.exec(src);
  if (!at) return [];
  const array = balanced(src, src.indexOf('[', at.index));
  if (!array) return [];
  const body = array.slice(1, -1);

  const fields = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(body, i);
      if (end !== -1) i = end;
      continue;
    }
    if (c !== '{') continue;
    const object = balanced(body, i);
    if (!object) break;
    i += object.length - 1;
    const key = /(?:^|[\s,{])key:\s*['"]([^'"]+)['"]/.exec(object);
    // Stop at `,`, `}` or a newline: a one-line field ends `default: 'off' }`, and swallowing
    // the brace turns a perfectly good literal into an unrecognisable token.
    const value = /(?:^|[\s,{])default:\s*([^,\n}]+)/.exec(object);
    if (key) fields.push({ key: key[1], default: literalValue(value?.[1]) });
  }
  return fields;
}

/** Does this file declare agent tools? Either an app descriptor's `tools:` array, or a typed
 *  `AgentTool[]` constant — that is where `web_search` lived (lib/agentTools.ts `systemTools`). */
export function declaresAgentTools(source) {
  const src = stripComments(source);
  return /(?:^|\n)\s*tools:\s*\[/.test(src) || /:\s*AgentTool\[\]\s*=/.test(src);
}

/**
 * The names in www/data/legal.ts's SUBPROCESSORS array — the privacy page's "who else sees
 * anything" table. Scoped to that array on purpose: the same file's CLIENT_STORAGE rows also
 * have a `name`, and they are cookie names. A subprocessor claim satisfied by a cookie would be
 * a cross-check that proves nothing.
 *
 * @param {string} source www/data/legal.ts
 * @returns {string[]}
 */
export function subprocessorNames(source) {
  const src = stripComments(source);
  const at = src.indexOf('SUBPROCESSORS');
  if (at === -1) return [];
  // Past the `=` first. The declaration is typed `SUBPROCESSORS: { … }[] = [`, so the nearest
  // `[` to the name is the type annotation's empty one, and reading that finds no names at all.
  const assign = src.indexOf('=', at);
  if (assign === -1) return [];
  const open = src.indexOf('[', assign);
  if (open === -1) return [];
  const array = balanced(src, open);
  if (!array) return [];
  return [...array.matchAll(/(?:^|[\s,{])name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Collapse every run of whitespace, so a phrase still matches after prettier re-wraps the
 *  privacy page's markup across lines. */
const flatten = (text) => text.replace(/\s+/g, ' ');

// --- The judgement ----------------------------------------------------------------------------

const SENDS = ['nothing', 'metadata', 'user-content'];

/**
 * Every way a declared host can fail the disclosure contract, as human-readable lines.
 *
 * Pure: the caller supplies the surfaces, so the tests exercise exactly what CI runs, against
 * fixtures, rather than a copy of it.
 *
 * @param {readonly object[]} hosts the NETWORK_HOSTS entries
 * @param {{ privacy: string, subprocessors: string[], settingsFor: (appId: string) => ({ key: string, default: unknown }[] | null) }} surfaces
 * @returns {string[]}
 */
export function disclosureIssues(hosts, { privacy, subprocessors, settingsFor }) {
  const issues = [];
  const page = flatten(privacy);

  for (const h of hosts) {
    const at = `${h.host}:`;

    if (!SENDS.includes(h.sends)) {
      issues.push(`${at} sends must be one of ${SENDS.join(' | ')} — got ${JSON.stringify(h.sends)}.`);
    }
    // The exact hole this closes: an entry that says out loud it is undisclosed, and passes.
    if (/^NOT TOLD/i.test(h.told ?? '')) {
      issues.push(`${at} told is "${h.told}". An undisclosed outbound host is not a state this repo ships in.`);
      continue;
    }

    if (h.told === 'privacy.vue') {
      if (!h.saidAs) {
        issues.push(`${at} told is privacy.vue but no saidAs says WHICH words disclose it.`);
      } else if (!page.includes(flatten(h.saidAs))) {
        issues.push(`${at} saidAs "${h.saidAs}" is not on ${PRIVACY_SRC}. The disclosure it claims does not exist.`);
      }
    } else if (!/^n\/a \(.+\)$/.test(h.told ?? '')) {
      issues.push(`${at} told must be 'privacy.vue' or 'n/a (<reason>)' — got ${JSON.stringify(h.told)}.`);
    }

    // Anything the request carries has to be on the page. Only a host that carries nothing at all
    // may be waved off with a reason.
    if (h.sends !== 'nothing' && h.told !== 'privacy.vue') {
      issues.push(`${at} sends '${h.sends}' but is not disclosed on ${PRIVACY_SRC}.`);
    }

    if (h.sends === 'user-content') {
      if (!h.optIn) {
        issues.push(`${at} carries user content with no optIn. It must be off until the user turns it on.`);
      }
      if (!h.subprocessor) {
        issues.push(`${at} carries user content, so whoever receives it is a subprocessor and must be named.`);
      } else if (!subprocessors.includes(h.subprocessor)) {
        issues.push(`${at} subprocessor "${h.subprocessor}" is not in ${LEGAL_SRC} SUBPROCESSORS.`);
      }
    }

    if (h.optIn) issues.push(...optInIssues(at, h.optIn, settingsFor));
  }

  return issues;
}

/** The opt-in half: it must exist in the app's real settings schema, and it must start off. */
function optInIssues(at, optIn, settingsFor) {
  const { app, key, off } = optIn;
  if (!app || !key || off === undefined) {
    return [`${at} optIn must be { app, key, off } — got ${JSON.stringify(optIn)}.`];
  }
  const schema = settingsFor(app);
  if (!schema) return [`${at} optIn names app "${app}", which has no descriptor under ${SRC}/apps.`];

  const field = schema.find((f) => f.key === key);
  if (!field) {
    return [`${at} optIn "${app}.${key}" is not in that app's settings schema. The switch does not exist.`];
  }
  if (field.default !== off) {
    return [
      `${at} optIn "${app}.${key}" defaults to ${JSON.stringify(field.default)}, not the declared off ` +
        `value ${JSON.stringify(off)}. A switch that is already on is not an opt-in.`,
    ];
  }
  return [];
}

/**
 * The rule #886 exists for: a host reachable from a file that declares assistant tools must be
 * gated by an opt-in.
 *
 * A tool hands its result to the model, which is mid-conversation with the user, so a tool that
 * reaches the network is an outbound path for whatever the user is talking about — whatever the
 * declaration claims it sends.
 *
 * Scoped to `kind: 'fetch'`, which is a DELIBERATE narrow gap, pinned in the tests. The unit
 * here is the file, not the individual tool — brace-matching every `run` body would be far more
 * fragile than the thing it bought — and an app descriptor holds much more than its tools. A
 * `text` host is a placeholder string, and a `navigation` host is the browser opening a page on
 * a user gesture: that is what a help or Documentation link is, and demanding an opt-in for one
 * is exactly the false positive that gets a guard switched off. `web_search` fetched, and so
 * would its successor.
 *
 * @param {{ file: string, hosts: string[] }[]} toolFiles
 * @param {readonly object[]} hosts
 * @returns {string[]}
 */
export function agentToolIssues(toolFiles, hosts) {
  const byHost = new Map(hosts.map((h) => [h.host, h]));
  const issues = [];
  for (const { file, hosts: reached } of toolFiles) {
    for (const host of reached) {
      const declared = byHost.get(host);
      if (declared?.kind !== 'fetch') continue;
      if (declared.optIn) continue;
      issues.push(
        `${file} declares assistant tools and reaches ${host}, which has no optIn. A tool that ` +
          `reaches the network needs an explicit, off-by-default switch and its disclosure in the ` +
          `SAME commit — that is the whole of #886.`,
      );
    }
  }
  return issues;
}

// --- The scan ---------------------------------------------------------------------------------

function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'test') continue; // the DOM harness's fake page URL is not a network call
        walk(p);
      } else if (/\.(ts|js)$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
    }
  };
  walk(root);
  return files;
}

/**
 * Hosts that reach the extension through @kimtos/config rather than as a URL literal (#733). The
 * literal grep cannot see them: a value like `${BACKEND_BASE}/auth` carries no host in the
 * source. The Conventions job runs without `npm ci`, so we cannot import the package or read a
 * built bundle — resolve the DEFAULTS URL constants from the config SOURCE, the same way this
 * script reads source rather than running it. The better the code follows the convention that
 * shared URLs live in @kimtos/config, the more a literal-only grep misses; this closes that gap.
 */
function configDefaults(configText) {
  // `const NAME = 'https://…'` bindings first, so a DEFAULTS entry written `cdnUrl: CDN_HOST` (an
  // identifier, not a literal) still resolves to its URL.
  const constUrls = new Map();
  for (const m of configText.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*['"`](https?:\/\/[^'"`]+)['"`]/g)) {
    constUrls.set(m[1], m[2]);
  }
  // DEFAULTS URL entries: `key: 'https://…'` or `key: SOME_CONST`. Non-URL keys (port numbers, TTLs) and
  // hosts the extension never imports (adminUrl lives here too) are collected harmlessly — only a
  // DEFAULTS.<key> actually referenced under extension/src, matched below, is required to be declared.
  const defaultUrlFor = new Map();
  for (const m of configText.matchAll(
    /^\s*([A-Za-z0-9_]+)\s*:\s*(?:['"`](https?:\/\/[^'"`]+)['"`]|([A-Za-z0-9_]+))\s*,/gm,
  )) {
    const [, key, literal, ident] = m;
    const url = literal ?? (ident ? constUrls.get(ident) : undefined);
    if (url) defaultUrlFor.set(key, url);
  }
  return defaultUrlFor;
}

function main() {
  const files = sourceFiles(SRC);
  const defaultUrlFor = configDefaults(readFileSync(CONFIG_SRC, 'utf8'));

  // Tripwire: this resolution is regex over source, so a reformat of the config (or a moved file)
  // could make it silently match nothing — and a config check that resolves zero hosts is back to
  // the #733 blind spot it was written to close, quietly. DEFAULTS always defines URL constants
  // (docsUrl, chromeWebStoreUrl), so an empty result means the parse broke, not that there are none.
  if (defaultUrlFor.size === 0) {
    console.error(
      `check-network-hosts: resolved no URL defaults from ${CONFIG_SRC}. The config format likely ` +
        `changed and this check has gone blind to @kimtos/config-derived hosts (#733). Fix the parse.`,
    );
    process.exit(1);
  }

  const allowed = new Set(ALLOWED.map((a) => a.host));
  const found = new Map();
  const toolFiles = [];

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const reached = new Set();

    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const host = m[1].toLowerCase();
      reached.add(host);
      if (allowed.has(host)) continue;
      if (!found.has(host)) found.set(host, []);
      found.get(host).push(file);
    }
    // …and the config-derived hosts: every `DEFAULTS.<urlKey>` the extension uses is a reachable host.
    for (const m of src.matchAll(/\bDEFAULTS\.([A-Za-z0-9_]+)/g)) {
      const url = defaultUrlFor.get(m[1]);
      if (!url) continue; // not a URL-valued default
      const host = new URL(url).hostname.toLowerCase();
      reached.add(host);
      if (allowed.has(host)) continue;
      if (!found.has(host)) found.set(host, []);
      found.get(host).push(`${file} (via @kimtos/config: DEFAULTS.${m[1]})`);
    }

    if (reached.size && declaresAgentTools(src)) toolFiles.push({ file, hosts: [...reached] });
  }

  if (found.size) {
    console.error('check-network-hosts: an undeclared external host is reachable from the extension.\n');
    for (const [host, where] of found) {
      console.error(`  ${host}`);
      for (const f of [...new Set(where)]) console.error(`    ${f}`);
    }
    console.error(`
Every host the extension can contact must be declared in scripts/network-hosts.mjs AND told to
the user in www/pages/privacy.vue ("and only these"), plus www/data/legal.ts if a third party
sees anything. A privacy page that claims an exhaustive list and is not exhaustive does more
damage than no claim at all.

If the host arrives through @kimtos/config (no URL literal here), it is reached via a
DEFAULTS.<key> under extension/src — declare it in scripts/network-hosts.mjs just the same.
If the host is NOT a real network call (a doc link, an example), it belongs in a comment.`);
    process.exit(1);
  }

  // The disclosure contract (#886). Read the surfaces the declarations point at, and hold every
  // claim against them.
  //
  // Scoped to the SUBPROCESSORS array, not every `name:` in the file. legal.ts also holds
  // CLIENT_STORAGE, whose rows are cookie names — matching the whole file would let a
  // subprocessor claim be satisfied by a cookie, which is not a disclosure of anything.
  const subprocessors = subprocessorNames(readFileSync(LEGAL_SRC, 'utf8'));
  if (subprocessors.length === 0) {
    console.error(
      `check-network-hosts: read no SUBPROCESSORS from ${LEGAL_SRC}. The file's shape likely ` +
        `changed and the subprocessor cross-check has gone blind. Fix the parse.`,
    );
    process.exit(1);
  }
  const settingsFor = (appId) => {
    let source;
    try {
      source = readFileSync(join(SRC, 'apps', appId, 'index.ts'), 'utf8');
    } catch {
      return null;
    }
    return settingsSchema(source);
  };

  const issues = [
    ...disclosureIssues(ALLOWED, { privacy: readFileSync(PRIVACY_SRC, 'utf8'), subprocessors, settingsFor }),
    ...agentToolIssues(toolFiles, ALLOWED),
  ];

  if (issues.length) {
    console.error('check-network-hosts: a declared host does not meet the disclosure contract.\n');
    for (const issue of issues) console.error(`  ${issue}`);
    console.error(`
Declaring a host is half the obligation. The other half — an off-by-default opt-in for anything
carrying what the user wrote, words on ${PRIVACY_SRC} that really say so, and a subprocessor row
naming who receives it — is the contract documented at the top of scripts/network-hosts.mjs.

It is enforced because it was once only written down: html.duckduckgo.com sat in that list as
"NOT TOLD" while the store listing promised the user's data never leaves their browser (#885,
#886). Fix the declaration, or fix the surface it is lying about — never relax this check.`);
    process.exit(1);
  }

  const fetched = ALLOWED.filter((a) => a.kind === 'fetch').length;
  const gated = ALLOWED.filter((a) => a.optIn).length;
  console.log(
    `check-network-hosts: ${ALLOWED.length} declared hosts (${fetched} fetched, ${gated} opt-in gated), ` +
      `none undeclared in ${SRC}, all disclosed.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
