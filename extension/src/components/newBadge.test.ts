// The "New" badge on the App Store surfaces (#1114).
//
// The rule itself (30 days) is tested in @kimtos/config; this holds the extension's wiring:
// the badge is rendered for an app whose first release is recent and NOT for one whose is
// old, judged against an INJECTED clock. The dates come from the real compiled changelog
// data — the oldest entry per app never changes once shipped, so the fixture is stable — and
// the clock is chosen relative to them, so this never races the wall clock (#1059, #1075).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { newBadge } from './newBadge.js';

let env: DomEnv;

beforeEach(() => {
  env = installDom();
});
afterEach(() => env.cleanup());

// A clock at which a July-24 first release is 17 days old (new) and a July-06 one is 35 days
// old (past the 30-day window). Both dates are the OLDEST committed changelog entries for the
// respective apps, which do not move when a newer version ships.
const CLOCK = new Date('2026-08-10T00:00:00Z');

describe('newBadge', () => {
  test('renders "New" for an app released within the window', () => {
    const badge = newBadge('voicestudio', CLOCK);
    assert.ok(badge, 'a recently-released app carries the badge');
    assert.equal(badge.textContent, 'New');
    assert.ok(badge.classList.contains('store-tag'), 'it is a store-tag pill like the tier badges');
    assert.ok(badge.classList.contains('is-new'));
  });

  test('renders nothing for an app whose first release is past the window', () => {
    // Calculator first shipped well before CLOCK. A later patch does not reset the clock —
    // the badge counts from the FIRST release, not the newest entry.
    assert.equal(newBadge('calculator', CLOCK), null);
  });

  test('renders nothing for an unknown app id', () => {
    // An id with no changelog yields an empty date, which is "not new" — never a crash.
    assert.equal(newBadge('does-not-exist', CLOCK), null);
  });
});
