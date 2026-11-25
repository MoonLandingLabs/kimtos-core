// Voice Studio's long-form chunker. Kokoro truncates any utterance past ~510
// phoneme tokens, so narration MUST be split before synthesis — and the split must
// never drop text. These tests pin both: chunks stay within the budget, and the
// chunks concatenate back to the input (whitespace collapsed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, chunkText, MAX_CHUNK_CHARS } from './voiceChunk.js';

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('splitSentences', () => {
  test('splits on sentence terminators, keeping the punctuation', () => {
    assert.deepEqual(splitSentences('Hello world. How are you? I am fine!'), [
      'Hello world.',
      'How are you?',
      'I am fine!',
    ]);
  });

  test('keeps a trailing sentence with no terminator', () => {
    assert.deepEqual(splitSentences('First. Second'), ['First.', 'Second']);
  });

  test('empty and whitespace-only input yield no sentences', () => {
    assert.deepEqual(splitSentences(''), []);
    assert.deepEqual(splitSentences('   \n  '), []);
  });

  test('handles an ellipsis and a closing quote', () => {
    assert.deepEqual(splitSentences('"Stop!" she cried. And it did…'), ['"Stop!" she cried.', 'And it did…']);
  });
});

describe('chunkText', () => {
  test('a short input is a single chunk', () => {
    assert.deepEqual(chunkText('Just one sentence here.'), ['Just one sentence here.']);
  });

  test('packs consecutive short sentences up to the budget', () => {
    const text = 'One. Two. Three. Four.';
    const chunks = chunkText(text, 20);
    // all sentences fit under 20 chars when packed greedily
    for (const c of chunks) assert.ok(c.length <= 20, `"${c}" (${c.length}) exceeds budget`);
    assert.equal(collapse(chunks.join(' ')), collapse(text));
  });

  test('no chunk exceeds the budget for ordinary prose', () => {
    const para = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} in a long paragraph.`).join(' ');
    const chunks = chunkText(para);
    for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS, `chunk of ${c.length} chars`);
    assert.ok(chunks.length > 1, 'a long paragraph should split into several chunks');
    assert.equal(collapse(chunks.join(' ')), collapse(para));
  });

  test('splits a single over-long sentence at clause boundaries', () => {
    const clause = 'the quick brown fox jumps over the lazy dog';
    const long = `${clause}, ${clause}, ${clause}, ${clause}.`;
    const chunks = chunkText(long, 60);
    for (const c of chunks) assert.ok(c.length <= 60, `"${c}" (${c.length})`);
    assert.ok(chunks.length >= 2);
  });

  test('hard-splits a single word longer than the budget (never drops it)', () => {
    const word = 'a'.repeat(50);
    const chunks = chunkText(word, 20);
    for (const c of chunks) assert.ok(c.length <= 20);
    assert.equal(chunks.join(''), word);
  });

  test('drops no text across a mixed-length document', () => {
    const doc =
      'Short. ' +
      'A much longer sentence that on its own is comfortably under the budget but forces a new chunk when packed. ' +
      'Tiny. Another one here.';
    const chunks = chunkText(doc, 80);
    for (const c of chunks) assert.ok(c.length <= 80, `chunk of ${c.length}`);
    assert.equal(collapse(chunks.join(' ')), collapse(doc));
  });

  test('empty input yields no chunks', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('   '), []);
  });
});
