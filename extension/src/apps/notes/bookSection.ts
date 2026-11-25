// A page's NAME is text, not Markdown.
//
// The book view, both PDF exports and the .md/.zip downloads all built the document
// `# ${page.title}\n\n${page.content}` and handed the whole thing to the Markdown
// engine. A name is free text typed into a prompt, so ordinary ones came back
// corrupted: `50% *done* #` rendered as "50% done" — the trailing `#` eaten as an ATX
// closing sequence and `*done*` turned into emphasis — and a name containing a newline
// split into a heading plus a stray paragraph (#1166).
//
// So the RENDERED surfaces (the book view, both PDFs) take the name as text and parse
// only the note body. A `.md`/`.zip` export is a Markdown *file*, where a real `#`
// heading is the point; there the name only has its whitespace collapsed, so it cannot
// break the heading across lines.

import { el, escapeHtml } from '../../lib/dom.js';

/** Render a note body to HTML (the app's `marked` instance, injected so this is testable). */
export type RenderMd = (src: string) => string;

interface BookPage {
  id?: string;
  title?: string;
  content?: string;
}

const pageTitle = (page: BookPage): string => page.title || 'Untitled';

/**
 * One page of the reading view: the name as a real heading node, then the rendered body.
 *
 * The caller still runs `enhanceLinks` over the returned section — the body's anchors are
 * in the DOM by the time this returns.
 */
export function buildBookSection(page: BookPage, render: RenderMd): HTMLElement {
  const section = el('section', 'doc-book-page');
  if (page.id) section.dataset.id = page.id;
  section.append(el('h1', undefined, pageTitle(page)));
  // Raw HTML in a note is DELIBERATE, and this is not the only place it happens: Notes renders
  // through the permissive `marked` instance everywhere (see lib/markdown.ts, which documents the
  // two entry points, and index.ts's editor preview, which inserts renderBlock output the same
  // way). Semgrep flags this call and not that one only because of how its taint rule matches, so
  // sanitizing here alone would buy nothing and would silently drop a documented capability.
  //
  // The real question — whether a note may contain raw HTML at all, given PDF Library writes
  // highlights from arbitrary PDFs into Notes — is open in #1195. It is a product decision that
  // applies to the whole app, not to this line, and suppressing here does not make it worse.
  //
  // The rule is `typescript.react.*`, and there is no React in this repo: it is looking for
  // `dangerouslySetInnerHTML`-shaped sinks and matching a plain DOM call. Named exactly rather
  // than a bare `nosemgrep`, so a genuinely different finding on this line still fails the build.
  // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method
  section.insertAdjacentHTML('beforeend', render(page.content || ''));
  return section;
}

/** The same page as an HTML string, for the print/PDF document. */
export const bookSectionHtml = (page: BookPage, render: RenderMd): string =>
  `<h1>${escapeHtml(pageTitle(page))}</h1>${render(page.content || '')}`;

/**
 * The `# <name>` heading for a Markdown file, or '' when the page is unnamed.
 *
 * Whitespace is collapsed to a single line: a name is one line by definition, and a
 * multi-line one would otherwise emit a heading followed by loose body text.
 */
export const mdHeading = (title: string | undefined): string => {
  const line = (title || '').replace(/\s+/g, ' ').trim();
  return line && line !== 'Untitled' ? `# ${line}\n\n` : '';
};
