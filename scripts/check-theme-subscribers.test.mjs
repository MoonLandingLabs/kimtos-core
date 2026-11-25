// The theme-subscriber guard, checked against what it must catch and what it must pass.
//
// The bug it exists for: a surface that applies the palette once at startup and never again, so
// changing Appearance leaves it on the palette it booted with (#1174). So the wolves (a reader
// with no subscription) must fail and the sheep (a subscriber, an exempt module, a file that
// never reads the theme at all) must pass — and the shipped tree must pass today, or the check
// disagrees with the code it is guarding.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOffender, EXEMPT } from './check-theme-subscribers.mjs';

test('a surface that reads the theme and never subscribes is caught', () => {
  // The exact shape sidepanel.ts and popup.ts shipped with.
  const once = `
    async function main() {
      await store.init();
      const theme = store.get('theme');
      if (theme && theme !== 'system') root.setAttribute('data-theme', String(theme));
      else root.removeAttribute('data-theme');
    }`;
  assert.equal(isOffender('sidepanel.ts', once), true);

  // The resolved-answer half of the same read.
  assert.equal(isOffender('views/thing.ts', 'const paper = resolvedTheme();'), true);
});

test('a subscriber passes, through either API', () => {
  assert.equal(isOffender('sidepanel.ts', "import { followTheme } from './lib/theme.js';\nfollowTheme();"), false);
  assert.equal(
    isOffender('x.ts', "const t = store.get('theme');\nstore.subscribe(() => paint());"),
    false,
    'a module wiring its own subscription is not an offender',
  );
});

test('a content script that ships the palette but never paints it is caught', () => {
  // A content script never matches READS — it has no `store` — so the READS half of this guard
  // waves every one of them through. Checking only that was the first version of this rule, and
  // it made the check decorative for the exact five files it named. The invariant that actually
  // breaks is the palette without the attribute that switches it: permanently dark, everywhere.
  const shipped = "shadow.innerHTML = '<style>' + CONTENT_THEME_CSS + MENU_CSS + '</style>';";
  assert.equal(isOffender('content/fakeform.ts', shipped), true, 'palette with no themeShadowHost is the bug');
  assert.equal(isOffender('content/fakeform.ts', `${shipped}\nuntheme = themeShadowHost(menuHost);`), false);
  assert.equal(isOffender('content/x.ts', `${shipped}\nwatchContentTheme((t) => paint(t));`), false);
});

test('the in-page surfaces pass today, and would fail without their wiring', () => {
  // The five surfaces that draw our palette onto somebody else's page. Not a tautology: the
  // second assertion deletes the wiring from the REAL source and requires the guard to catch it,
  // so a test that passes for the wrong reason (because nothing matched at all) cannot survive.
  for (const rel of [
    'content/fakeform.ts',
    'content/toast.ts',
    'content/clipboardPicker.ts',
    'content/writer.ts',
    'lib/fieldChip.ts',
  ]) {
    const src = readFileSync(`extension/src/${rel}`, 'utf8');
    assert.equal(isOffender(rel, src), false, `${rel} must follow the theme`);

    const unwired = src.replace(/\b(themeShadowHost|watchContentTheme)\s*\(/g, 'noop(');
    assert.notEqual(unwired, src, `${rel} must actually call themeShadowHost — nothing was replaced`);
    assert.equal(isOffender(rel, unwired), true, `${rel} losing its wiring must fail this guard`);
  }
});

test('an exempt module passes, and every exemption carries a reason', () => {
  assert.equal(isOffender('lib/theme.ts', "store.get('theme')"), false);
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 40, `${file}: an exemption needs a real reason, not a shrug`);
  }
});

test('a file that never reads the theme is not the guard’s business', () => {
  assert.equal(isOffender('lib/num.ts', 'export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));'), false);
  // A near-miss that is not a theme read: another key entirely.
  assert.equal(isOffender('x.ts', "const blur = store.get('bgBlur');"), false);
});

test('a read that is only mentioned in a comment does not count', () => {
  // Comments are stripped before matching, so prose about the setting is not a read — otherwise
  // every file explaining the rule would have to be exempted, and the exemption list is the
  // thing that has to stay meaningful.
  assert.equal(isOffender('x.ts', "// reads store.get('theme') elsewhere\nconst a = 1;"), false);
  assert.equal(isOffender('x.ts', '/* resolvedTheme() is documented here */\nconst a = 1;'), false);
});

test('the shipped surfaces pass today', () => {
  // Not a tautology: these are the two files the issue was filed about. If either loses its
  // followTheme() call, this fails here as well as in the guard's own run.
  for (const rel of ['sidepanel.ts', 'popup.ts', 'controllers/appController.ts']) {
    const src = readFileSync(`extension/src/${rel}`, 'utf8');
    assert.equal(isOffender(rel, src), false, `${rel} must follow the theme`);
  }
});
