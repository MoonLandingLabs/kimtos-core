// The once-a-day "rate KimtOS" reminder, plus the shared open-the-review-page action
// behind every rate affordance (the top-bar button, Settings ▸ About, and this dialog).
//
// The extension is live on the Chrome Web Store, and reviews are how new users find it —
// so once a day, at most, the new tab asks. The ask is deliberately easy to end: "Never
// show this again" stops it forever, and actually going to the store stops it too (the
// ask is answered either way — both set the same `off` flag). State lives in
// `store.reviewNudge` ({ lastAt, off }), so it is per-user and rides in backups.
//
// A fresh profile is never asked on its first load: `lastAt` 0 only starts the clock,
// so the first ask lands a day into real use — a rating prompt before the user has
// used anything is noise, and invites the one-star review it was fishing for.
//
// This is a modal prompt, not a window, so it builds on the shared `.prompt-*` dialog
// styling (like promptDialog/infoDialog) rather than `createDialog` — see the dialogs
// skill. It mounts only on the new-tab page (no pop-out owner can raise it).

import { DEFAULTS } from '@kimtos/config';
import { el, overlayHost } from '../lib/dom.js';
import { store } from '../models/store.js';
import { STAR } from '../components/icons.js';

/** The listing's Reviews tab — from the ONE place the store URL lives (@kimtos/config). */
export const REVIEW_URL = `${DEFAULTS.chromeWebStoreUrl}/reviews`;

const DAY_MS = 86_400_000;

export type NudgeDecision = 'skip' | 'seed' | 'show';

/** Pure: what this load should do about the reminder. `seed` = first sight of the
 *  feature — start the clock without showing, so the first ask comes a day later. */
export function decideReviewNudge(
  state: { lastAt: number; off: boolean },
  onboarded: boolean,
  now: number,
): NudgeDecision {
  if (state.off || !onboarded) return 'skip';
  if (!state.lastAt) return 'seed';
  return now - state.lastAt >= DAY_MS ? 'show' : 'skip';
}

/** Turn the reminder off for good — the user rated, or asked never to be asked. */
function silence(): void {
  void store.set({ reviewNudge: { lastAt: Date.now(), off: true } });
}

/** Open the store's review page and retire the daily reminder — the ask is answered.
 *  Every rate affordance (top-bar button, About link, the dialog) goes through here. */
export function openReviewPage(): void {
  window.open(REVIEW_URL, '_blank', 'noopener,noreferrer');
  silence();
}

/** Called once per new-tab load (appController). Shows the dialog at most once a day. */
export function maybeShowReviewNudge(now = Date.now()): void {
  const decision = decideReviewNudge(store.get('reviewNudge'), store.get('onboarded'), now);
  if (decision === 'skip') return;
  // Stamp `lastAt` NOW, not on close: a burst of new tabs opened while the dialog sits
  // unanswered must not each raise their own copy. (`seed` is the same stamp, minus the UI.)
  void store.set({ reviewNudge: { lastAt: now, off: false } });
  if (decision === 'show') showReviewNudge();
}

function showReviewNudge(): void {
  const overlay = el('div', 'prompt-overlay review-nudge');
  const card = el('div', 'prompt-card');

  const stars = el('div', 'review-stars');
  stars.setAttribute('aria-hidden', 'true');
  stars.innerHTML = STAR.repeat(5);

  card.append(
    stars,
    el('h2', 'prompt-title', 'Enjoying KimtOS?'),
    el(
      'p',
      'prompt-label',
      'A quick rating on the Chrome Web Store helps other people find it — and it takes less than a minute.',
    ),
  );

  const toggle = el('label', 'prompt-toggle');
  const never = el('input') as HTMLInputElement;
  never.type = 'checkbox';
  toggle.append(never, el('span', '', 'Never show this again'));
  card.append(toggle);

  const actions = el('div', 'prompt-actions');
  const later = el('button', 'button-secondary', 'Maybe later');
  const rate = el('button', 'button-primary', 'Rate KimtOS');
  actions.append(later, rate);
  card.append(actions);
  overlay.append(card);
  overlayHost().append(overlay);

  // `lastAt` was stamped on open; closing only needs to honour the opt-outs.
  const close = (rated: boolean): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (rated) openReviewPage();
    else if (never.checked) silence();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close(false);
  };
  document.addEventListener('keydown', onKey);
  later.addEventListener('click', () => close(false));
  rate.addEventListener('click', () => close(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(false);
  });
  // Non-destructive prompt: focus the primary action, so Enter rates (the #860 rule —
  // Enter may pre-arm an action only when it cannot destroy anything).
  requestAnimationFrame(() => rate.focus());
}
