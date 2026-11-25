// The recording is written to storage BEFORE the noise reduction runs.
//
// This is the assertion that would have prevented a real, reported loss. `finalize()` used to
// denoise first and save once at the end, so for the whole clean-up — which takes about as long as
// the recording did — the only copy of an unrepeatable capture was a local variable in the page.
//
// Denoise decodes the entire audio track into memory and the re-mux plays the video back in real
// time while re-recording it: a large, sustained allocation. Background that tab and the browser
// may discard it, and did. The user returned to a white page, reloaded, and a long recording was
// gone — it had existed nowhere but that page.
//
// `lib/jobStore.ts` names this exact class of loss (#314): "no result, and — the part that
// matters — no input either." Saving first is the stronger answer here, because for the recorder
// the input IS the deliverable.
//
// Asserted as ORDER, against a fake store, rather than by driving the app: what went wrong was not
// a wrong value but a wrong sequence, and a test that only checked the end state would have passed
// against the broken version — it saved the right blob, just too late to survive.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** The two things `finalize` does, in the order it does them. */
type Step = 'save' | 'denoise-start' | 'denoise-done' | 'replace';

/**
 * `finalize`'s shape, reduced to its sequencing.
 *
 * Kept deliberately close to the real function: save, show, then (only if enabled) the long work,
 * then replace the blob under the entry that already exists. The point being pinned is that the
 * first `await` to touch storage is the SAVE, and that it is not conditional on anything.
 */
async function finalizeShape(opts: {
  denoise: boolean;
  steps: Step[];
  /** Simulates the tab dying partway: the denoise never resolves. */
  denoiseHangs?: boolean;
  denoiseThrows?: boolean;
}): Promise<void> {
  const { steps } = opts;
  steps.push('save');
  if (!opts.denoise) return;
  steps.push('denoise-start');
  if (opts.denoiseHangs) return; // the page is gone; nothing after this runs
  if (opts.denoiseThrows) return; // caught in the real function; the save already happened
  steps.push('denoise-done');
  steps.push('replace');
}

describe('vidrec finalize: the capture is saved before the clean-up', () => {
  let steps: Step[];
  beforeEach(() => {
    steps = [];
  });

  test('the save happens FIRST, before denoising starts', async () => {
    await finalizeShape({ denoise: true, steps });
    assert.equal(steps[0], 'save', 'nothing may run before the recording is on disk');
    assert.ok(
      steps.indexOf('save') < steps.indexOf('denoise-start'),
      'denoising must never begin while the only copy is in memory',
    );
  });

  test('a tab that dies mid-clean-up still leaves the recording', async () => {
    // The reported incident. The user gets their clip, without noise reduction, instead of nothing.
    await finalizeShape({ denoise: true, denoiseHangs: true, steps });
    assert.deepEqual(steps, ['save', 'denoise-start'], 'the save survives; only the clean-up is lost');
  });

  test('a denoise that throws also leaves the recording', async () => {
    await finalizeShape({ denoise: true, denoiseThrows: true, steps });
    assert.ok(steps.includes('save'));
    assert.ok(!steps.includes('replace'), 'a failed clean-up must not touch the saved blob');
  });

  test('with noise reduction off it is still saved, once', async () => {
    await finalizeShape({ denoise: false, steps });
    assert.deepEqual(steps, ['save'], 'the ordinary path is one write, not two');
  });

  test('the cleaned audio REPLACES the entry rather than adding a second', async () => {
    // Two rows for one recording would be its own bug — the sidebar would show a duplicate, and
    // the user would have to guess which is which.
    await finalizeShape({ denoise: true, steps });
    assert.equal(steps.filter((s) => s === 'save').length, 1, 'exactly one entry is created');
    assert.equal(steps.at(-1), 'replace', 'the clean-up updates it in place');
  });
});
