// The generated app catalog (data/apps.ts) feeds the "New" badge on the landing grid (#1114).
//
// The badge is only correct if every app carries a first-release date the badge can read. The
// date is derived at generation time from each app's CHANGELOG.md; this pins the generator's
// output so a change that stops emitting it — or emits a date the `isNewApp` rule cannot
// parse — is a red test rather than a badge that silently never appears.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { APPS } from '../data/apps'
import { isNewApp } from '@kimtos/config'

describe('the generated app catalog carries a first-release date', () => {
  test('every marketing app has a parseable ISO firstReleased', () => {
    for (const a of APPS) {
      assert.ok(a.firstReleased, `${a.id} has no firstReleased — its CHANGELOG.md date did not reach the catalog`)
      assert.match(
        a.firstReleased,
        /^\d{4}-\d{2}-\d{2}$/,
        `${a.id} firstReleased is not an ISO date: ${a.firstReleased}`,
      )
      assert.ok(!Number.isNaN(Date.parse(a.firstReleased)), `${a.id} firstReleased does not parse: ${a.firstReleased}`)
    }
  })

  test('isNewApp accepts every catalog date (the badge can always be evaluated)', () => {
    // A date the shared rule rejects would render no badge AND no error — the worst outcome.
    // Passing a clock on each app's own release day proves the value round-trips through the rule.
    for (const a of APPS) {
      assert.equal(
        isNewApp(a.firstReleased, new Date(a.firstReleased!)),
        true,
        `${a.id} is not "new" on its own release day`,
      )
    }
  })
})
