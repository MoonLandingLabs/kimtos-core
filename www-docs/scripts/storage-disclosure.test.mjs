// The privacy policy's cookie table (www/data/legal.ts CLIENT_STORAGE) imports every
// storage name from the code that sets it — except one: the docs site's theme key
// belongs to VitePress itself, so the policy has to type it by hand. This test pins
// that one hand-typed value to the installed package's own constant, so a VitePress
// upgrade that renames the key turns the stale disclosure into a red check instead of
// a wrong policy (#1045).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_KEY } from 'vitepress/dist/client/shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGAL_TS = join(HERE, '..', '..', 'www', 'data', 'legal.ts');

test("the policy's hand-typed docs theme key matches VitePress's APPEARANCE_KEY", () => {
  const legal = readFileSync(LEGAL_TS, 'utf8');
  assert.ok(
    legal.includes(`'${APPEARANCE_KEY}'`),
    `www/data/legal.ts must disclose the docs theme key under VitePress's real name ` +
      `('${APPEARANCE_KEY}') — the installed VitePress no longer uses the name the policy states.`,
  );
});

test('the docs privacy page points at the authoritative policy source', () => {
  const md = readFileSync(join(HERE, '..', 'authored', 'guides', 'privacy.md'), 'utf8');
  assert.match(
    md,
    /\{\{repoUrl\}\}\/blob\/main\/www\/pages\/privacy\.vue/,
    'guides/privacy.md must link the policy source (www/pages/privacy.vue) ' +
      'rather than restate the table — the www policy is the single copy.',
  );
});

test('the anchor that link lands on still exists in the www policy', () => {
  const vue = readFileSync(join(HERE, '..', '..', 'www', 'pages', 'privacy.vue'), 'utf8');
  assert.match(
    vue,
    /id="cookies"/,
    'www/pages/privacy.vue lost its id="cookies" anchor — the docs page and the footer ' +
      'both deep-link it, so removing it silently breaks two entry points.',
  );
});
