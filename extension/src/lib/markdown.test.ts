// The SAFE Markdown renderer, checked against the untrusted input it exists for.
//
// `renderMarkdown` renders content nobody vouched for — an LLM reply (KimtAI) or a file
// someone opened (KimtFS). Escaping raw HTML tags is not enough on its own: a Markdown
// link or image URL is just as untrusted, and `[x](javascript:…)` / a `data:text/html`
// link are live XSS. These pin that the renderer neutralises unsafe URLs, escapes raw
// HTML, and still renders ordinary Markdown.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, highlightCode, marked } from './markdown.js';
import type { Tokens } from 'marked';

describe('renderMarkdown: safe rendering of untrusted Markdown', () => {
  test('neutralises a javascript: link', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /href="javascript:/i);
    assert.match(html, /href="#"/);
  });

  test('neutralises a javascript: image', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');
    assert.doesNotMatch(html, /src="javascript:/i);
  });

  test('neutralises a data:text/html link (navigating to it runs script)', () => {
    const html = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    assert.doesNotMatch(html, /href="data:text\/html/i);
  });

  test('a control-char-obfuscated scheme cannot sneak through', () => {
    // A tab inside the scheme: browsers ignore it, so it must not hide "javascript:".
    const html = renderMarkdown('[x](java\tscript:alert(1))');
    assert.doesNotMatch(html, /href="java[\s\S]*script:/i);
  });

  test('keeps safe URLs: http(s), relative, anchor, inline data:image', () => {
    assert.match(renderMarkdown('[a](https://example.test)'), /href="https:\/\/example\.test"/);
    assert.match(renderMarkdown('[a](./page.md)'), /href="\.\/page\.md"/);
    assert.match(renderMarkdown('[a](#top)'), /href="#top"/);
    assert.match(renderMarkdown('![i](data:image/png;base64,iVBOR)'), /src="data:image\/png;base64,iVBOR"/);
  });

  test('escapes raw HTML rather than injecting it', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    assert.doesNotMatch(html, /<img/i);
    assert.match(html, /&lt;img/);
  });

  test('still renders ordinary Markdown', () => {
    const html = renderMarkdown('# Title\n\n**bold** and `code`');
    assert.match(html, /<h1[^>]*>Title<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
  });
});

// Every table comes out inside a scroll container, so a table wider than the pane scrolls
// instead of pushing the rendered region sideways with its far columns unreachable (#1171).
//
// The per-block case below is the reason this is a renderer override and not a
// `hooks.postprocess`: Notes' live preview re-renders ONE block through `marked.parser()`,
// which runs the Parser directly and fires no hooks. A postprocess implementation passes
// the full-render test and silently does nothing in Notes — so the wrapper is asserted on
// both paths, not just the obvious one.
const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |';

describe('Markdown tables render inside a scroll container', () => {
  test('the safe renderer wraps a table (KimtAI replies, KimtFS previews)', () => {
    assert.match(renderMarkdown(TABLE_MD), /<div class="md-table-scroll"><table/);
  });

  test('the permissive renderer wraps a table (Notes)', () => {
    assert.match(marked.parse(TABLE_MD) as string, /<div class="md-table-scroll"><table/);
  });

  test("the per-block path wraps too — Notes' live preview renders one token at a time", () => {
    const tokens = marked.lexer(TABLE_MD);
    assert.equal(tokens[0]?.type, 'table', 'the fixture must lex to a single table token');
    assert.match(marked.parser([tokens[0] as Tokens.Table]), /<div class="md-table-scroll"><table/);
  });

  test('the wrapper closes around the table, not inside it', () => {
    const html = (marked.parse(TABLE_MD) as string).replace(/\s+/g, ' ');
    assert.match(html, /<div class="md-table-scroll">\s*<table>[\s\S]*<\/table>\s*<\/div>/);
  });

  test('stock table rendering survives — alignment and inline markup in cells', () => {
    const html = marked.parse('| a | b |\n|:---|---:|\n| `x` | **y** |') as string;
    assert.match(html, /<th align="left">a<\/th>/);
    assert.match(html, /<th align="right">b<\/th>/);
    assert.match(html, /<code>x<\/code>/);
    assert.match(html, /<strong>y<\/strong>/);
  });

  test('a table typed as raw HTML in a note is left alone (it is not a table token)', () => {
    // Documented limitation, pinned so the next reader does not take it for a bug: the
    // permissive renderer passes raw HTML through as an opaque token, so only a DOM pass
    // could reach it. Markdown tables — what the issue is about — are covered above.
    const html = marked.parse('<table><tr><td>raw</td></tr></table>') as string;
    assert.doesNotMatch(html, /md-table-scroll/);
  });
});

// The ONE highlighter. KimtFS colours a source file with the same call a fenced Markdown
// block goes through, so a `.ts` file and the same code in a note cannot look different and
// a language is registered in one place (#651). Its output is assigned to innerHTML, so
// escaping is the property that matters most here.
describe('highlightCode: the shared syntax highlighter', () => {
  test('colours a known language', () => {
    assert.match(highlightCode('const x = 1;', 'javascript'), /class="hljs-keyword">const</);
  });

  test('accepts a bare file extension, which is what a file name gives us', () => {
    assert.match(highlightCode('def f():\n  pass\n', 'py'), /class="hljs-keyword">def</);
  });

  test('falls back to plaintext for an unknown or missing language, and never drops the code', () => {
    assert.match(highlightCode('hello there', 'wat'), /hello there/);
    assert.match(highlightCode('hello there'), /hello there/);
  });

  test('escapes HTML in the source — the output goes straight into innerHTML', () => {
    const html = highlightCode('<img src=x onerror=alert(1)>', 'html');
    assert.doesNotMatch(html, /<img/, 'no live tag survives — only highlight.js’s own spans');
    assert.match(html, /&lt;/, 'the angle brackets come back escaped');
  });
});
