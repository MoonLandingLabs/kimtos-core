// A page's name must survive Export as Book verbatim, and its body must keep the
// paragraphs the writer typed.
//
// Both were broken by the same line: every rendered surface built the document
// `# ${title}\n\n${content}` and parsed the lot as Markdown, so a name typed into the
// rename prompt was reinterpreted on the way out — `50% *done* #` came back as
// "50% done", with the trailing hash eaten as an ATX closing sequence and the middle
// word italicised, and a name containing a newline split into a heading plus a stray
// paragraph (#1166). A note's NAME is text; only its body is Markdown.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';
import { marked } from '../../lib/markdown.js';
import { buildBookSection, bookSectionHtml, mdHeading } from './bookSection.js';

const render = (src: string): string => marked.parse(src) as string;

describe('notes book section', () => {
  let env: DomEnv;
  before(() => {
    env = installDom();
  });
  after(() => env.cleanup());

  test('a name containing markdown characters is shown exactly as typed', () => {
    const section = buildBookSection({ title: '50% *done* #', content: 'body' }, render);
    const h1 = section.querySelector('h1')!;
    assert.equal(h1.textContent, '50% *done* #');
    assert.equal(h1.querySelector('em'), null, 'the name must not be re-parsed as markdown');
  });

  test('a name containing markup is text, not markup', () => {
    const section = buildBookSection({ title: '<b>x</b> & <script>', content: '' }, render);
    assert.equal(section.querySelector('h1')!.textContent, '<b>x</b> & <script>');
    assert.equal(section.querySelector('b'), null);
    assert.equal(section.querySelector('script'), null);
  });

  test('an unnamed page still gets a heading', () => {
    assert.equal(buildBookSection({ content: 'body' }, render).querySelector('h1')!.textContent, 'Untitled');
  });

  test('the page id rides on the section, so internal links can scroll to it', () => {
    assert.equal(buildBookSection({ id: 'p1', title: 'A' }, render).dataset.id, 'p1');
  });

  test('paragraphs and line breaks in the body survive', () => {
    const section = buildBookSection({ title: 'A', content: 'one\n\ntwo\nthree' }, render);
    const paras = section.querySelectorAll('p');
    assert.equal(paras.length, 2, 'a blank line separates two paragraphs');
    assert.equal(paras[1].querySelectorAll('br').length, 1, 'a single newline is a line break');
  });

  test('the body is still markdown', () => {
    const section = buildBookSection({ title: 'A', content: '**bold**' }, render);
    assert.equal(section.querySelector('strong')!.textContent, 'bold');
  });

  test('the print/PDF variant escapes the name instead of rendering it', () => {
    const html = bookSectionHtml({ title: '<b>x</b> *y*', content: 'body' }, render);
    assert.match(html, /<h1>&lt;b&gt;x&lt;\/b&gt; \*y\*<\/h1>/);
    assert.match(html, /<p>body<\/p>/);
  });

  test('a markdown file gets a real heading, collapsed to one line', () => {
    assert.equal(mdHeading('Trip  notes\nday one'), '# Trip notes day one\n\n');
  });

  test('an unnamed page contributes no heading to the markdown file', () => {
    assert.equal(mdHeading('Untitled'), '');
    assert.equal(mdHeading(''), '');
    assert.equal(mdHeading(undefined), '');
    assert.equal(mdHeading('   '), '');
  });
});
