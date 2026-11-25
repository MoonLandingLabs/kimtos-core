// The undefined-custom-property guard, checked against what it must catch and what it
// must pass.
//
// The bug it exists for (#521 → #535): `var(--text-secondary)` / `var(--hairline)` in
// admin-dashboard referenced tokens only the EXTENSION's theme defines — the whole
// declaration was silently dropped. So the wolves (an undefined token with no fallback)
// must fail, and the sheep must pass: a token defined in `:root`, in a scoped block, as
// a Vue style-object key (`{ '--c': v }` — the false positive the first draft of the
// checker had), via `setProperty`, and any `var(--x, fallback)`.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, definedTokens, fallbackless } from './check-css-vars.mjs';

test('definitions are found in every form they really occur in', () => {
  const defined = definedTokens(
    [
      ':root { --bg: #fff; --text-strong:#000 }',
      '.card { --pad : 4px; }',
      `:style="{ '--c': a.c }"`, // Vue style-object key — the AppGrid.vue form
      'el.style.setProperty("--live", accent)',
      'const o = { "--quoted": v }',
    ].join('\n'),
  );
  for (const t of ['--bg', '--text-strong', '--pad', '--c', '--live', '--quoted']) {
    assert.ok(defined.has(t), `${t} should be recognised as defined`);
  }
});

test('a var() with a fallback never counts as a violation', () => {
  assert.deepEqual(fallbackless('color: var(--missing, red);'), []);
  assert.deepEqual(fallbackless('color: var(--missing , var(--also-missing, blue));'), []);
});

test('a fallbackless var() is reported with its line', () => {
  const uses = fallbackless('a{color:red}\nb{border:1px solid var(--hairline)}');
  assert.deepEqual(uses, [{ token: '--hairline', line: 2 }]);
  // Whitespace inside the parens is still the same use.
  assert.equal(fallbackless('x{color:var( --text-secondary )}')[0].token, '--text-secondary');
});

test('commented-out uses are ignored', () => {
  assert.deepEqual(fallbackless(stripComments('/* color: var(--old) */ a{color:red}')), []);
  assert.deepEqual(fallbackless(stripComments('<!-- var(--tpl) --> <div/>')), []);
});

test('the #521 wolf: an undefined token with no fallback is caught; defining it passes', () => {
  const use = '.support-head { border-bottom: 1px solid var(--hairline); }';
  const flag = (defsText) => {
    const defined = definedTokens(defsText);
    return fallbackless(use).filter((u) => !defined.has(u.token));
  };
  assert.equal(flag(':root { --bg:#fff }').length, 1, 'undefined in-workspace: must fail');
  assert.equal(flag(':root { --bg:#fff; --hairline: #e5e5e5 }').length, 0, 'defined: must pass');
});
