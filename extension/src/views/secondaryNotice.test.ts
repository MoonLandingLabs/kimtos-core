// The sentence the takeover notice shows — the user-facing half of #1270.
//
// "Use here instead" asks for consent to destroy work, and it used to describe that work as
// "anything still playing". A user mid-way through a noise-reduction pass was told nothing was at
// stake and reasonably believed it, because playback is the only thing that sentence covers.
//
// The wording is what the user actually decides on, so it is asserted directly rather than through
// a rendered card: what breaks here is not markup but a claim about consequences.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeHolderWork, noticeNote } from './secondaryNotice.js';
import type { HolderJob } from '../lib/presenceShared.js';

const job = (over: Partial<HolderJob> = {}): HolderJob => ({
  appId: 'vidrec',
  name: 'Video Recorder',
  label: 'Cleaning audio',
  ratio: 0.64,
  savesOnStop: true,
  cancellable: true,
  ...over,
});

describe('what the other tab is working on', () => {
  test('with nothing running, the note is the standing sentence and no more', () => {
    assert.equal(describeHolderWork([]), '');
    assert.equal(noticeNote([]), 'Using it here closes the apps in the other tab, including anything still playing.');
  });

  test('the reported case is named, with its app, its stage and how far along it is', () => {
    // The exact scenario in the issue: record with Reduce noise on, then take over from a new tab.
    const note = noticeNote([job()]);
    assert.match(note, /Video Recorder — Cleaning audio \(64%\)/);
    assert.match(note, /Taking over will stop it\./);
    assert.ok(note.startsWith('Using it here closes the apps'), 'the standing sentence still leads');
  });

  test('unmeasurable work reports no percentage rather than a made-up one', () => {
    const note = describeHolderWork([job({ ratio: null })]);
    assert.match(note, /Video Recorder — Cleaning audio\./);
    assert.doesNotMatch(note, /%/, 'a progress readout may never invent a number');
  });

  test('work that keeps what it produced says so; work that does not says the opposite', () => {
    assert.match(describeHolderWork([job()]), /What it has already produced is kept\./);
    assert.match(
      describeHolderWork([job({ appId: 'voicestudio', name: 'Voice Studio', savesOnStop: false })]),
      /Whatever is unfinished is discarded\./,
    );
  });

  test('on a MIXED set the pessimistic sentence wins', () => {
    // Deliberate. Over-warning costs a takeover the user could have made; under-warning costs work
    // they cannot get back, and only one of those is recoverable. The reassuring sentence is written
    // only when it holds for every job named.
    const note = describeHolderWork([job(), job({ appId: 'voicestudio', name: 'Voice Studio', savesOnStop: false })]);
    assert.match(note, /Whatever is unfinished is discarded\./);
    assert.doesNotMatch(note, /already produced is kept/);
  });

  test('several jobs are listed as English, and addressed as several', () => {
    const note = describeHolderWork([
      job({ ratio: null, label: 'Cleaning audio' }),
      job({ appId: 'thoth', name: 'Thoth', label: 'Indexing 3/9', ratio: null }),
      job({ appId: 'voicestudio', name: 'Voice Studio', label: 'Generating', ratio: null }),
    ]);
    assert.match(note, /Video Recorder — Cleaning audio, Thoth — Indexing 3\/9 and Voice Studio — Generating\./);
    assert.match(note, /Taking over will stop them\./);
  });

  test('work that cannot be stopped is named as CONTINUING, not promised a stop', () => {
    // The one thing worse than not naming the work is naming it and promising something untrue:
    // `kimtManager.cancel` is a no-op on a job declaring `cancellable: false`.
    const note = describeHolderWork([job({ appId: 'denoise', name: 'Denoise', cancellable: false })]);
    assert.match(note, /Denoise cannot be stopped and will keep running\./);
    assert.doesNotMatch(note, /will stop/, 'nothing here is being stopped');
  });

  test('a stoppable and an unstoppable job each get their own true sentence', () => {
    const note = describeHolderWork([job(), job({ appId: 'denoise', name: 'Denoise', cancellable: false })]);
    assert.match(note, /Taking over will stop it\./, 'singular: only one of the two is being stopped');
    assert.match(note, /Denoise cannot be stopped and will keep running\./);
  });
});
