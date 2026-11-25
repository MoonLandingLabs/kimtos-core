// The "New" badge on the docs app cards (#1114).
//
// The badge is generated at build time from each app's first-release date (its oldest
// CHANGELOG entry), and expires on the client via a `data-new-until` stamp. This pins the two
// things that make it correct: every shipped booklet app resolves a parseable first-release
// date from the SAME source the builder reads (@kimtos/releaser), and the shared `isNewApp`
// rule accepts it — so the badge can always be evaluated rather than silently skipped.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitFirstReleased } from '@kimtos/releaser';
import { isNewApp, NEW_APP_DAYS } from '@kimtos/config';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const BOOKLETS = join(REPO, 'docs', 'extension', 'apps');
const EXT_APPS = join(REPO, 'extension', 'src', 'apps');

// Every app the docs site publishes a booklet for (the same set readApps() walks).
const bookletIds = readdirSync(BOOKLETS).filter((d) => statSync(join(BOOKLETS, d)).isDirectory());

describe('docs "New" badge source', () => {
  test('there are booklets to check', () => {
    assert.ok(bookletIds.length > 0, 'no app booklets found — the docs build itself would fail');
  });

  test('every booklet app resolves a parseable first-release date', () => {
    for (const id of bookletIds) {
      const date = unitFirstReleased(join(EXT_APPS, id));
      assert.ok(date, `${id} has no first-release date — its CHANGELOG.md date is missing`);
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${id} first-release date is not ISO: ${date}`);
    }
  });

  test('the shared rule accepts each date, and the stamped expiry is 30 days out', () => {
    for (const id of bookletIds) {
      const date = unitFirstReleased(join(EXT_APPS, id));
      // On its own release day, every app is new — proving the value round-trips through the
      // rule the builder uses to decide whether to emit the badge at all.
      assert.equal(isNewApp(date, new Date(date)), true, `${id} is not "new" on its own release day`);
      // The badge's data-new-until stamp is release + NEW_APP_DAYS, the day it stops showing.
      const until = new Date(Date.parse(date) + NEW_APP_DAYS * 24 * 60 * 60 * 1000);
      assert.equal(isNewApp(date, until), false, `${id} must not be "new" on its expiry day`);
    }
  });
});
