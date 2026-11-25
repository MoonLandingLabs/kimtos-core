// The "New" badge rule (#1114).
//
// Three surfaces render this badge — the extension's App Store, the marketing site's app
// grid and the docs site's app cards — and each of them asks the SAME question of this one
// function. If the rule were reimplemented per surface, an app could be new on the marketing site
// and not new in the product, which is worse than having no badge at all.
//
// Every case below passes its own `now`. That is the point of the parameter: the badge's
// interesting behaviour is entirely about a boundary, and a test that reads the wall clock
// can only assert it by accident (see #1059 and #1075, both fixed for exactly this reason).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isNewApp, NEW_APP_DAYS } from '../dist/index.js';

const RELEASED = '2026-07-23';
const DAY = 24 * 60 * 60 * 1000;

/** `n` days after the release date, to the millisecond. */
const daysAfter = (n) => new Date(Date.parse(RELEASED) + n * DAY);

describe('isNewApp', () => {
  test('an app is new on the day it ships', () => {
    assert.equal(isNewApp(RELEASED, daysAfter(0)), true);
  });

  test('it is still new the day before the window closes', () => {
    assert.equal(isNewApp(RELEASED, daysAfter(NEW_APP_DAYS - 1)), true);
  });

  test('the badge is gone the moment the window closes', () => {
    // The boundary is exclusive: at exactly NEW_APP_DAYS the app has BEEN new for the full
    // period, so the badge has done its job. An off-by-one here is a badge that lingers a
    // day past what the product promises.
    assert.equal(isNewApp(RELEASED, daysAfter(NEW_APP_DAYS)), false);
    // ...and still there a millisecond before it.
    assert.equal(isNewApp(RELEASED, new Date(daysAfter(NEW_APP_DAYS).getTime() - 1)), true);
  });

  test('an app that shipped long ago is not new', () => {
    assert.equal(isNewApp(RELEASED, daysAfter(NEW_APP_DAYS + 400)), false);
  });

  test('a missing date is not new — the badge is never guessed', () => {
    // Every one of these is a real shape a caller can hand us: an app whose changelog could
    // not be read yields '', and the generated accessors return '' rather than throwing.
    for (const absent of ['', null, undefined]) {
      assert.equal(isNewApp(absent, daysAfter(0)), false, `absent date ${JSON.stringify(absent)}`);
    }
  });

  test('an unreadable date is not new', () => {
    for (const junk of ['tomorrow', '23-07-2026', 'v1.0.0', '2026-13-45']) {
      assert.equal(isNewApp(junk, daysAfter(0)), false, `junk date ${junk}`);
    }
  });

  test('a future date is not new', () => {
    // A typo'd changelog date that has not arrived yet would otherwise pin the badge on
    // until it did — the one failure mode where doing nothing is clearly right.
    assert.equal(isNewApp(RELEASED, daysAfter(-1)), false);
  });

  test('the window is 30 days', () => {
    // Stated in the issue and in the docs; asserted here so a well-meaning tweak to the
    // constant has to be a deliberate change to the promise, not a silent one.
    assert.equal(NEW_APP_DAYS, 30);
  });
});
