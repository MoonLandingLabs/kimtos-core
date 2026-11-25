// The invariant the settings split rests on: AN APP ID NEVER CONTAINS A DASH.
//
// It is not a style rule. Two places depend on it to tell an app's settings apart from the
// content-script config that shares the same `settings:` namespace:
//
//   settings:notes              -> app config       (store.ts owns it)
//   settings:clipboard-capture  -> content-script    (csConfigMirror owns it)
//
// `splitSettingsKv` (lib/settingsControl.ts) says so in as many words — "App ids never contain
// '-', which is what makes this decidable" — and then SKIPS any dashed key when adopting settings
// from a backup. So an app id with a dash means that app's settings are silently dropped on every
// Import. No error, no log: they are simply not restored.
//
// Every id is clean today, and nothing else enforces it. #60 ("Text to Voice") is exactly the app
// that would tempt someone into `text-to-voice`. This is the check that stops them (#248).
//
// The registry itself is built with Vite's import.meta.glob, which Node does not have, so this
// reads the meta.ts files directly — which is also the more honest thing to check: the id as
// written, in the file a person edits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appsDir = dirname(fileURLToPath(import.meta.url));

function appIds(): { id: string; file: string }[] {
  const out: { id: string; file: string }[] = [];
  for (const name of readdirSync(appsDir)) {
    const file = join(appsDir, name, 'meta.ts');
    if (!existsSync(file)) continue;
    const m = readFileSync(file, 'utf8').match(/\bid:\s*'([^']+)'/);
    if (m?.[1]) out.push({ id: m[1], file: `src/apps/${name}/meta.ts` });
  }
  return out;
}

test('every app declares an id', () => {
  const ids = appIds();
  assert.ok(ids.length >= 19, `expected the app registry, found ${ids.length} ids`);
});

test('no app id contains a dash — a dashed id is silently dropped from every backup', () => {
  const bad = appIds().filter((a) => a.id.includes('-'));
  assert.deepEqual(
    bad,
    [],
    bad.length
      ? `These ids break the settings split: ${bad
          .map((b) => `${b.id} (${b.file})`)
          .join(', ')}. splitSettingsKv treats settings:<id-with-dash> as content-script config, ` +
          "so this app's settings would never be restored on Import. Use a dash-free id."
      : '',
  );
});

test("no app id collides with a content-script mirror key's shape", () => {
  // The folder name is what the storage prefix is built from, so it has to agree with the id.
  for (const { id, file } of appIds()) {
    assert.ok(/^[a-z][a-z0-9]*$/.test(id), `${id} (${file}) must be lowercase alphanumeric, no separators`);
  }
});
