// The "New" badge — one factory, used by every extension surface that shows an app.
//
// An app is "new" for NEW_APP_DAYS from its first release (#1114). Both facts come from a
// single source each: the RULE from @kimtos/config (`isNewApp`, shared with the marketing and
// docs sites so they cannot disagree about what "new" means), and the DATE from the app's own
// CHANGELOG.md (its oldest entry, compiled into `appFirstReleased`). There is no `released`
// field on the app meta on purpose — that is how `version` drifted before it was removed (#132).
//
// It renders as a `.store-tag` like the other tags next to it, so the App Store card and
// the detail dialog get an identical badge with no duplicated markup. `now` is a parameter so
// the render can be tested at an exact day boundary instead of against the wall clock.

import { isNewApp } from '@kimtos/config';
import { appFirstReleased } from '../data/appChangelogs.js';
import { el } from '../lib/dom.js';

/** The "New" tag for an app first released within NEW_APP_DAYS — or `null` when it is not new. */
export function newBadge(appId: string, now: Date = new Date()): HTMLElement | null {
  return isNewApp(appFirstReleased(appId), now) ? el('span', 'store-tag is-new', 'New') : null;
}
