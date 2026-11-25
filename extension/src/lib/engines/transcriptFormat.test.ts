// paragraphsFromChunks (#957) — the transcript used to be Whisper's joined string: one
// unbroken line however long the recording, in the card and in the downloaded .txt.
// These pin the rebuild: segments flow into a paragraph, a real pause starts a new one,
// and a model that returns no chunks falls back to the plain string untouched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  paragraphsFromChunks,
  collapseLoops,
  dropRepeatedSegments,
  plausibleTranscript,
  PARAGRAPH_GAP_S,
  LOOP_REPEATS,
  LOOP_PHRASE_WORDS,
  MIN_WORDS_PER_S,
  DENSITY_MIN_S,
  type TranscriptChunk,
} from './transcriptFormat.js';

const chunk = (start: number | null, end: number | null, text: string): TranscriptChunk => ({
  timestamp: [start, end],
  text,
});

describe('paragraphsFromChunks (#957)', () => {
  test('segments in continuous speech join into one paragraph with single spaces', () => {
    const out = paragraphsFromChunks(
      [chunk(0, 2.4, ' Hello there.'), chunk(2.5, 4.0, ' How are you?'), chunk(4.2, 6.0, ' Fine, thanks.')],
      'ignored',
    );
    assert.equal(out, 'Hello there. How are you? Fine, thanks.');
  });

  test('a pause at or above the threshold starts a new paragraph', () => {
    const out = paragraphsFromChunks(
      [chunk(0, 2, ' First thought.'), chunk(2 + PARAGRAPH_GAP_S, 6, ' A new thought.')],
      'ignored',
    );
    assert.equal(out, 'First thought.\n\nA new thought.');
  });

  test('a pause just under the threshold does not break the paragraph', () => {
    const out = paragraphsFromChunks(
      [chunk(0, 2, ' First.'), chunk(2 + PARAGRAPH_GAP_S - 0.05, 5, ' Still going.')],
      'ignored',
    );
    assert.equal(out, 'First. Still going.');
  });

  test('a null boundary (the final chunk at runtime) is treated as continuous speech', () => {
    const out = paragraphsFromChunks([chunk(0, null, ' Trailing segment.'), chunk(null, null, ' The end.')], 'x');
    assert.equal(out, 'Trailing segment. The end.');
  });

  test('empty and whitespace-only segments are dropped, not rendered as stray gaps', () => {
    const out = paragraphsFromChunks([chunk(0, 1, '  '), chunk(1, 2, ' Real text. '), chunk(2, 3, '')], 'ignored');
    assert.equal(out, 'Real text.');
  });

  test('no chunks at all falls back to the plain joined text, trimmed', () => {
    assert.equal(paragraphsFromChunks(undefined, '  the whole string  '), 'the whole string');
    assert.equal(paragraphsFromChunks([], 'plain'), 'plain');
  });

  test('all-empty chunks fall back to the plain text too', () => {
    assert.equal(paragraphsFromChunks([chunk(0, 1, ' ')], 'fallback'), 'fallback');
  });

  test('silence stays an empty string — the "No speech detected" contract (#805)', () => {
    assert.equal(paragraphsFromChunks(undefined, ''), '');
    assert.equal(paragraphsFromChunks([], '  '), '');
  });

  test('a looping segment is collapsed on the way through', () => {
    const loop = ' ' + 'Oh, '.repeat(200).trim();
    assert.equal(paragraphsFromChunks([chunk(0, 30, loop)], 'x'), 'Oh,');
  });

  test('the fallback text is guarded too — a model without chunks can still loop', () => {
    assert.equal(paragraphsFromChunks(undefined, 'no no no no no no'), 'no');
  });
});

// The runaway-repetition guard (#710). Measured on the shipped whisper-tiny weights,
// 30 s of non-speech comes back as "Oh, oh, oh, oh, …" — 888 characters of a phrase
// nobody said. Transformers.js implements none of the upstream safety valves
// (no_speech_threshold, compression_ratio_threshold, the temperature fallback), so
// nothing in the library stops the decoder once it starts; this is the stop.
describe('collapseLoops (#710)', () => {
  test('leaves ordinary speech exactly as it was', () => {
    const text = 'The quick brown fox jumps over the lazy dog. This is a short test.';
    assert.equal(collapseLoops(text), text);
  });

  test('collapses the measured failure: one word repeated two hundred times', () => {
    assert.equal(collapseLoops('Oh, '.repeat(200)), 'Oh,');
  });

  test('collapses a repeated phrase, not just a repeated word', () => {
    assert.equal(collapseLoops("I'm the only one. ".repeat(30)), "I'm the only one.");
  });

  test('matches across capitalisation and punctuation', () => {
    assert.equal(collapseLoops('Oh oh, OH. oh oh'), 'Oh');
  });

  test('collapses a run of bare punctuation, which the model also emits', () => {
    assert.equal(collapseLoops('. . . . . .'), '.');
  });

  test('does not confuse two different punctuation marks', () => {
    assert.equal(collapseLoops('. - . - . -'), '. - . - . -');
  });

  test('keeps a repetition a person could plausibly have said', () => {
    // One below the threshold: emphasis, not a decoder fault.
    const said = Array(LOOP_REPEATS - 1)
      .fill('no')
      .join(' ');
    assert.equal(collapseLoops(said), said);
  });

  test('keeps the text around a loop', () => {
    assert.equal(collapseLoops('Right, so ' + 'yes '.repeat(10) + 'that is all.'), 'Right, so yes that is all.');
  });

  test('collapses two separate loops independently', () => {
    assert.equal(collapseLoops('a a a a b b b b'), 'a b');
  });

  test('a phrase longer than the guard looks for is left alone', () => {
    const long = Array.from({ length: LOOP_PHRASE_WORDS + 1 }, (_, i) => `w${i}`).join(' ');
    const text = Array(LOOP_REPEATS).fill(long).join(' ');
    assert.equal(collapseLoops(text), text);
  });

  test('empty in, empty out', () => {
    assert.equal(collapseLoops(''), '');
    assert.equal(collapseLoops('   '), '');
  });
});

describe('dropRepeatedSegments (#710)', () => {
  const seg = (text: string): { text: string } => ({ text });

  test('collapses a run of identical segments to one', () => {
    const parts = Array(12)
      .fill(null)
      .map(() => seg(' Thank you.'));
    assert.deepEqual(dropRepeatedSegments(parts), [seg(' Thank you.')]);
  });

  test('keeps a run shorter than the threshold', () => {
    const parts = Array(LOOP_REPEATS - 1)
      .fill(null)
      .map(() => seg('Yes.'));
    assert.equal(dropRepeatedSegments(parts).length, LOOP_REPEATS - 1);
  });

  test('leaves distinct segments alone', () => {
    const parts = [seg('One.'), seg('Two.'), seg('Three.'), seg('Four.'), seg('Five.')];
    assert.deepEqual(dropRepeatedSegments(parts), parts);
  });

  test('only consecutive repeats count', () => {
    const parts = [seg('a'), seg('b'), seg('a'), seg('b'), seg('a'), seg('b')];
    assert.deepEqual(dropRepeatedSegments(parts), parts);
  });

  test('keeps the text either side of the run', () => {
    const parts = [
      seg('Before.'),
      ...Array(8)
        .fill(null)
        .map(() => seg('Bye.')),
      seg('After.'),
    ];
    assert.deepEqual(dropRepeatedSegments(parts), [seg('Before.'), seg('Bye.'), seg('After.')]);
  });
});

describe('plausibleTranscript (#710)', () => {
  test('two words from thirty seconds of sound is not a transcription', () => {
    assert.equal(plausibleTranscript('Thank you.', 30), false);
  });

  test('a real transcript of the same length is kept', () => {
    assert.equal(plausibleTranscript('The quick brown fox jumps over the lazy dog and keeps on running.', 30), true);
  });

  test('short stretches are never judged — one word can be all there was', () => {
    assert.equal(plausibleTranscript('Hello', DENSITY_MIN_S - 0.01), true);
  });

  test('the floor is an order of magnitude below normal speech', () => {
    // Speech runs at two to three words a second; pinned so nobody quietly raises it.
    assert.ok(MIN_WORDS_PER_S <= 0.5, `${MIN_WORDS_PER_S}`);
  });

  test('exactly on the floor is kept, not dropped', () => {
    const seconds = 40;
    const words = Array(Math.ceil(seconds * MIN_WORDS_PER_S))
      .fill('word')
      .join(' ');
    assert.equal(plausibleTranscript(words, seconds), true);
  });

  test('an empty transcript for a long stretch is implausible', () => {
    assert.equal(plausibleTranscript('', 30), false);
  });

  test('a nonsense duration does not throw the guard off', () => {
    assert.equal(plausibleTranscript('anything', Number.NaN), true);
  });
});
