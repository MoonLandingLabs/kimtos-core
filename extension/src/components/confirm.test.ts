// The confirm dialog's keyboard safety (#860).
//
// The bug this guards: the dialog used to focus the CONFIRM button on open, so a destructive
// confirm ("Delete this?") opened with the destructive button already armed — the very next
// Enter or Space performed it, with nothing to traverse. www and admin both settled on the
// opposite rule (#770, #830); this proves the extension now matches it. A real DOM is required
// because the whole point is where focus lands, which only a DOM has.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { confirmDialog } from './confirm.js';

let env: DomEnv;

/** Wait one animation frame — the dialog focuses in a requestAnimationFrame callback. */
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

const cardOf = () => env.document.querySelector('.confirm-card') as HTMLElement;
const cancelBtn = () => cardOf().querySelector('.button-secondary') as HTMLButtonElement;
const confirmBtn = () => cardOf().querySelector('.button-primary') as HTMLButtonElement;

/** Open a dialog and track how it resolves without awaiting it (it stays open until answered). */
function open(...args: Parameters<typeof confirmDialog>) {
  const state = { settled: false, value: undefined as boolean | undefined };
  const promise = confirmDialog(...args).then((v) => {
    state.settled = true;
    state.value = v;
    return v;
  });
  return { state, promise };
}

describe('confirmDialog focus + keyboard (#860)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('a destructive dialog focuses Cancel, never the destructive button', async () => {
    const { promise } = open('Delete this?'); // danger defaults to true
    await frame();

    assert.equal(env.document.activeElement, cancelBtn(), 'Cancel should hold focus');
    assert.notEqual(env.document.activeElement, confirmBtn(), 'the destructive button must NOT be focused');

    cancelBtn().click(); // resolve so the promise does not dangle
    await promise;
  });

  test('Enter does not trigger the destructive action on a danger dialog', async () => {
    const { state, promise } = open('Delete this?');
    await frame();

    // There is no Enter-confirms handler on a destructive dialog, and Cancel — not the
    // destructive button — holds focus, so an Enter keydown performs nothing.
    env.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await frame();
    assert.equal(state.settled, false, 'Enter must not resolve a destructive confirm');

    // Escape still cancels, and the promise resolves false.
    env.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(await promise, false, 'Escape cancels');
  });

  test('a non-destructive dialog focuses the confirm action', async () => {
    const { promise } = open('Do it again?', { danger: false, confirmLabel: 'Do it again' });
    await frame();

    assert.equal(env.document.activeElement, confirmBtn(), 'the confirm action is safe to focus when not destructive');

    cancelBtn().click();
    await promise;
  });

  test('a checkbox-gated confirm focuses Cancel, not its disabled confirm button', async () => {
    const { promise } = open('Download it?', {
      danger: false,
      confirmLabel: 'Download',
      checkbox: { label: 'I understand.' },
    });
    await frame();

    assert.equal(confirmBtn().disabled, true, 'the confirm button starts disabled behind the gate');
    assert.equal(env.document.activeElement, cancelBtn(), 'focusing a disabled button would drop focus to <body>');

    cancelBtn().click();
    await promise;
  });
});
