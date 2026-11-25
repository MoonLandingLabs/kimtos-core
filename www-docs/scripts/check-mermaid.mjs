// Fails the docs build when a ```mermaid diagram has a syntax error.
//
// The docs site renders Mermaid CLIENT-SIDE: `.vitepress/config.mts` wraps the config in
// `withMermaid()` (vitepress-plugin-mermaid), which defers rendering to the reader's browser.
// So `npm run build -w @kimtos/www-docs` builds a broken diagram green and the failure only
// shows up as a red parse-error box when someone opens the page on the docs site (#896).
// Nothing in CI parsed a ```mermaid fence before it shipped.
//
// This runs mermaid's OWN parser over every ```mermaid block in the docs sources at build
// time and fails on the first syntax error, naming the file, the line the fence opens on, and
// mermaid's own message. It is not a regex approximation: a diagram that passes here is a
// diagram mermaid can parse, because it is the same `mermaid.parse()` the browser calls.
//
// Mermaid is a BROWSER library and needs a DOM (its bundled DOMPurify calls `window`), so we
// stand up a jsdom document before importing it. That is the whole reason a lint-only checker
// (git ls-files, no deps) could not do this and this one lives in the www-docs workspace,
// where `mermaid` and `jsdom` are declared devDependencies -- not relying on root hoisting
// (deploy-release #575). It is wired into `prebuild`, so the Docs CI job runs it as part of
// `npm run build -w @kimtos/www-docs`; the parse logic is covered by check-mermaid.test.mjs.
//
//   node scripts/check-mermaid.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..'); // www-docs/scripts -> www-docs -> repo root

// Give mermaid the DOM globals it reaches for. `navigator` is read-only on the Node global and
// mermaid does not need us to override the real one, so it is deliberately left alone.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
for (const key of ['HTMLElement', 'SVGElement', 'Element', 'Node']) globalThis[key] = dom.window[key];

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false });

// Pull every fenced ```mermaid block out of a markdown string, with the 1-based line the fence
// opens on. The opener and closer are anchored to a whole line (optional indent, then the fence
// run, then only `mermaid` for the opener) so an INLINE mention -- the README writes a literal
// ` ```mermaid ` inside backticks -- is never mistaken for a real diagram.
export function extractMermaidBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      // A closing fence is the same marker character, at least as long as the opener, alone on
      // the line. Matching the marker means a ~~~ block is not closed by a stray ```.
      const close = new RegExp(`^\\s*\\${open.marker[0]}{${open.marker.length},}\\s*$`);
      if (close.test(line)) {
        blocks.push({ code: open.code.join('\n'), line: open.start });
        open = null;
      } else {
        open.code.push(line);
      }
    } else {
      const m = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i.exec(line);
      if (m) open = { code: [], start: i + 1, marker: m[1] };
    }
  }
  // A fence that opens but never closes must not slip through unvalidated: keep it so mermaid
  // parses the trailing content and reports the mistake, rather than the guard silently
  // ignoring a block that renders broken on the page.
  if (open) blocks.push({ code: open.code.join('\n'), line: open.start });
  return blocks;
}

// Returns mermaid's error message for an invalid diagram, or null when it parses. `mermaid.parse`
// throws on a syntax error and resolves on success, so this is the exact judgement the browser makes.
export async function diagramError(code) {
  try {
    await mermaid.parse(code);
    return null;
  } catch (e) {
    return e && e.message ? e.message : String(e);
  }
}

// Every markdown file that feeds the docs site: the /docs booklets and guides build-content.mjs
// publishes, plus the site's own authored pages. Walked from the FILESYSTEM, not `git ls-files`
// (#907): shelling to `git` threw wherever the build ran from a `git archive` tarball with no
// `.git`, while CI — which has a full checkout — stayed green. node_modules and dotfiles are
// skipped; the two roots hold only authored markdown (the generated content/ dir is elsewhere).
function docFiles() {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(REPO, rel), { withFileTypes: true });
    } catch {
      return; // a root absent in this context is simply skipped, not fatal
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(child);
    }
  };
  walk('docs');
  walk('www-docs/authored');
  return out;
}

async function main() {
  const failures = [];
  let blocks = 0;
  let filesWithDiagrams = 0;

  for (const rel of docFiles()) {
    let text;
    try {
      text = readFileSync(join(REPO, rel), 'utf8');
    } catch {
      continue;
    }
    const found = extractMermaidBlocks(text);
    if (!found.length) continue;
    filesWithDiagrams++;
    for (const b of found) {
      blocks++;
      const err = await diagramError(b.code);
      if (err) failures.push({ file: rel, line: b.line, err });
    }
  }

  if (failures.length) {
    console.error('check-mermaid: a docs mermaid diagram has a syntax error.\n');
    for (const f of failures) {
      console.error(`  ${f.file}:${f.line}`);
      console.error(
        f.err
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n'),
      );
      console.error('');
    }
    console.error("mermaid renders in the READER'S browser, so a broken diagram builds green and");
    console.error('only shows a red parse-error box on the docs site. Fix the ```mermaid block above');
    console.error('(preview it with `npm run docs:dev`) so the page ships a diagram, not an error.');
    process.exit(1);
  }

  console.log(`check-mermaid: ${blocks} diagrams in ${filesWithDiagrams} files, all parse.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('check-mermaid: unexpected failure\n', e);
    process.exit(1);
  });
}
