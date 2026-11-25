// The once-a-day rate-us reminder: the pure decision (skip / seed / show), and the
// dialog's three exits — later (ask again tomorrow), "Never show this again", and
// actually going to the store (which retires the ask just like the checkbox).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';

const DAY = 86_400_000;

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let store: typeof import('../models/store.js').store;
let nudge: typeof import('./reviewNudge.js');
let opened: string[];

describe('the once-a-day review nudge', () => {
  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    fake = installChrome();
    ({ store } = await import('../models/store.js'));
    nudge = await import('./reviewNudge.js');
    // The module opens the store via the global `window` — capture instead of navigating.
    opened = [];
    (globalThis.window as unknown as { open: (url: string) => void }).open = (url: string) => {
      opened.push(url);
    };
    await store.set({ onboarded: true, reviewNudge: { lastAt: 0, off: false } } as never);
  });

  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  const state = () => store.get('reviewNudge');
  const dialog = (): HTMLElement | null => doc.querySelector('.review-nudge');

  describe('decideReviewNudge (pure)', () => {
    const now = 10 * DAY;
    test('off — never again, regardless of time', () => {
      assert.equal(nudge.decideReviewNudge({ lastAt: 0, off: true }, true, now), 'skip');
      assert.equal(nudge.decideReviewNudge({ lastAt: now - 2 * DAY, off: true }, true, now), 'skip');
    });
    test('not onboarded — never asked during the welcome session', () => {
      assert.equal(nudge.decideReviewNudge({ lastAt: 0, off: false }, false, now), 'skip');
    });
    test('first sight seeds the clock instead of showing', () => {
      assert.equal(nudge.decideReviewNudge({ lastAt: 0, off: false }, true, now), 'seed');
    });
    test('shows once a day, not more', () => {
      assert.equal(nudge.decideReviewNudge({ lastAt: now - DAY + 1, off: false }, true, now), 'skip');
      assert.equal(nudge.decideReviewNudge({ lastAt: now - DAY, off: false }, true, now), 'show');
    });
  });

  test('a fresh profile is not asked — the clock starts, and a day later it shows', async () => {
    const t0 = Date.now();
    nudge.maybeShowReviewNudge(t0);
    await settle();
    assert.equal(dialog(), null, 'no dialog on first sight');
    assert.equal(state().lastAt, t0, 'clock seeded');

    nudge.maybeShowReviewNudge(t0 + DAY);
    assert.ok(dialog(), 'asked a day later');
  });

  test('opening stamps lastAt at once, so a burst of tabs asks only once', async () => {
    await store.set({ reviewNudge: { lastAt: Date.now() - 2 * DAY, off: false } } as never);
    const t = Date.now();
    nudge.maybeShowReviewNudge(t);
    await settle();
    assert.ok(dialog());
    assert.equal(state().lastAt, t, 'stamped on open, not on close');
    assert.equal(nudge.decideReviewNudge(state(), true, t + 1), 'skip', 'a second tab stays quiet');
  });

  test('"Maybe later" closes and asks again another day', async () => {
    await store.set({ reviewNudge: { lastAt: Date.now() - 2 * DAY, off: false } } as never);
    nudge.maybeShowReviewNudge();
    (dialog()!.querySelector('.button-secondary') as HTMLButtonElement).click();
    await settle();
    assert.equal(dialog(), null, 'closed');
    assert.equal(state().off, false, 'still armed for tomorrow');
    assert.equal(opened.length, 0);
  });

  test('"Never show this again" + later retires the ask for good', async () => {
    await store.set({ reviewNudge: { lastAt: Date.now() - 2 * DAY, off: false } } as never);
    nudge.maybeShowReviewNudge();
    const box = dialog()!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    (dialog()!.querySelector('.button-secondary') as HTMLButtonElement).click();
    await settle();
    assert.equal(state().off, true);
    assert.equal(opened.length, 0, 'declining never opens the store');
  });

  test('"Rate KimtOS" opens the review page and retires the ask', async () => {
    await store.set({ reviewNudge: { lastAt: Date.now() - 2 * DAY, off: false } } as never);
    nudge.maybeShowReviewNudge();
    (dialog()!.querySelector('.button-primary') as HTMLButtonElement).click();
    await settle();
    assert.equal(dialog(), null, 'closed');
    assert.deepEqual(opened, [nudge.REVIEW_URL]);
    assert.equal(state().off, true, 'the ask is answered');
  });

  test('openReviewPage (the top-bar button / About link) also retires the ask', async () => {
    nudge.openReviewPage();
    await settle();
    assert.deepEqual(opened, [nudge.REVIEW_URL]);
    assert.equal(state().off, true);
  });

  test('the review URL is the store listing from @kimtos/config', () => {
    assert.match(nudge.REVIEW_URL, /^https:\/\/chromewebstore\.google\.com\/detail\/kimtos\/[a-p]{32}\/reviews$/);
  });
});
