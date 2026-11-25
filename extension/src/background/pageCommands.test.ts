// One dispatcher, three front doors (#1110). The keyboard shortcut, the right-click menu and
// the toolbar popup all end up here, so what these tests really pin is that a popup row and the
// hotkey that does the same thing cannot be two different features with two different gates.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runPageCommand, type PageCommandDeps } from './pageCommands.js';
import { FAKEFORM_ACTIONS, FAKEFORM_APPLY, FAKEFORM_FILLER_FILE } from '../lib/fakeformShared.js';
import { CLIPBOARD_PICKER_COMMAND } from '../lib/pageActions.js';

function deps(over: { fakeformActive?: boolean; clipboardActive?: boolean } = {}): PageCommandDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    fakeform: {
      isActive: async () => {
        log.push('fakeform:check');
        return over.fakeformActive ?? true;
      },
      inject: async (tabId, file) => {
        log.push(`inject:${tabId}:${file}`);
      },
      send: async (tabId, message) => {
        log.push(`send:${tabId}:${(message as { type: string }).type}`);
      },
      onError: (message) => log.push(`error:${message}`),
    },
    clipboardActive: async () => {
      log.push('clipboard:check');
      return over.clipboardActive ?? true;
    },
    openPicker: (tabId) => log.push(`picker:${tabId}`),
  };
}

describe('runPageCommand', () => {
  for (const spec of FAKEFORM_ACTIONS) {
    test(`${spec.command} runs FakeForm's "${spec.action}" through the shared handler`, async () => {
      const d = deps();
      assert.equal(await runPageCommand(spec.command, 3, d), true);
      assert.deepEqual(d.log, ['fakeform:check', `inject:3:${FAKEFORM_FILLER_FILE}`, `send:3:${FAKEFORM_APPLY}`]);
    });
  }

  test('a FakeForm command does nothing when the app is not active', async () => {
    const d = deps({ fakeformActive: false });
    assert.equal(await runPageCommand('fakeform-fill-form', 3, d), false);
    assert.deepEqual(d.log, ['fakeform:check']);
  });

  test('the clipboard picker is gated before the tab is spoken to', async () => {
    const d = deps({ clipboardActive: false });
    assert.equal(await runPageCommand(CLIPBOARD_PICKER_COMMAND, 3, d), false);
    assert.deepEqual(d.log, ['clipboard:check']); // asked, refused, and no message sent
  });

  test('the clipboard picker opens when Clipboard is installed', async () => {
    const d = deps();
    assert.equal(await runPageCommand(CLIPBOARD_PICKER_COMMAND, 9, d), true);
    assert.deepEqual(d.log, ['clipboard:check', 'picker:9']);
  });

  test('no tab id: nothing runs, and no gate is even consulted', async () => {
    const d = deps();
    assert.equal(await runPageCommand(CLIPBOARD_PICKER_COMMAND, undefined, d), false);
    assert.equal(await runPageCommand('fakeform-fill-form', undefined, d), false);
    assert.deepEqual(d.log, []);
  });

  test('an unknown command is refused rather than guessed at', async () => {
    const d = deps();
    assert.equal(await runPageCommand('not-a-command', 3, d), false);
    assert.equal(await runPageCommand('', 3, d), false);
    assert.deepEqual(d.log, []);
  });
});
