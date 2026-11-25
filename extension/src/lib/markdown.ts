// Shared Markdown rendering: a `marked` instance with GFM + syntax highlighting
// (highlight.js). Used by Notes (trusted, user-authored notes) and KimtAI
// (model output). Rendered HTML goes in a `.md-preview` container for styling.
//
// Two entry points:
//   marked           — permissive instance (raw HTML passes through). For content
//                      the user authored themselves (notes).
//   renderMarkdown() — escapes raw HTML tags, so untrusted model output can't
//                      inject markup/script into the page. For KimtAI replies.

import { Marked, Renderer, type Token, type Tokens } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import mdlang from 'highlight.js/lib/languages/markdown';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.css';
import { escapeHtml } from './dom.js';

for (const [name, lang] of Object.entries({
  javascript,
  typescript,
  python,
  rust,
  bash,
  json,
  xml,
  css,
  go,
  sql,
  yaml,
  markdown: mdlang,
  c,
  cpp,
  java,
  plaintext, // fallback for fenced blocks with no/unknown language
})) {
  hljs.registerLanguage(name, lang);
}

/**
 * Syntax-highlight a block of code to HTML.
 *
 * The ONE highlighter in the app: same instance, same registered languages, same
 * palette as a fenced Markdown block — so a `.ts` file opened in KimtFS and the same
 * code pasted into a note colour identically, and teaching the app a new language is
 * still one edit. `lang` may be a language name or a bare file extension (`ts`, `py`,
 * `yml`); highlight.js resolves those as aliases. Anything it does not know falls back
 * to plaintext, which escapes the source rather than dropping it.
 *
 * The output is HTML-escaped by highlight.js, so it is safe to assign to `innerHTML`.
 */
export function highlightCode(code: string, lang?: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return escapeHtml(code);
  }
}

// A fresh marked-highlight extension (the instance can't be shared across Marked
// objects). Highlights fenced code; never lets one bad block blank the output.
const highlightExt = () =>
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight: (code, lang) => highlightCode(code, lang),
  });

// Every table renders inside its own sideways-scrolling block, so a table wider than the
// pane scrolls rather than pushing the whole rendered region off-screen with its far
// columns unreachable (#1171). It is the same treatment `pre` already gets from
// `.md-preview pre { overflow-x: auto }`; `max-width` cannot do it, because a table sizes
// to its content and overflows anyway.
//
// Two things here are load-bearing, and both look like they could be simplified:
//
//   `Renderer.prototype.table.call(this, …)`, not `this.table(…)`. `use()` REPLACES
//   `renderer.table` with this function, so `this.table` is infinite recursion, and it
//   keeps the method it replaced in a closure with no public accessor. `this` is the live
//   renderer, so cells and alignment are still rendered by the stock code path.
//
//   A renderer override rather than a `hooks.postprocess`. Notes' live preview re-renders
//   ONE block at a time through `marked.parser([token])` (apps/notes/index.ts), and
//   `parser()` calls the Parser directly — it runs no hooks. A postprocess wrap works in
//   the full-document render and silently does nothing in Notes, which is one of the three
//   surfaces this is for. Renderers run on both paths.
const scrollableTables = {
  renderer: {
    table(this: Renderer, token: Tokens.Table): string {
      return `<div class="md-table-scroll">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
};

// Permissive instance — raw HTML in the source is rendered as-is.
export const marked = new Marked(highlightExt());
marked.use(scrollableTables);
marked.setOptions({ gfm: true, breaks: true });

// Safe instance — raw HTML tags are escaped to visible text (no markup injection).
const htmlText = (t: unknown): string => escapeHtml(typeof t === 'string' ? t : ((t as { text?: string })?.text ?? ''));
// A link/image URL is as untrusted as the rest of the source. Escaping raw HTML tags
// (above) does NOT touch Markdown link/image URLs, so `[x](javascript:…)` and a
// `data:text/html` link are live XSS in the safe renderer. Allow only a safe scheme, or
// no scheme at all (relative / anchor); inline `data:image/` is fine (it can't execute).
const isSafeUrl = (href: string): boolean => {
  // Drop whitespace + C0 control characters for the scheme probe: a browser ignores them
  // inside a scheme (`java\tscript:`), so they must not hide one from the check.
  let probe = '';
  for (const ch of href || '') if ((ch.codePointAt(0) ?? 0) > 0x20) probe += ch;
  probe = probe.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) {
    return /^(?:https?|mailto|tel):/.test(probe) || probe.startsWith('data:image/');
  }
  return true;
};

const safe = new Marked(highlightExt(), { renderer: { html: htmlText } });
// Neutralise unsafe link/image URLs before rendering (protects every consumer of the
// safe instance — KimtAI replies and KimtFS files alike).
safe.use({
  walkTokens(token: Token) {
    if ((token.type === 'link' || token.type === 'image') && !isSafeUrl(token.href)) token.href = '#';
  },
});
safe.use(scrollableTables);
safe.setOptions({ gfm: true, breaks: true });

// Render Markdown from an untrusted source (e.g. an LLM reply, a KimtFS file) to an HTML
// string: raw HTML tags escaped, unsafe link/image URLs neutralised.
export const renderMarkdown = (src: string): string => safe.parse(src || '') as string;

// Add a hover "Copy" button to every fenced code block under `root` (idempotent).
function enhanceCodeBlocks(root: ParentNode): void {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector('.md-code-copy')) continue;
    const code = pre.querySelector('code');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-code-copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText((code || pre).textContent ?? '').catch(() => {});
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
    pre.classList.add('has-copy');
    pre.append(btn);
  }
}

// Render untrusted Markdown into a container and wire up code-block copy buttons.
export function renderMarkdownInto(container: HTMLElement, src: string): void {
  container.innerHTML = renderMarkdown(src);
  enhanceCodeBlocks(container);
}
