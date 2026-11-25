---
name: issue-workflow
description: >-
  The MANDATORY end-to-end pipeline for taking a GitHub issue to a merged PR in
  kimtos-core: claim the issue (labels, assignee, project status, marker
  comment), branch in an isolated git worktree, plan as an architect, get the
  user's sign-off, implement as tracked tasks, pass the same gate CI runs, open
  the PR, and verify main after merge. Use whenever the user gives an issue link
  (github.com/MoonLandingLabs/kimtos-core/issues/N), an issue number (#25), or says
  "work on this issue", "implement #N", "fix this bug", "pick up that issue",
  "take issue N". If the user supplies ONLY an issue link with no other
  instruction, that alone means: run this skill. Trigger on: "issue", "#N",
  "issues/N", "work on", "implement", "fix", "ship", "PR for".
---

# issue-workflow — issue → merged PR

The one way we ship in this repo. Follow the steps **in order**. Do not skip a
step because the change "looks small"; the gates exist because silent drift is
this project's recurring failure mode.

## Repo facts (do not re-derive)

| Thing       | Value                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Remote      | `MoonLandingLabs/kimtos-core`                                                                                      |
| Base branch | `main` (the release branch)                                                                                        |
| PR template | `.github/PULL_REQUEST_TEMPLATE.md` (already applied by `gh pr create`)                                             |
| Labels      | `bug`, `documentation`, `enhancement`, `good first issue`, `help wanted`, `question`, `dependencies`, `javascript` |
| Assignee    | the repo owner, `Mahmoud-Emad`                                                                                     |
| Commits     | Conventional Commits. **Never** a `Co-Authored-By` or "Generated with" trailer.                                    |

Branch naming: **`main_<type>_<slug>`** — the base branch, the type, a short
kebab slug. `main_feat_agent_tools_docs`, `main_fix_plans_cta`,
`main_docs_retouch_booklet`, `main_chore_docs_ci`.

---

## Handle what you find (applies at every step)

**Anything you notice that is wrong, missing, stale or worth improving gets
handled — every time, without being asked.** Bugs, gaps, dead links, drift,
silent fallbacks, missing tests or CI, licensing problems, enhancements,
inconsistencies between a doc and the code. If you saw it, do not walk past it.

**Triage by size:**

- **Small — fix it on the fly, do not file it.** A typo, a stale comment, a dead
  link, a one-line doc/code mismatch, an obvious trivial gap: just fix it as part
  of your work. Filing an issue for something you could have fixed in the time it
  took to write the issue is pure overhead. No issue, no separate branch — the fix
  rides along, and you note it in the PR body.
- **Complex — file it, do not fix it.** Anything non-trivial, anything that needs
  its own design decision, or anything unrelated to the issue you are on that
  would be real scope creep: open a separate GitHub issue and keep your diff to
  the issue you claimed. Folding a large unrelated change into your branch makes
  the PR unreviewable and buries the finding where nobody will search for it. Note
  it in your PR's _Out of scope_ section and link the new issue.

When in doubt about which bucket a finding falls in, file it — a filed issue is
cheap to close, a bad inline change is not.

Do not settle for mentioning a complex finding in chat or in a PR comment. Chat is
lost; the issue tracker is the memory. If it is only in a message, it did not
happen.

**Use the `issue-create` skill for every issue you file.** It carries the title rule, the
body shapes, the label list, the active milestone and the dedupe check, so an issue you open
mid-task is as good as one written deliberately. Do not hand-roll `gh issue create`.

Rules that make the issues you _do_ file worth having:

- **Verify before you file.** Open the file, run the command, check the live
  surface. Quote the evidence — the line, the failing output, the curl. An issue
  built on a guess wastes more time than it saves.
- **Root cause, not symptom.** Say _why_ it is broken, not just that it looks
  wrong. If the same defect could recur elsewhere, say so — prefer the structural
  fix (generate it, assert it in CI) over patching the instance.
- **Say what it costs.** Who hits it, and what breaks for them. A reader should
  be able to prioritise it without re-deriving the impact.
- **Search first** (`gh issue list --search`) — do not file a duplicate. If the
  work belongs to an open issue, comment there instead.
- **Correct your own issues.** If you later discover an issue you filed is wrong,
  say so on that issue with the evidence, and adjust its scope. A confidently
  wrong issue is worse than no issue — it sends the next person down a dead end.

---

## 1. Claim the issue — or stop

Read it first, then claim. **If it is already claimed, stop and tell the user.**

```bash
gh issue view <N> --json title,body,labels,assignees,state,comments
```

**Hard stop** if _any_ of these is true — another agent owns it:

- an assignee is set, **or**
- it carries an in-progress label, **or**
- a comment contains an `[agent-claim…]` marker (with or without an id).

On a hard stop: do not branch, do not edit, do not comment. Report who/what
holds it and end the turn. The user can say "take over #N" to override.

Otherwise claim it, in this order. **Your marker must carry a unique id of your
own** — a session id, run id, anything nobody else will reproduce. Every agent
runs as the same `Mahmoud-Emad` account and derives the same branch slug from
the same title, so an unadorned `[agent-claim]` is byte-identical between two
agents and the tie-break below is undecidable. The id is what makes it decidable
(#819). Pick it once and reuse it as `<id>` throughout:

```bash
# 1. marker comment FIRST — it is the lock; posting it first shrinks the race window.
#    <id> is YOUR unique id (session/run id). Keep it in the marker.
gh issue comment <N> --body "[agent-claim:<id>] Starting work. Branch: \`<branch>\`."

# 2. labels (only the ones that genuinely apply; never invent a label)
gh issue edit <N> --add-label documentation

# 3. assignee
gh issue edit <N> --add-assignee Mahmoud-Emad
```

Then **re-read the comments** and confirm the only marker is the one bearing
**your** id:

- **Only your id present** (possibly more than once — a retry double-post): you
  hold the lock. If you double-posted, delete the extra copies of your own id.
- **A marker with a different id is present**: you lost the race. Delete **your
  own** marker (the one with your id) and stop.

**Never delete a marker you cannot positively attribute to yourself.** A marker
whose id is not yours belongs to another agent; deleting it silently unlocks an
issue someone is actively working — exactly the failure #819 records. If you
cannot tell whose a marker is (e.g. a legacy id-less `[agent-claim]`), treat it
as another agent's and hard-stop.

### Project board status → In Progress

The board's name and field values are discovered at runtime, so this survives a
rename:

```bash
gh project list --owner MoonLandingLabs                 # → project number
gh project field-list <num> --owner MoonLandingLabs     # → the Status field + its option ids
gh project item-list  <num> --owner MoonLandingLabs     # → find this issue's item id
gh project item-edit --project-id <pid> --id <item> --field-id <fid> --single-select-option-id <opt>
```

If `gh` errors with `missing required scopes [read:project]`, tell the user to
run `gh auth refresh -s project,read:project` and continue with the rest of the
workflow — a missing board update is not a reason to abort.

## 2. Branch in an isolated worktree

Never work in the main checkout — a parallel agent will clobber you.

```bash
git -C $REPO fetch origin
git -C $REPO worktree add \
  ../kimtos-worktrees/main_fix_example -b main_fix_example origin/main
```

Worktrees live in the **sibling** `../kimtos-worktrees/<branch>` — never inside
the repo, where an `import.meta.glob` would pick them up. All subsequent work happens in that directory.

**If `git worktree add` fails with `already exists`, stop — do not reuse the
directory.** A path that is already there is almost certainly another agent's
live worktree, not your own leftover (two agents deriving the same slug resolve
to the same path — #819). Reusing it means two agents editing one working tree
on one branch, where either's `git checkout --` or `git clean` destroys the
other's uncommitted work. Go back to step 1, re-read the claim, and confirm the
marker is yours; if it is another agent's, hard-stop. Only after you have
positively confirmed the worktree is your own abandoned leftover may you reuse
it.

**Your worktree needs its own install.** A worktree is a sibling directory, not a
child, so Node never resolves up into the main checkout's `node_modules` — run
`npm ci` inside the worktree once, and the dependency tree really is isolated
(it costs ~600 MB per worktree, which is the price of that isolation).

**Never install in a checkout something else is using.** The one thing that is
NOT isolated is a single directory against itself: `npm install` in `main` while
`main` is running its gate deletes the toolchain out from under it, and you get
`eslint: command not found` (127) — which looks exactly like a broken merge and
sends you hunting a bug that does not exist (#154). `make` now serializes its own
installs with a lock and fails with a legible message instead, but a bare
`npm install` you run yourself is outside that. So: install in your worktree, and
leave the main checkout alone.

### Keeping your branch current — merge, never rebase

When your branch falls behind `main` and you need its latest commits, **merge —
never rebase**:

```bash
git fetch origin
git merge origin/main          # NOT git rebase origin/main
```

Rebasing rewrites the commits already pushed to your branch, which force-pushes
over the exact history a parallel agent or reviewer may be reading, and quietly
detaches any review already done from the commits it reviewed. A merge is
additive: it preserves every existing commit and records the integration
explicitly. Always merge.

## 3. Understand before you plan

Read the issue **and the code it names**. Open every file and line the issue
cites and confirm the claim is still true — issues go stale, and a wrong premise
produces a wrong fix. If the issue's diagnosis is incorrect, say so before
planning.

**Read every comment on the issue, in full, and factor them in.** The opening
description is only the first word; the thread is where the issue actually lands.
Fetch the whole conversation and treat it as part of the spec:

```bash
gh issue view <N> --json title,body,comments --jq '.comments[].body'
```

A comment routinely **narrows, widens, corrects or supersedes** the original
ask — the owner clarifies the real requirement, rules an approach out, points at
the true root cause, or answers a question a prior agent raised. The newest
guidance wins over the opening text when they disagree. What you must never do is
implement the title against a thread that already redirected it: a fix that
ignores the discussion is wrong even when it matches the description, and it
reads as not having looked. If a comment and the code disagree, verify against
the code and say so; if two comments disagree, the later one and the owner's word
carry. Surface anything in the thread that changes the shape of the work **before**
you plan, so the plan reflects the whole conversation rather than only its first
line.

Then enter **plan mode** (`EnterPlanMode`).

## 4. Plan as an architect, not a coder

The question is never just "what change closes this ticket". It is **"what is
the right shape of this change given where the codebase is going"**. Weigh:

- **Fix the class, not the instance.** This codebase's defining failure is
  hand-maintained things drifting from generated ones. If the issue is one
  symptom of a systemic gap, prefer the structural fix (generate it, assert it
  in CI) over patching the instance. Say so explicitly in the plan.
- **Single source of truth.** A fact lives in exactly one place — `meta.ts`,
  `@kimtos/config`, `@kimtos/icons`, `APP_GLYPHS`. Never introduce a second
  copy of a fact that already exists.
- **The conventions are load-bearing.** Honour the seven app conventions in
  `CLAUDE.md` and `docs/extension/architecture.md`. A change that requires an
  exception to them is usually the wrong change.
- **Local-first is the product.** No user data leaves the device. A plan that
  adds a network round-trip for app data is wrong by definition.
- **Blast radius.** Which workspaces does this touch? What does it
  break in the extension, www, docs?
- **Alternatives.** Name the option you rejected and why. A plan with only one
  option hasn't been thought about.

## 5. Get sign-off

Call `ExitPlanMode` with, in this order:

1. **What's wrong, in plain English** — as if explaining to someone who has
   never opened the file. No jargon, no file paths in this part.
2. **What we'll do about it** — the approach, in a few sentences.
3. **The steps.**
4. **What we're deliberately not doing** (and any follow-up worth its own issue).

Then stop and wait. Do not start editing.

## 6. Implement as tracked tasks

Split the plan with `TaskCreate`; mark each `in_progress` as you start it and
`completed` when it's done.

**The plan is a living document.** If the user raises a concern — at sign-off or
mid-implementation — update the plan _and_ the task list to match before
continuing. Never carry on against a stale plan.

Once the plan is agreed (and again whenever it materially changes), post the
**simplest version** of it to the issue:

```bash
gh issue comment <N> --body "**Plan**

<3–6 plain-English bullets. What we're changing and why. No file paths.>"
```

Write code that reads like the code around it — match the existing naming,
comment density and idiom.

## 7. The gate — make CI green _before_ you push

Run exactly what CI runs, for **every workspace you touched**:

| Touched            | Commands                                                                                                                                                                                                      | Covered by CI?                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `extension/`       | `npm run lint -w @kimtos/extension`<br>`npm run typecheck -w @kimtos/extension`<br>`npm run format:check -w @kimtos/extension`<br>`npm run build -w @kimtos/extension`<br>`npm run test -w @kimtos/extension` | Yes — _Extension_ + _Unit tests_   |
| `www/`             | `npm run typecheck -w @kimtos/www`<br>`npm run generate -w @kimtos/www`<br>`npm run test -w @kimtos/www`                                                                                                      | Yes — _Site_                       |
| `www-docs/`        | `npm run typecheck -w @kimtos/www-docs`<br>`npm run build -w @kimtos/www-docs`<br>`npm run test -w @kimtos/www-docs`                                                                                          | Yes — _Docs build_ + _Unit tests_  |
| shared packages    | `make shared` — every consumer reads `dist/`, and it is gitignored<br>`npm run test -w @kimtos/<pkg>` for `releaser`, `config`                                                                                | Yes — _Makefile_ + _Unit tests_    |
| `scripts/`         | `npm test` (root — the repo's own guards are themselves tested)<br>`node scripts/release.mjs check`                                                                                                           | Yes — _Unit tests_                 |
| any `CHANGELOG.md` | `node scripts/release.mjs check` — every app and deployable must be versioned                                                                                                                                 | Yes — _Unit tests_                 |
| `Makefile`         | `rm -rf shared-modules/*/dist .make && make build`                                                                                                                                                            | Yes — _Makefile_                   |
| **any change**     | `npm run format:check` (root — `prettier --check .`)<br>`npm run check` (root — every _Conventions_ guard, see below)                                                                                         | Yes — _Formatting_ + _Conventions_ |

**Every workspace has CI** — `www-docs` has its own job (#32), so a green PR really does cover all of them. But "every workspace has a job" is not "every CI job has a row":
the repo-wide **Formatting** job runs the root `npm run format:check`
(`prettier --check .`) over **every** file, including Markdown, YAML and JSON that
live outside any workspace. Run it on **any** change — a docs-only
PR that passes its per-workspace row can still fail Formatting on an untouched-looking
Markdown file (#795, #777). The per-workspace `format:check -w …` runs are subsumed
by the root run, so the root run is the one that matters.

The same is true of the **Unit tests** job (`.github/workflows/test.yml`). It is the
one job with no workspace of its own: it runs the tests of `releaser`, `config`,
`extension` and `www-docs`, plus the root
`npm test` over `scripts/` and `node scripts/release.mjs check`. So a per-workspace
row is not the whole gate for that workspace — the extension's 436 tests live here,
not in the _Extension_ job, and reading `extension.yml` alone will tell you they are
not run at all (that misreading was filed as #938 and closed). Tests import shared
packages from their gitignored `dist/`, so run `make shared` before them.

The **third** such job is **Conventions**, and it is the one that bites hardest,
because its guards are what enforce the rules in `CLAUDE.md` — no colour emoji, no
present-tense agent capability claim, no dead doc link, no undeclared network host,
every shipped model
attributed. Its guards are not run by any workspace's `lint`. Run them with
the root:

```bash
npm run check          # every Conventions guard, in CI's order
```

That script (`scripts/check-all.mjs`) **reads the job out of the workflow** rather
than restating the list, so a guard added to CI runs locally with no edit here. It
exists because a local gate that omitted `check-emoji.mjs` let three colour emoji
reach `main` in test fixtures, turning the Conventions job red for every open PR
until someone noticed — the exact shape of drift the guards themselves exist to stop.

**If you touched the `Makefile`, test it from a cold start** —
`rm -rf shared-modules/*/dist .make` first. Every shared package is compiled and its
`dist/` is gitignored, but `npm ci` builds them all behind your back via npm's
`prepare` hook. So a Makefile that has _no idea_ how to build them still looks fine
until someone runs `git clean`. That is exactly how #111 shipped (`make www` died on
`@kimtos/config` and no target could repair it, while CI stayed green). The _Makefile_
job does this for you, but do not let it be the first to find out.

**Never disable, skip or weaken a check to get green.** No `--no-verify`, no
`eslint-disable` to silence a real finding, no deleting a failing test, no
loosening a CI step. If a check fails, the code is wrong — fix the code. If the
check itself is genuinely wrong, stop and raise it with the user.

Report failures honestly with their output. Never claim green you didn't see.

## 8. Commit, push, open the PR **as a draft**

```bash
git add -A
git commit -m "fix(www-docs): point the install link at the store listing"   # Conventional Commits, NO trailers
git push -u origin main_fix_example
gh pr create --base main --fill-first --draft
```

**Open the PR as a draft (`--draft`), and keep it draft until the self-review in
step 9 is green.** The review round in step 9 produces commits _after_ the PR
exists, and if the owner merges the instant a mergeable PR appears, every review
fix lands after the merge and is silently dropped — the issue closes, the PR
reads green, and the correctness fixes the review found sit on an orphaned branch
(#810; it happened to #772 and #785, each needing a whole second cycle to
re-land). A draft **cannot be merged**, so the tool closes the race instead of
leaving it to timing. You mark it ready only in step 9, once the review is green.

The PR body follows `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## What & why

<2–4 sentences: what changed and why. Then:>

Closes #<N>

## Checklist

- [x] `make lint` passes
- [x] `npm run typecheck -w @kimtos/extension` passes
- [x] `npm run format:check` passes (root — `prettier --check .`, the _Formatting_ job)
- [x] `make build` succeeds
- [x] Self-reviewed with the `code-review` skill; every finding resolved (100% green)
- [x] Conventional Commits, no `Co-Authored-By` trailer
- [x] Clear commit/PR title (it appears in the release changelog)
```

Only tick a box you actually ran. Drop rows that don't apply to the workspaces
you touched, and add the ones that do.

The PR-and-CI-green flow is a discipline we hold — never push straight to `main`.

## 9. Review your own PR — loop the `code-review` skill until it is green

**Mandatory. Do not skip it, and do not hand back until it passes.** The moment
the PR is open — before anyone else looks at it — review your own diff.

1. **Load the `code-review` skill** and run it against this PR's diff.
2. **Fix every finding it surfaces** — correctness bugs first, then the
   reuse / simplification / efficiency cleanups. These findings are on _your own
   unmerged diff_, so you fix them **inline on this branch**: that is the whole
   point of the review. This is consistent with _Handle what you find_ — a finding
   about the code you are shipping is always yours to fix now, whatever its size.
   Only a _large, unrelated_ gap you stumble on gets its own issue instead of being
   folded into this branch.
3. **Re-run the step-7 gate** after the fixes — a fix can break lint, types or a
   test, and CI will catch it if you don't.
4. **Re-run the `code-review` skill.** Repeat 2–4 until the review comes back with
   **no remaining findings — 100% green.** A review that still lists a real
   finding is not done, however small the finding looks.
5. Commit the fixes (Conventional Commits, no trailer), push to the same branch,
   and leave a PR comment saying what the review found and how you resolved it.
6. **Only now mark the PR ready** — the review is green and every review commit is
   pushed, so nothing can be lost to a merge:

   ```bash
   gh pr ready <PR>   # lifts the draft; the PR is now mergeable
   ```

Only once the review is green AND the PR is marked ready do you move on to hand
back. If you judge a finding to be a false positive, **say so on the PR with the
evidence** rather than silently dropping it — an unaddressed finding and a
refuted one are not the same thing.

## 10. Hand back

Post the PR link on the issue and **ask the user to review and merge** — never
merge it yourself.

```bash
gh issue comment <N> --body "PR open: #<PR> — ready for review."
```

## 11. After the merge — verify main

Only once the user confirms it's merged:

```bash
git -C $REPO checkout main
git -C $REPO pull origin main
```

Confirm the change actually landed (grep for it — a merge can silently lose a hunk
to a bad conflict resolution), then **re-run the step-7 gate on `main`**. Other PRs
may have merged alongside yours; green on your branch does not mean green on `main`.

Confirm the issue closed (the `Closes #N` should have done it) and move the project
item to Done.

## 12. Clean up — always, and only after the merge

Leftover worktrees and branches are not harmless. A stale worktree is a second
checkout of this repo on disk: it gets picked up by
`import.meta.glob`, it makes `git worktree list` unreadable, and the next agent
cannot tell an abandoned branch from one that is in flight.

Remove **your own** worktree and branch — never anyone else's:

```bash
cd $REPO          # never delete a worktree you are standing in
git worktree remove ../kimtos-worktrees/main_fix_example
git branch -d main_fix_example                        # -d, not -D: it refuses if the work is unmerged
git push origin --delete main_fix_example             # if the merge did not auto-delete it
git worktree prune                                    # drop administrative leftovers
```

Then confirm the repo is actually clean:

```bash
git worktree list        # only the main checkout, plus any OTHER agent's live worktree
git branch --merged main # nothing of yours left behind
```

Rules:

- **`git branch -d`, never `-D`.** If `-d` refuses, the work is not merged — stop
  and find out why. Do not force it away.
- **Only remove what you created.** Another `main_*` worktree in the list is
  another agent mid-flight (`git worktree list` will show it). Leave it alone.
- **Never clean up before the merge**, and never `--force` a worktree that has
  uncommitted changes — that is unpushed work, and it is gone for good.
- If cleanup cannot complete (dirty worktree, unmerged branch), **say so plainly**
  rather than forcing it. A leftover worktree you mention is a minor annoyance; work
  you silently destroyed is not recoverable.

Report the outcome plainly.

---

## Never

- **Use an emoji** — anywhere. Not in an issue, a comment, a PR title or body, a
  commit message, code, or a code comment. Write the word, or use a plain
  `Yes`/`No`/`-` in a table. (Keyboard glyphs already used in the codebase — `⌘`,
  `▸` — are not emoji and are fine.)
- Push straight to `main`, or merge your own PR.
- Work in the main checkout instead of a worktree.
- Add a `Co-Authored-By` / "Generated with" trailer.
- Disable, skip or weaken a CI check, lint rule or test to get green.
- Touch an issue another agent has claimed.
- Commit or push work the user didn't ask for.
- **Walk past a bug, gap or improvement** — see _Handle what you find_. Small
  ones you fix on the fly; complex or unrelated ones you file **with the
  `issue-create` skill**. What you never do is nothing. Equally: never smuggle a
  _large_ unrelated change into the branch you are on — file it, link it, move on.
- **Rebase.** When your branch needs `main`'s latest, `git merge origin/main` —
  never `git rebase`. See _Keeping your branch current_.
