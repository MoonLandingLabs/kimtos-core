// Grammit Anywhere's lifecycle, in a real DOM.
//
// This is the test that could not be written before #227: the teardown shipped in #226 was
// verified by READING it, because the runner had no DOM. What it has to prove is that losing
// uninstalling takes the feature off a page that is ALREADY OPEN — the failure that let an
// uninstalled feature linger on every long-lived tab (#223).
//
// The content script attaches its listeners and reads `chrome` at module scope, so the DOM and
// the fake chrome must exist BEFORE it is imported. Hence the dynamic import.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

const INSTALLED = { installedApps: ['grammit'] };
const UNINSTALLED = { installedApps: [] };

// The text and the spelling suggestions the mocked worker returns for it. Three
// misspellings, none of them a synchronous rule issue, so they only ever reach `issues`
// through the ASYNC spell path — the exact condition #252 mishandled. Offsets and lengths
// deliberately differ so a wrong (front-to-back) apply would corrupt them.
const SPELL_TEXT = 'Wugbles florp grendthe';
const SPELL_FIXES = [
  { start: 0, end: 7, original: 'Wugbles', suggestion: 'AB', label: 'Spelling' },
  { start: 8, end: 13, original: 'florp', suggestion: 'flourishing', label: 'Spelling' },
  { start: 14, end: 22, original: 'grendthe', suggestion: 'GR', label: 'Spelling' },
];
// The mocked service worker: answer grammit:spell with the fixes ONLY for the pristine
// text, so re-checks after each edit return nothing (no stale offsets re-injected).
const spellResponder = (msg: unknown): unknown => {
  const m = msg as { type?: string; text?: string };
  if (m.type === 'grammit:spell') return { ok: true, issues: m.text === SPELL_TEXT ? SPELL_FIXES : [] };
  return { stored: true };
};

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;

// The shadow host Grammit injects. It is the app's entire visible footprint on the page, so
// "is it there" is the honest question to ask.
const grammitHost = (): Element | null =>
  doc.documentElement.querySelector(':scope > div[style*="2147483647"]') ?? null;

const focusEditable = (): HTMLTextAreaElement => {
  const area = doc.createElement('textarea');
  area.value = 'i has a apple';
  doc.body.append(area);
  area.focus();
  area.dispatchEvent(
    new (globalThis as unknown as { FocusEvent: typeof FocusEvent }).FocusEvent('focusin', {
      bubbles: true,
    }),
  );
  return area;
};

describe('Grammit Anywhere: the install gate, live, on an open page', () => {
  before(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome({ kimtos: INSTALLED, grammitAnywhere: { enabled: true } }, spellResponder);
    await import('./writer.js'); // module scope runs the gate — the DOM must already exist
    await settle();
  });

  after(() => {
    fake.cleanup();
    env.cleanup();
  });

  test('an installed app gets the UI when a field is focused', async () => {
    focusEditable();
    await settle(20);
    assert.ok(grammitHost(), 'the shadow host should be in the page');
  });

  test('uninstalling removes it from the page — with no reload', async () => {
    // THE bug. The page is already open; nothing here reloads it. Before #226 the shadow host
    // stayed, the listeners stayed, and the underlines kept being painted.
    fake.set('kimtos', UNINSTALLED);
    await settle(20);
    assert.equal(grammitHost(), null, 'an uninstalled app must not keep its UI');
    assert.equal(doc.getElementById('grammit-hl-style'), null, 'the page-injected style must go too');
  });

  test('the listeners are really gone, not just the UI', async () => {
    // The teardown's whole point. The handlers used to be anonymous arrow functions, which
    // removeEventListener CANNOT detach — so this is the assertion that would have caught it.
    focusEditable();
    await settle(20);
    assert.equal(grammitHost(), null, 'focusing a field while uninstalled must build nothing');
  });

  test('installing switches it back on, on the same open page', async () => {
    // The one users report: they install it, return to the tab they were writing in, and nothing
    // happens.
    fake.set('kimtos', INSTALLED);
    await settle(20);
    focusEditable();
    await settle(20);
    assert.ok(grammitHost(), 'an install must take effect without a reload');
  });

  test('turning the setting off removes it, even while installed', async () => {
    // Grammit gates on TWO keys: the install state, and its own on/off setting. Both used to
    // need a page reload.
    fake.set('kimtos', INSTALLED);
    fake.set('grammitAnywhere', { enabled: true });
    await settle(20);
    focusEditable();
    await settle(20);
    assert.ok(grammitHost(), 'precondition: it is on');

    fake.set('grammitAnywhere', { enabled: false });
    await settle(20);
    assert.equal(grammitHost(), null, 'switching the feature off must take effect immediately');
  });

  test('Accept all fixes EVERY spelling suggestion in one click, not just the first (#252)', async () => {
    // The bug: acceptAll re-read issues[0] after each applyFix, but applyFix -> check() drops
    // the (async) spelling results, so the loop saw an empty list and stopped after one fix.
    fake.set('kimtos', INSTALLED);
    fake.set('grammitAnywhere', { enabled: true });
    await settle(20);

    const area = doc.createElement('textarea');
    area.value = SPELL_TEXT;
    doc.body.append(area);
    area.focus();
    area.dispatchEvent(
      new (globalThis as unknown as { FocusEvent: typeof FocusEvent }).FocusEvent('focusin', { bubbles: true }),
    );
    await settle(20); // focus -> check -> worker responds -> mergeIssues folds in the 3 spellings

    const host = grammitHost();
    assert.ok(host, 'precondition: the UI is present');
    const root = (host as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot;

    // Open the panel and confirm "Accept all" is offered (it only renders for >1 issue, so its
    // presence proves all three spellings registered, not just one). The affordance is now the
    // shared field chip (#511) in its own host — a press-release (no move) is a click.
    const chipHost = doc.querySelector('[data-kimtos-chip="grammit"]') as
      | (HTMLElement & {
          shadowRoot: ShadowRoot;
        })
      | null;
    assert.ok(chipHost, 'the Grammit chip host should be in the page');
    const chipEl = chipHost.shadowRoot.querySelector('.chip') as HTMLElement;
    const ME = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
    chipEl.dispatchEvent(new ME('pointerdown', { bubbles: true }));
    chipEl.dispatchEvent(new ME('pointerup', { bubbles: true }));
    const acceptAllBtn = root.querySelector('.accept-all') as HTMLElement | null;
    assert.ok(acceptAllBtn, 'precondition: 3 issues -> an "Accept all" button');

    acceptAllBtn.dispatchEvent(
      new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('click', { bubbles: true }),
    );
    // acceptAll writes synchronously; then drain the input-debounced re-check (DEBOUNCE_MS)
    // it triggers, so no timer fires after this test tears the DOM down.
    await settle(560);

    assert.equal(area.value, 'AB flourishing GR', 'all three spelling fixes must land in a single Accept all');
  });
});
