# Releasing

A release does exactly two things:

1. **Publish a changelog users can read** — written into `CHANGELOG.md` and
   **bundled into the build**.
2. **Get the package to the Chrome Web Store** — the only place anyone can install
   it from.

Nothing else. No GitHub Release, no zip attached to this repo, no notes fetched at
runtime.

> **Releases have shipped.** The tags and releases inherited from the old `devhome`
> repo were removed first, so every `v*` tag here is this product's own and the newest
> one is what the next release diffs against. Dry-run before you tag (see below).

## Where the release logic lives

All of it is in **`@kimtos/releaser`** (`shared-modules/releaser/`), and **it has tests** —
run against real fixture git histories (`npm run test -w @kimtos/releaser`). It used to be
two scripts plus a ~20-line shell heredoc in the Makefile, with no tests, rebuilt three
times in a week. See #121.

The Makefile targets are one-liners over it:

| Command                              | What it does                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `make release-notes`                 | Preview the notes for the pending range (last tag..HEAD). Writes nothing.      |
| `make release-report`                | What the pending release actually touches — PRs, files, **apps**, workspaces   |
| `make release-check`                 | Every app and deployable has a changelog, a matching version, a locked version |
| `make release-prepare VERSION=x.y.z` | Write the notes and commit them, **on a branch**. No push, no tag.             |
| `make release-tag VERSION=x.y.z`     | Tag the merged commit and push the tag, **from `main`**. Nothing else.         |

### Why it is two commands

It used to be one, `make release`, and that one command wrote the changelogs, committed,
**pushed `main`**, tagged and pushed the tag. Two things were wrong with that.

That push was the **only place in the project where content reached `main` without a pull
request**, while `CLAUDE.md` and the `issue-workflow` skill both say never to do it. And
because writing the notes and cutting the tag were the same step, a bad changelog was
discovered on a tag that already existed — against a Chrome Web Store version history that
only ever goes forwards. There was no moment at which a human could look at the notes before
they were permanent.

So the two halves **refuse to run where the other belongs** (#1208):

- `make release-prepare` errors if you are on `main`, and prints the branch to create.
- `make release-tag` errors if you are anywhere but `main`.

That is enforcement rather than documentation on purpose. A documented order that the tools
let you skip is the same shape as #1201 — an order written down that nobody could follow.

The older guards are unchanged and they still matter: both halves refuse a dirty tree, an
existing tag, and a version that does not match `extension/manifest.json`. Each exists because
releasing past it produces a broken artifact that is **already tagged and pushed**.

`release-tag` adds three of its own, and all three exist because the split opened a window the
one-shot command did not have:

- **No changelog section for this version** — the prepare PR was never merged.
- **`main` has moved on since the notes were written.** What gets tagged must be the content the
  notes describe, not merely a commit that passes the other checks. Several people and agents
  merge into `main` at once here, so an unrelated PR landing during the review window is
  ordinary; tagging after it would submit a build containing changes no changelog mentions,
  permanently. The fix is to re-run `release-prepare` so the notes cover what actually ships.

  It compares the **tree** at `HEAD` against the tree of the commit that last touched
  `CHANGELOG.md`, so it does not care whether the prepare PR was squashed, fast-forwarded or
  merged — only whether the bytes changed.

- **Local `main` out of step with `origin/main`** — the tag would point at a commit nobody else
  has. This reads the remote-tracking ref and does not fetch, so it is only as fresh as your
  last `git pull`; that is why step 4 pulls first.

## The changelog is bundled, not fetched

`CHANGELOG.md` is the source of truth. `@kimtos/releaser` compiles it into
`extension/src/data/changelog.ts`, which the extension imports — so the notes for a
version **ship with that version**, and the _Release notes_ dialog makes **no network
call at all**.

That is deliberate, and it is the second design here. The notes used to be fetched
from GitHub Releases on a separate public repo, so they could be updated without a
new build. **That broke the instant that repo went private:** an extension running in
a user's browser is an _anonymous_ client, and GitHub's API returns `404` for a
private repo — the changelog simply vanished for everyone.

Bundling removes the dependency on any repo's visibility, works offline like the rest
of the app, and is arguably right anyway: **a release _is_ a new build**, so there is
nothing to gain by fetching notes that could only ever describe builds the user
already has.

The generated file is regenerated on every build (`npm run gen`), so it cannot drift
from `CHANGELOG.md`. Do not hand-edit it.

## Version scheme

The published line starts at **1.0.0** — the first stable release (the `0.x`
releases were public betas that predate it). Routine releases bump the **patch**:
`1.0.1`, `1.0.2`, … A minor or major bump is a deliberate product decision, not
something a release script or an agent chooses.

Two hard rules:

- The version lives in **two files that must always match**:
  `extension/manifest.json` and `extension/package.json`. After bumping both, sync
  the root lockfile with `npm install --package-lock-only` (it mirrors the
  workspace version).
- **Version history is one-way.** The Chrome Web Store refuses any upload whose
  version is lower than or equal to the one already published. Never lower a
  version, never reuse one — once `1.0.0` is live, everything after it is greater.

## Steps

Four of them, and each one is a thing you can stop at. The order below has been run end
to end against a scratch clone; it is not a description of what ought to work.

1. **Bump the version** in both files (they must match the tag):
   - `extension/manifest.json` → `"version"`
   - `extension/package.json` → `"version"`

   Then `npm install --package-lock-only`, and land it like any other change.

2. **Prepare the notes, on a branch:**

   ```bash
   git checkout -b main_chore_release_1.0.2
   make release-prepare VERSION=1.0.2
   ```

   It generates the changelog from the **pull requests merged since the last version**,
   prints it along with the per-app and per-workspace versions it proposes, and asks for a
   `y`. Then it writes the section into `CHANGELOG.md` and each touched unit's own
   changelog, bumps the deployables' `package.json`, refreshes the lockfile, recompiles
   the bundled `changelog.ts` and `appChangelogs.ts`, and **commits all of it**.

   It does not push and it does not tag. Push the branch, open a PR, get it reviewed and
   merge it — the release notes are the most user-visible text this project ships, and
   they are the one thing that used to reach `main` unread.

   Run it on `main` and it refuses, naming the branch to create.

3. **Dry-run the workflow.** Actions → **Release** → _Run workflow_, and give it the
   version (e.g. `1.0.2`). It builds and packages, and submits nothing. Do this before
   every release, and certainly before the first one: otherwise the tag doubles as the
   first test of the workflow, and a failed release is awkward to unwind.

   **What it proves, and what it does not.** It proves the version matches the
   manifest, the install resolves, lint and build pass, and the package is produced —
   which is everything that has ever actually gone wrong. It does **not** prove
   `CHANGELOG.md` has this version's section; that guard is skipped on a dry run, so a
   dry run stays runnable at any point in the order, including before step 2 is merged.

   This used to be impossible to follow: the changelog guard ran on dry runs too, so the
   dry run failed every time on a section that had not been written yet, and the only way
   to exercise the workflow was to cut the release for real (#1201).
   `scripts/check-release-dry-run.mjs` fails the build if a release step names
   `CHANGELOG.md` without being skipped on a dry run, so that cannot come back the same
   way. The check itself is not lost — `make release-tag` carries it locally, where it
   fires _before_ the tag exists rather than after.

4. **Tag it, from `main`:**

   ```bash
   git checkout main && git pull
   make release-tag VERSION=1.0.2
   ```

   This is the irreversible one, and it does exactly two things: create the annotated tag
   and push it. It asks for a `y` first, because pushing that tag submits to the store and
   the store will never accept this version number again.

   It refuses if you are not on `main`, if `CHANGELOG.md` has no `## v1.0.2` section (step 2
   was never merged), if `main` has moved on since those notes were written (something merged
   during the review window — re-run step 2 so the notes cover it), or if your `main` is out of
   step with `origin/main` (`git pull --ff-only`).

   Steps 2 and 4 are days apart in practice, and that is the point: between them, someone reads
   the release notes.

Pushing the tag triggers the [release workflow](../../.github/workflows/release.yml),
which:

- verifies the tag matches `manifest.json` (fails loudly if not),
- runs lint + build (the changelog is compiled in here),
- packages `extension/dist`, and
- submits it to the **Chrome Web Store** — once the store secrets exist (see
  [chrome-web-store.md](chrome-web-store.md)); until then it skips, loudly.

**Nothing is published to this repo.** No GitHub Release, no zip attached — the
package's only destination is the store, because that is the only place a user can
install it from.

## The changelog comes from PRs, not commits

`@kimtos/releaser` reads the **merged pull requests** in the range, not
the raw commits. A PR is the unit of change a person can actually follow: one title,
written to be reviewed, instead of the dozens of internal commits behind it. (Every
PR lands here as a merge commit whose body's first line _is_ the PR title, so this
needs no API call.)

Titles are bucketed by their conventional-commit type — `feat:` → **New**, `fix:` →
**Fixed**, everything else → **Improved** — so **the PR title is the changelog
entry**. Write it for a user, not for yourself.

Preview what the next release would say, without releasing anything:

```bash
make release-notes
```

## Notes

- **Tag format** is `vMAJOR.MINOR.PATCH` (e.g. `v1.0.2`).
- **The first release has no previous tag to diff against**, so its notes are just
  "Initial release" rather than every PR ever merged. Subsequent releases diff
  against the previous version tag as normal.
- The `models` tag is **not** a version tag — it stores the Denoise model weights
  as a release asset. The changelog only ever considers `v*` tags, so it is
  ignored. Do not delete it (see the Denoise self-hosting issue).

## The changelog starts where this product does

`CHANGELOG.md` carries the releases cut from this repo, and nothing before them: the old
`devhome`-era tags and releases were deleted from both repos, because they described a
product that no longer exists and the extension was showing them to users. Each
`make release-prepare` appends the next section, and that is what the in-app dialog renders.

## Who can actually install the result

**The Chrome Web Store is the only way in.** Nothing is attached to this repo, so
there is no zip to hand anyone — and there is no point in one: a private repo's
release asset only ever reaches people who already have the code. A tester who needs
a build runs `make build` and loads `extension/dist` unpacked.

For the public, the extension has to be published to the **Chrome Web Store** —
upload the `kimtos-vX.Y.Z.zip` asset to the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). That listing is
**live**, and its URL is declared once as `DEFAULTS.chromeWebStoreUrl` in
`@kimtos/config`; every surface that links to it reads it from there. Each new upload
still waits on Google's review, so the review time — not the code — sets when a
version reaches users.
