// AnubisDB is the manager over everything an app stored. For settings it was not: it showed a
// MIRROR (dataStore.kv) while the apps read chrome.storage, so "clear" cleared nothing (the next
// save rewrote the mirror) and "import" restored nothing (the app never reads kv) — #225.
//
// The I/O half of the fix needs chrome.storage and IndexedDB. THIS half — deciding what each
// `settings:*` key actually IS — is pure, and it is where the trap lives: the content-script
// keys look exactly like app keys.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSettingsKv } from './settingsControl.js';

describe('splitSettingsKv — an app key and a content-script key look the same (#225)', () => {
  test('`settings:<app>` is app config; `settings:general` is preferences', () => {
    const { general, apps } = splitSettingsKv([
      ['settings:general', { theme: 'dark' }],
      ['settings:tasks', { sort: 'due' }],
      ['settings:notes', { font: 'serif' }],
    ]);
    assert.deepEqual(general, { theme: 'dark' });
    assert.deepEqual(apps, { tasks: { sort: 'due' }, notes: { font: 'serif' } });
  });

  test('`settings:<app>-<name>` is CONTENT-SCRIPT config and must NOT become app config', () => {
    // `settings:grammit-anywhere` is a chrome.storage key csConfigMirror owns. Treat it as app
    // config and we would write a `grammit` setting the app never declared — inventing state in
    // the app's config from a key that belongs to another subsystem. App ids never contain '-',
    // which is the only reason this is decidable at all.
    const { apps } = splitSettingsKv([
      ['settings:grammit-anywhere', true],
      ['settings:clipboard-capture', true],
      ['settings:grammit', { deep: true }],
    ]);
    assert.deepEqual(apps, { grammit: { deep: true } }, 'only the real app config survives');
    assert.ok(!('grammit-anywhere' in apps));
    assert.ok(!('clipboard' in apps), 'clipboard-capture is not clipboard app config');
  });

  test('keys outside the settings namespace are ignored', () => {
    const { general, apps } = splitSettingsKv([
      ['thoth:hashes', { a: 1 }],
      ['kimtai:downloaded', ['x']],
    ]);
    assert.equal(general, null);
    assert.deepEqual(apps, {});
  });

  test('junk values do not become config', () => {
    // A backup is a file on disk; a user can edit it. A string where an object belongs must not
    // be written into the store as though it were a settings object.
    const { general, apps } = splitSettingsKv([
      ['settings:general', 'not an object'],
      ['settings:tasks', null],
      ['settings:notes', 42],
    ]);
    assert.equal(general, null);
    assert.deepEqual(apps, {});
  });
});

describe('a LEGACY backup restores the same way from every button (#249)', () => {
  // `settings:prefs` is the pre-split backup shape: one object, per-app config nested under
  // `apps`. The Settings import handled it; AnubisDB's path did not — so the same old backup on
  // the same disk restored fully from one button and partially from the other. The rule now
  // lives in one place, so it cannot differ by caller.
  test('the legacy key yields both the preferences AND the per-app config', () => {
    const { general, apps } = splitSettingsKv([
      ['settings:prefs', { theme: 'dark', clock24h: false, apps: { tasks: { sort: 'due' } } }],
    ]);
    assert.deepEqual(general, { theme: 'dark', clock24h: false });
    assert.deepEqual(apps, { tasks: { sort: 'due' } }, 'the nested app config must not be dropped');
    assert.ok(!('apps' in (general ?? {})), 'the nested map is not itself a preference');
  });

  test('a legacy backup with no nested apps still restores the preferences', () => {
    const { general, apps } = splitSettingsKv([['settings:prefs', { theme: 'light' }]]);
    assert.deepEqual(general, { theme: 'light' });
    assert.deepEqual(apps, {});
  });

  test('legacy and current keys merge rather than clobber', () => {
    // A backup can carry both (an old profile that has since been re-saved).
    const { general, apps } = splitSettingsKv([
      ['settings:prefs', { theme: 'dark', apps: { tasks: { sort: 'due' } } }],
      ['settings:general', { clock24h: true }],
      ['settings:notes', { font: 'serif' }],
    ]);
    assert.equal(general?.theme, 'dark', 'the legacy preference survives');
    assert.equal(general?.clock24h, true, 'and the current one is merged in');
    assert.deepEqual(apps, { tasks: { sort: 'due' }, notes: { font: 'serif' } });
  });

  test('junk inside the legacy nested map is dropped, not written as config', () => {
    const { apps } = splitSettingsKv([
      ['settings:prefs', { apps: { tasks: 'not an object', notes: { font: 'serif' } } }],
    ]);
    assert.deepEqual(apps, { notes: { font: 'serif' } });
  });
});

// A CONVENTION TEST, because this rule has now been broken twice, in two different ways.
//
//   dataStore.importAll() rebuilds the DB — including the `settings:*` kv keys. But kv is a
//   MIRROR: the apps read chrome.storage. An import that stops there leaves every setting
//   exactly as it was, while telling the user their backup was restored.
//
// AnubisDB's "Erase all" undo called it directly (#249). The Settings import called it directly
// and then hand-rolled its own copy of the adopt step, which drifted. Two of the three call
// sites got it wrong. The rule cannot live in the callers, so this asserts it does not have to:
// `restoreFullBackup` is the only door, and nothing else may open the raw one.
describe('nothing bypasses restoreFullBackup (#225, #249)', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  const ALLOWED = new Set(['lib/dataStore.ts', 'lib/settingsControl.ts']);

  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return files(p);
      return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });

  test('dataStore.importAll is called from settingsControl and nowhere else', () => {
    const offenders = files(SRC)
      .filter((f) => /\bimportAll\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.has(rel));

    assert.deepEqual(
      offenders,
      [],
      'A raw importAll leaves the settings unrestored while claiming success. ' +
        'Call restoreFullBackup() from lib/settingsControl.ts instead.',
    );
  });
});
