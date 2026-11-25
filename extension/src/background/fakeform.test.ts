// The one rule the background half enforces: nothing reaches a page unless the app is installed,
// and the order is check -> inject -> message (injecting first would put the filler into the
// page of a user who has not installed it). No DOM, no chrome — the gate and the effects are injected.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runFakeForm, type FakeFormDeps } from './fakeform.js';
import { FAKEFORM_APPLY, FAKEFORM_FILLER_FILE } from '../lib/fakeformShared.js';

function deps(active: boolean): FakeFormDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    isActive: async () => {
      log.push('check');
      return active;
    },
    inject: async (tabId, file) => {
      log.push(`inject:${tabId}:${file}`);
    },
    send: async (tabId, message) => {
      log.push(`send:${tabId}:${(message as { type: string }).type}`);
    },
    onError: (message) => log.push(`error:${message}`),
  };
}

describe('runFakeForm', () => {
  test('when active: checks, then injects the filler, then messages it — in that order', async () => {
    const d = deps(true);
    const ran = await runFakeForm(7, 'form', d);
    assert.equal(ran, true);
    assert.deepEqual(d.log, ['check', `inject:7:${FAKEFORM_FILLER_FILE}`, `send:7:${FAKEFORM_APPLY}`]);
  });

  test('when NOT active: nothing is injected or messaged', async () => {
    const d = deps(false);
    const ran = await runFakeForm(7, 'all', d);
    assert.equal(ran, false);
    assert.deepEqual(d.log, ['check']); // the gate was asked, and it said no
  });

  test('no tab id: a no-op, and the gate is not even consulted', async () => {
    const d = deps(true);
    assert.equal(await runFakeForm(undefined, 'form', d), false);
    assert.deepEqual(d.log, []);
  });

  test('an inject failure is reported, not swallowed', async () => {
    const d = deps(true);
    d.inject = async () => {
      throw new Error('no host permission for this tab');
    };
    const ran = await runFakeForm(7, 'field', d);
    assert.equal(ran, false);
    assert.ok(d.log.some((l) => l.startsWith('error:')));
  });
});
