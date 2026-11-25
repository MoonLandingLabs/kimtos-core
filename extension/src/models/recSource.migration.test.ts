// A remembered recording source must not change meaning under the user.
//
// The setting used to be one either/or choice, where 'system' meant system audio
// WELDED to the microphone — there was no way to ask for system audio alone. It is
// two independent switches now (#1327), so the old value has to land on BOTH of them.
// Map it to system-only and a user who recorded calls would silently stop capturing
// their own voice; drop it and they would silently stop capturing the call.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { migrateRecSource } from './store.js';

describe('migrateRecSource', () => {
  test("'system' meant system audio AND the mic, so both switches come on", () => {
    const apps = { televoica: { recSource: 'system', language: 'en' } };
    migrateRecSource(apps);
    assert.deepEqual(apps.televoica, { recMic: true, recSystem: true, language: 'en' });
  });

  test("'mic' comes across as the mic alone", () => {
    const apps = { denoise: { recSource: 'mic' } };
    migrateRecSource(apps);
    assert.deepEqual(apps.denoise, { recMic: true, recSystem: false });
  });

  test('an app that never stored the setting is left exactly as it was', () => {
    const apps = { tasks: { sort: 'due' } };
    migrateRecSource(apps);
    assert.deepEqual(apps.tasks, { sort: 'due' });
  });

  test('it is idempotent — the legacy key is gone, so a second pass changes nothing', () => {
    const apps: Record<string, Record<string, unknown>> = { televoica: { recSource: 'system' } };
    migrateRecSource(apps);
    const once = JSON.stringify(apps);
    migrateRecSource(apps);
    assert.equal(JSON.stringify(apps), once);
  });

  test('a switch the user has already set wins over the legacy value', () => {
    const apps = { televoica: { recSource: 'system', recSystem: false } };
    migrateRecSource(apps);
    assert.deepEqual(apps.televoica, { recMic: true, recSystem: false });
  });

  test('no apps at all is not an error (a fresh profile)', () => {
    assert.doesNotThrow(() => migrateRecSource(undefined));
  });
});
