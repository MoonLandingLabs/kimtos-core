// The content-script registration decision (#637): which of Grammit/Clipboard's content scripts
// should be registered, given the installed set and whether the all-sites host permission is held.
// The reconcile turns this into register/unregister calls; here we lock the pure rule.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { desiredContentScripts } from './contentScripts.js';

const idsOf = (installed: string[], permitted: boolean) =>
  desiredContentScripts(installed, permitted)
    .map((d) => d.id)
    .sort();

describe('content-script registration decision (#637)', () => {
  test('nothing is registered without the all-sites permission', () => {
    assert.deepEqual(desiredContentScripts(['grammit', 'clipboard'], false), []);
  });

  test('nothing when neither content-script app is installed', () => {
    assert.deepEqual(desiredContentScripts(['tabs', 'notes'], true), []);
  });

  test('registers the writer for Grammit, at document_idle, on all sites', () => {
    const [d, ...rest] = desiredContentScripts(['grammit'], true);
    assert.equal(rest.length, 0);
    assert.equal(d?.id, 'kimtos-writer');
    assert.deepEqual(d?.js, ['writer.js']);
    assert.deepEqual(d?.matches, ['https://*/*']);
    assert.equal(d?.runAt, 'document_idle');
  });

  test('registers the clipboard capture for Clipboard, at document_start', () => {
    const [d, ...rest] = desiredContentScripts(['clipboard', 'tabs'], true);
    assert.equal(rest.length, 0);
    assert.equal(d?.id, 'kimtos-clipboard');
    assert.deepEqual(d?.js, ['clipboard.js']);
    assert.equal(d?.runAt, 'document_start');
  });

  test('registers both when both are installed, and ignores other installed apps', () => {
    assert.deepEqual(idsOf(['grammit', 'clipboard', 'notes'], true), ['kimtos-clipboard', 'kimtos-writer']);
  });
});
