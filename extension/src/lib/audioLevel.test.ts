// The silence gate in front of Whisper (#805).
//
// Fed a recording with no sound, Whisper does not answer "nothing" — it invents
// a token, reliably the word "you", and the user is shown a confident
// transcript of a clip that never had any audio in it. The only defence is to
// measure the samples first, so these thresholds are the whole fix: too strict
// and a genuinely quiet voice note is thrown away, too loose and the
// hallucination comes back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, isSilent, SILENT_PEAK, SILENT_RMS } from './audioLevel.js';

/** `n` samples of a sine at `amp` full-scale amplitude — a stand-in for speech. */
function tone(n: number, amp: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.sin((i / 32) * Math.PI * 2) * amp;
  return out;
}

describe('levelOf', () => {
  test('an empty buffer has no level', () => {
    assert.deepEqual(levelOf(new Float32Array(0)), { peak: 0, rms: 0 });
  });

  test('reports the peak and the RMS of a tone', () => {
    const { peak, rms } = levelOf(tone(3200, 0.5));
    assert.ok(Math.abs(peak - 0.5) < 0.01, `peak ${peak}`);
    // RMS of a sine is amplitude / sqrt(2).
    assert.ok(Math.abs(rms - 0.5 / Math.SQRT2) < 0.01, `rms ${rms}`);
  });

  test('peak is amplitude, not signed value', () => {
    // Float32 rounds 0.8, so compare with a tolerance rather than exactly.
    assert.ok(Math.abs(levelOf(new Float32Array([0, -0.8, 0.2])).peak - 0.8) < 1e-6);
  });
});

describe('isSilent', () => {
  test('a flat buffer is silent', () => {
    assert.equal(isSilent(levelOf(new Float32Array(1600))), true);
  });

  test('a dead mic (noise floor only) is silent', () => {
    const floor = new Float32Array(1600);
    for (let i = 0; i < floor.length; i += 1) floor[i] = (i % 2 ? 1 : -1) * 0.0005;
    assert.equal(isSilent(levelOf(floor)), true);
  });

  test('one click over a long, otherwise empty clip is silent', () => {
    const click = new Float32Array(16000 * 60); // a minute at 16 kHz
    click[16000] = 0.9; // one loud pop, no energy anywhere else
    const level = levelOf(click);
    assert.ok(level.peak > SILENT_PEAK, 'the pop clears the peak threshold');
    assert.equal(isSilent(level), true, 'but the RMS gives it away');
  });

  test('a quiet voice note is NOT silent', () => {
    // -30 dBFS: quieter than anyone records on purpose, and still kept.
    const level = levelOf(tone(16000, 0.03));
    assert.ok(level.peak > SILENT_PEAK && level.rms > SILENT_RMS, JSON.stringify(level));
    assert.equal(isSilent(level), false);
  });

  test('a normal voice note is NOT silent', () => {
    assert.equal(isSilent(levelOf(tone(16000, 0.4))), false);
  });
});
