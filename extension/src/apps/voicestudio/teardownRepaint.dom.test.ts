// A preview that settles after the window is gone must not repaint it.
//
// A preview outlives the pane that started it: the render settles, `startJob` carries on, and it
// calls `syncPreviewButtons` on a UI that has already been torn down. That was invisible while the
// render resolved within a microtask of the click — but a preview is a registered job now (#1304),
// and a job adds hops between the click and the reply, so the repaint lands after teardown.
//
// Reported in PR #1324 alongside a second fix for the same file; that half is here because the
// other one had already landed in #1325.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../../test/domEnv.js';
import app from './index.js';

let env: DomEnv;
let km: typeof import('../../lib/kimtManager.js');

beforeEach(async () => {
  env = installDom();
  km = await import('../../lib/kimtManager.js');
  km.__reset();
});
afterEach(() => {
  km.__reset();
  env.cleanup();
});

/**
 * Wait for the abandoned preview to actually settle.
 *
 * NOT a fixed delay. What is asserted here is a NEGATIVE — that nothing was touched — and a
 * negative asserted after a sleep passes whenever the machine is slow enough, which is a flaky
 * test wearing a passing one's clothes (the trap this file's sibling records at #1215). The
 * orchestrator no longer having ACTIVE work is the signal that the continuation has resumed, so
 * wait for that and then assert. Not `list()`: a failed job is deliberately retained there, and in
 * this environment the preview always fails (no Worker), so that would never empty.
 */
async function previewSettled(): Promise<void> {
  for (let i = 0; i < 100 && km.active().length; i++) await settle(10);
  assert.equal(km.active().length, 0, 'timed out waiting for the abandoned preview to settle');
}

/** Mount far enough that the cards exist; the picker's own settle is not what is under test. */
async function mounted(): Promise<{ body: HTMLElement; teardown: () => void }> {
  const body = env.document.createElement('div') as unknown as HTMLElement;
  const teardown = app.render(body) as () => void;
  for (let i = 0; i < 60 && !body.querySelector('.vs-card-play'); i++) await settle(10);
  assert.ok(body.querySelector('.vs-card-play'), 'the picker rendered its cards');
  return { body, teardown };
}

describe('Voice Studio: a preview settling after teardown', () => {
  test('does not repaint the window it belonged to', async () => {
    const { body, teardown } = await mounted();
    const play = body.querySelector('.vs-card-play') as HTMLButtonElement;

    // Start a preview, then close the window while it is still working — the ordinary way this
    // happens: the user asks for a voice and closes the pane before it lands.
    play.click();
    await settle(0);
    teardown();

    // A value only the app writes. If the preview's continuation repaints, this is overwritten
    // with a state title, and that is the bug: a dead window being kept up to date.
    const MARK = 'torn-down: nothing may touch this';
    for (const el of body.querySelectorAll<HTMLElement>('.vs-card-play')) el.title = MARK;

    // It fails in this environment (no Worker), which is exactly the path that used to repaint on
    // the way out.
    await previewSettled();

    assert.equal(play.title, MARK, 'the torn-down card was repainted after its window closed');
  });

  test('and the teardown itself paints nothing on the way out', async () => {
    // The flag is raised BEFORE the teardown stops anything, because stopping is itself what asks
    // for a repaint: cancelling each preview calls back into the same paint. Raising it afterwards
    // would leave exactly one repaint of a window that is already going.
    const { body, teardown } = await mounted();
    const play = body.querySelector('.vs-card-play') as HTMLButtonElement;
    play.click();
    await settle(0);

    const MARK = 'closing: not one more paint';
    for (const el of body.querySelectorAll<HTMLElement>('.vs-card-play')) el.title = MARK;
    teardown();

    assert.equal(play.title, MARK, 'cancelling the previews repainted the window it was closing');

    // Let the abandoned preview settle INSIDE the test. Its continuation used to run on after the
    // window went and reach for `document` to build an error message — the same defect seen from
    // the other side, arriving as an unhandled rejection after the test rather than a failure in
    // it.
    await previewSettled();
    assert.equal(play.title, MARK, 'and nothing landed on it afterwards either');
  });
});

// The audible half of #1326, and the one a user cannot ignore: an <audio> element keeps playing
// when detached, so a sample that lands as the window closes starts speech with no control left
// anywhere to stop it.
describe('Voice Studio: a sample that lands after teardown', () => {
  test('is never played into a closed window', async () => {
    const { body, teardown } = await mounted();
    const audio = body.querySelector('.vs-preview-audio') as HTMLAudioElement;
    let played = 0;
    audio.play = () => {
      played += 1;
      return Promise.resolve();
    };

    (body.querySelector('.vs-card-play') as HTMLButtonElement).click();
    await settle(0);
    teardown();
    await previewSettled();

    assert.equal(played, 0, 'speech started in a window the user had already closed');
    assert.equal(audio.src, '', 'and no sample was even loaded into it');
  });
});
