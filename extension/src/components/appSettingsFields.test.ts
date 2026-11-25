// The shared settings-schema renderer is the ONE place a declared setting becomes a
// control. Two surfaces call it — Settings > Apps and the settings control in an app
// window's header — so a type it cannot render is a setting that silently appears as a
// plain text box (or not at all) on both. This locks each declared type to its control,
// and that a change actually reaches the store.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../test/domEnv.js';

const APP = {
  id: 'fieldstest',
  name: 'Fields Test',
  settings: [
    {
      key: 'voice',
      label: 'Voice',
      type: 'select',
      default: 'b',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { key: 'speed', label: 'Speed', type: 'range', default: 1.2, min: 0.5, max: 2, step: 0.1, suffix: '×' },
    { key: 'autosave', label: 'Autosave', type: 'toggle', default: false },
    { key: 'note', label: 'Note', default: '', placeholder: 'Anything' },
  ],
};

describe('appSettingsFields', () => {
  let env: DomEnv;
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('renders one row per declared field, with the control each type asks for', async () => {
    const { appSettingsPanel } = await import('./appSettingsFields.js');
    const panel = appSettingsPanel(APP);

    assert.equal(panel.querySelectorAll('.field').length, APP.settings.length, 'a row per declared field');
    assert.ok(panel.querySelector('select.input'), 'select -> a <select>');
    assert.ok(panel.querySelector('.switch input[type="checkbox"]'), 'toggle -> a switch');
    assert.ok(panel.querySelector('.slider input[type="range"]'), 'range -> a slider');
    assert.ok(panel.querySelector('input[type="text"]'), 'the default type -> a text input');
  });

  test('a range shows its stored value with the declared unit', async () => {
    const { appSettingsPanel } = await import('./appSettingsFields.js');
    const readOut = appSettingsPanel(APP).querySelector('.slider-value');
    assert.equal(readOut?.textContent, '1.2×', 'the read-out carries the value and its suffix');
  });

  test('a select opens on the stored value, not the first option', async () => {
    const { appSettingsPanel } = await import('./appSettingsFields.js');
    const sel = appSettingsPanel(APP).querySelector('select') as HTMLSelectElement;
    assert.equal(sel.value, 'b', 'the declared default is selected');
  });

  test('changing a toggle writes through to the app config', async () => {
    const { appSettingsPanel } = await import('./appSettingsFields.js');
    const { getAppConfig } = await import('../lib/appConfig.js');
    const panel = appSettingsPanel(APP);
    const box = panel.querySelector('.switch input') as HTMLInputElement;

    box.checked = true;
    box.dispatchEvent(new env.window.Event('change', { bubbles: true }) as unknown as Event);
    await settle(10);

    assert.equal(getAppConfig(APP).autosave, true, 'the boolean is stored as a boolean, not "true"');
  });

  test('an app that declares nothing renders nothing', async () => {
    const { appSettingsFields } = await import('./appSettingsFields.js');
    assert.deepEqual(appSettingsFields({ id: 'nofields', name: 'No Fields' }), []);
  });

  // Changing a model / OCR language / AI-grammar setting starts a download of hundreds of
  // megabytes. It used to start in silence, so a user who then opened the app and waited behind
  // that download had nothing to connect the wait to (#1306).
  describe('a change that starts a download says so', () => {
    test('the message names the app and the size the registry derives', async () => {
      const { downloadStartedMessage } = await import('./appSettingsFields.js');
      const msg = downloadStartedMessage({ id: 'televoica', name: 'Voice to Text' });
      assert.match(msg, /^Downloading Voice to Text's model \(~\d+ MB\)\./, msg);
      assert.match(msg, /background/, 'and says it does not need Settings kept open');
    });

    test('an app with no model in the registry still gets a message, without an invented size', async () => {
      const { downloadStartedMessage } = await import('./appSettingsFields.js');
      assert.equal(downloadStartedMessage(APP), `Downloading ${APP.name}'s model. It continues in the background.`);
    });

    // It is announced only when THIS change started a download. "Is the app busy?" would answer
    // yes for a download already in flight for the PREVIOUS setting — which `ensureModel` drops
    // this request in favour of — and the message would then name a size nothing is fetching.
    test('ensureModel reports whether it actually started one', async () => {
      const { ensureModel } = await import('../lib/installManager.js');
      const km = await import('../lib/kimtManager.js');
      km.__reset();

      assert.equal(ensureModel('fieldstest'), false, 'not installed and has no model — nothing started');

      const gate = new Promise<void>(() => {}); // never settles: still in flight
      km.start({ appId: 'televoica', title: 'Downloading', kind: 'download', run: async () => gate });
      await settle(0);
      assert.equal(ensureModel('televoica'), false, 'a request dropped because the app is busy is not a start');
      km.__reset();
    });
  });
});
