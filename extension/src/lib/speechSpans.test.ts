// The speech gate in front of Whisper (#710).
//
// Fed audio with no speech in it, the model does not report "nothing" — it
// invents, and then loops. Measured on the shipped `whisper-tiny` weights:
//
//   30 s of room tone at -34 dBFS        -> " you"
//   30 s of amplitude-modulated noise    -> " Oh, oh, oh, oh, …" (888 characters)
//   5 s of real speech + 60 s room tone  -> the sentence, then " you you"
//
// The last one is the one that matters: the whole-clip gate in `audioLevel.ts`
// passes that recording, because it DOES have sound in it. So the quiet stretches
// have to be found and withheld from the model, and these thresholds are the
// whole fix — too strict and a timid speaker is thrown away, too loose and the
// invented text comes back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  speechSpans,
  frameEnergies,
  FRAME_FLOOR,
  HANGOVER_S,
  MERGE_GAP_S,
  MAX_SPAN_S,
  MIN_SPAN_S,
  PAD_S,
} from './speechSpans.js';

const SR = 16000;
const n = (seconds: number): number => Math.round(seconds * SR);

/**
 * `seconds` of a 200 Hz tone under a 3 Hz syllabic envelope — the shape of a
 * voice, which is what the detector keys on. A CONSTANT tone would not do: with
 * no dynamics it is arithmetically indistinguishable from steady hiss, and the
 * detector rejects it on purpose (see the module header).
 */
function voice(seconds: number, amp = 0.3): Float32Array {
  const out = new Float32Array(n(seconds));
  for (let i = 0; i < out.length; i += 1) {
    const syllable = 0.15 + 0.85 * Math.abs(Math.sin((2 * Math.PI * 3 * i) / SR));
    out[i] = Math.sin((2 * Math.PI * 200 * i) / SR) * amp * syllable;
  }
  return out;
}

/** `seconds` of steady low-level hiss — a live mic in a quiet room. */
function roomTone(seconds: number, amp = 0.02): Float32Array {
  const out = new Float32Array(n(seconds));
  // Deterministic, so a threshold change is the only thing that can move a result.
  let seed = 1;
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = (seed / 2147483648 - 0.5) * 2 * amp;
  }
  return out;
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Does `spans` cover second `t` of the recording? */
const covers = (spans: { start: number; end: number }[], t: number): boolean =>
  spans.some((s) => t >= s.start && t <= s.end);

describe('frameEnergies', () => {
  test('is the RMS of each window', () => {
    const flat = new Float32Array(400).fill(0.5);
    const energies = frameEnergies(flat, 100);
    assert.equal(energies.length, 4);
    for (const e of energies) assert.ok(Math.abs(e - 0.5) < 1e-6, `${e}`);
  });

  test('drops the trailing partial window rather than under-reporting it', () => {
    assert.equal(frameEnergies(new Float32Array(250), 100).length, 2);
  });
});

describe('speechSpans', () => {
  test('an empty buffer has no speech', () => {
    assert.deepEqual(speechSpans(new Float32Array(0), SR), []);
  });

  test('digital silence has no speech', () => {
    assert.deepEqual(speechSpans(new Float32Array(n(30)), SR), []);
  });

  test('room tone alone has no speech — this is the clip that came back as "you"', () => {
    assert.deepEqual(speechSpans(roomTone(30), SR), []);
  });

  test('a loud steady hiss still has no speech: it never rises above its own floor', () => {
    // The absolute gate cannot tell this from a voice; the relative one can.
    assert.deepEqual(speechSpans(roomTone(30, 0.3), SR), []);
  });

  test('speech alone is one span covering it', () => {
    const spans = speechSpans(voice(5), SR);
    assert.equal(spans.length, 1);
    assert.ok(spans[0].start <= 0.05 && spans[0].end >= 4.9, JSON.stringify(spans));
  });

  test('a quiet voice note is still found', () => {
    // -30 dBFS, quieter than anyone records on purpose (the same bar audioLevel holds).
    const spans = speechSpans(voice(5, 0.03), SR);
    assert.equal(spans.length, 1);
    assert.ok(spans[0].end - spans[0].start > 4.5, JSON.stringify(spans));
  });

  test('the long silent tail of a real recording is withheld from the model', () => {
    // The regression: 5 s of speech then 60 s of room tone. Before the gate, the
    // whole 65 s went to Whisper and it appended a fabricated " you you".
    const spans = speechSpans(join(voice(5), roomTone(60)), SR);
    assert.equal(spans.length, 1);
    assert.ok(covers(spans, 2.5), 'the speech is kept');
    assert.ok(spans[0].end < 5 + PAD_S + HANGOVER_S + 0.1, `tail leaked: ${JSON.stringify(spans)}`);
    assert.ok(!covers(spans, 40), 'the silent tail is gone');
  });

  test('speech in the middle of a long quiet recording is found, and only it', () => {
    const spans = speechSpans(join(roomTone(30), voice(5), roomTone(60)), SR);
    assert.equal(spans.length, 1);
    assert.ok(covers(spans, 32), JSON.stringify(spans));
    assert.ok(!covers(spans, 10) && !covers(spans, 70), JSON.stringify(spans));
  });

  test('a long pause splits the recording into two spans', () => {
    const spans = speechSpans(join(voice(3), roomTone(6), voice(3)), SR);
    assert.equal(spans.length, 2, JSON.stringify(spans));
    assert.ok(covers(spans, 1.5) && covers(spans, 10), JSON.stringify(spans));
    assert.ok(!covers(spans, 6), 'the pause itself is not transcribed');
  });

  test('a short pause does not split: one inference is cheaper than two', () => {
    const gap = MERGE_GAP_S - 0.5;
    const spans = speechSpans(join(voice(3), roomTone(gap), voice(3)), SR);
    assert.equal(spans.length, 1, JSON.stringify(spans));
  });

  test('a breath mid-sentence does not cut the word in half', () => {
    // Shorter than the hangover, so the span never closes at all.
    const spans = speechSpans(join(voice(2), roomTone(HANGOVER_S / 2), voice(2)), SR);
    assert.equal(spans.length, 1, JSON.stringify(spans));
    assert.ok(covers(spans, 2.1), JSON.stringify(spans));
  });

  test('merging stops at one Whisper window', () => {
    const spans = speechSpans(join(voice(20), roomTone(1), voice(20)), SR);
    assert.ok(spans.length >= 2, JSON.stringify(spans));
    for (const s of spans) assert.ok(s.end - s.start <= MAX_SPAN_S + 2 * PAD_S, `${s.end - s.start}s`);
  });

  test('a single click is too short to be a word', () => {
    const click = new Float32Array(n(30));
    click[n(5)] = 0.9;
    const spans = speechSpans(click, SR);
    // Either nothing, or nothing that survives the minimum length.
    for (const s of spans) assert.ok(s.end - s.start >= MIN_SPAN_S, JSON.stringify(spans));
    assert.ok(spans.length <= 1, JSON.stringify(spans));
  });

  test('spans are ordered, non-overlapping and inside the recording', () => {
    const total = 3 + 6 + 3 + 6 + 3;
    const spans = speechSpans(join(voice(3), roomTone(6), voice(3), roomTone(6), voice(3)), SR);
    assert.ok(spans.length > 1);
    let last = 0;
    for (const s of spans) {
      assert.ok(s.start >= last, JSON.stringify(spans));
      assert.ok(s.end > s.start, JSON.stringify(spans));
      assert.ok(s.end <= total + 1e-6, JSON.stringify(spans));
      last = s.end;
    }
  });

  test('the absolute floor is the one a quiet voice must clear', () => {
    // Pinned so a well-meaning "let's be stricter" edit has to argue with a test.
    assert.ok(FRAME_FLOOR < 0.03, 'a -30 dBFS voice note must stay above the floor');
  });
});
