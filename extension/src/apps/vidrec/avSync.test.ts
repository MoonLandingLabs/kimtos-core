// A clip that is a little late on the video side must not leave the audio behind.
//
// Reproduces the reported drift: after about 25 minutes the cleaned audio was out of sync with
// the picture. The video element stalls now and then (decoder hiccup, throttled tab) while the
// audio source keeps running on its own clock, and the lag accumulates. The simulation runs 40
// minutes with a 25 ms video stall every 10 s and checks the worst audio/video offset.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { audioPosition, resyncOffset, RESYNC_TOLERANCE_S } from './avSync.js';

const TICK = 0.1; // the progress clock runs at 10 Hz
const TOTAL = 40 * 60;
const STALL_EVERY = 10;
const STALL = 0.025;

function simulate(correct: boolean): number {
  let now = 0;
  let videoTime = 0;
  let nextStall = STALL_EVERY;
  let offset = 0;
  let startedAt = 0;
  let worst = 0;
  for (let step = 0; now < TOTAL; step += 1) {
    now = Math.round((now + TICK) * 1e6) / 1e6;
    videoTime += TICK;
    if (now >= nextStall) {
      videoTime -= STALL; // the picture lost this much time
      nextStall += STALL_EVERY;
    }
    if (correct) {
      const to = resyncOffset(videoTime, audioPosition(offset, startedAt, now), TOTAL);
      if (to !== null) {
        offset = to;
        startedAt = now;
      }
    }
    worst = Math.max(worst, Math.abs(audioPosition(offset, startedAt, now) - videoTime));
  }
  return worst;
}

describe('re-mux audio/video sync', () => {
  test('without correction the audio drifts far past what the eye tolerates', () => {
    assert.ok(simulate(false) > 5, 'the free-running audio clock gains seconds over 40 minutes');
  });

  test('with correction the offset never exceeds tolerance plus one tick', () => {
    assert.ok(simulate(true) <= RESYNC_TOLERANCE_S + STALL + 1e-6);
  });

  test('in-step audio is left alone', () => {
    assert.equal(resyncOffset(100, 100.02, 600), null);
  });

  test('restarts at the video position, clamped to the audio length', () => {
    assert.equal(resyncOffset(100, 101, 600), 100);
    assert.equal(resyncOffset(700, 500, 600), 600);
    assert.equal(resyncOffset(Infinity, 1, 600), null);
  });
});
