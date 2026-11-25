// The name a downloaded book lands under.
//
// Two cases are easy to get wrong and both are visible to the user: a book added by an older
// version from a URL is titled by the last path segment, so it usually already carries ".pdf" and would
// otherwise be saved as "paper.pdf.pdf"; and a title is free text, so it can carry
// characters that are illegal in a filename on Windows or macOS.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pdfFilename } from './download.js';

describe('PDF Library: the downloaded file name', () => {
  test('a plain title gets the extension', () => {
    assert.equal(pdfFilename('Design Patterns'), 'Design Patterns.pdf');
  });

  test('a title that already ends in .pdf is not doubled', () => {
    assert.equal(pdfFilename('paper.pdf'), 'paper.pdf');
    assert.equal(pdfFilename('paper.PDF'), 'paper.pdf');
  });

  test('an inner ".pdf" is left alone — only a trailing extension is stripped', () => {
    assert.equal(pdfFilename('the.pdf.spec'), 'the.pdf.spec.pdf');
  });

  test('characters illegal in a filename are replaced, not dropped silently', () => {
    assert.equal(pdfFilename('Q3: revenue / costs'), 'Q3- revenue - costs.pdf');
  });

  test('a missing or empty title falls back rather than producing ".pdf"', () => {
    assert.equal(pdfFilename(undefined), 'document.pdf');
    assert.equal(pdfFilename('   '), 'document.pdf');
    assert.equal(pdfFilename('.pdf'), 'document.pdf');
  });
});
