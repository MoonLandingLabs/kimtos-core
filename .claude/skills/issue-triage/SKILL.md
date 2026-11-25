---
name: issue-triage
description: Burn down the open issue backlog on kimtos-core with 3-5 parallel agents, one issue per agent. Covers claiming, reading the code before judging, the three allowed end states, labels and the 0.7.0 milestone, and cleanup. Use when the user says "triage issues", "clear the backlog", "go through the open issues", "close what we can", or asks to work the issue list. NOT for taking one issue to a merged PR — that is issue-workflow.
---

# issue-triage

Clear the open backlog. Each agent owns one issue at a time and drives it to one of exactly
three end states.

**Triage decides; it does not ship.** The valuable output is a backlog where every issue is
correctly closed, or correctly labelled and milestoned with a root cause written down. Most
issues need no code change at all. The few that do go through `issue-workflow`, which is the
one way code lands in this repo.

## Repo facts (do not re-derive)

| Thing            | Value                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo             | `MoonLandingLabs/kimtos-core`, checkout at `$REPO`                                                                                                                                  |
| Tool             | `gh` — never the web UI                                                                                                                                                             |
| Base branch      | `main`                                                                                                                                                                              |
| Active milestone | `0.7.0`                                                                                                                                                                             |
| Labels           | `bug`, `documentation`, `enhancement`, `critical`, `question`, `duplicate`, `invalid`, `wontfix`, `good first issue`, `help wanted`, `dependencies`, `javascript`, `github_actions` |
| Assignee         | `Mahmoud-Emad`                                                                                                                                                                      |

## Hard rules

Read these before anything else.

- **Never push to `main`, and never merge your own PR.** The source of this skill allowed
  direct pushes; this repo does not. `CLAUDE.md` and `issue-workflow` are explicit, and
  `main` is the release branch. A fix reaches `main` through a PR,
  a green gate and a self-review — or it does not reach it.
- **Never change code you do not understand.** Read first, decide second.
- **Never commit without every quality gate green.** No exceptions, no "it is a one-liner".
- **Every issue ends in exactly one of three states** — see below. "I looked at it" is not
  an end state.
- **Scope discipline.** Judge the issue in front of you. Spot an unrelated bug while
  reading? One sentence in your comment, then file it with `issue-create` and move on. Do
  not fix it here.
- **Everything you write sounds human.** Short plain sentences. No emojis (CI enforces this
  in the tree; the same bar applies to issue comments, which it cannot see). No
  "I have successfully", no bullet-point essays, no AI attribution, no `Co-Authored-By`.
- **Work in your own worktree, never in the shared checkout.** Other agents are in it.
- **Clean up immediately.** A worktree is ~600 MB of `node_modules`.

## The three end states

| State | What it means                    | What you do                                                                   |
| ----- | -------------------------------- | ----------------------------------------------------------------------------- |
| (a)   | Not a bug                        | Comment saying why, close. Label `invalid`/`duplicate`/`wontfix` if one fits. |
| (b)   | Real, and simple and safe to fix | Hand to `issue-workflow` — branch, PR, gate, self-review. Do NOT fix it here. |
| (c)   | Real, but not a quick fix        | Label `bug`, set milestone `0.7.0`, comment with the root cause, leave open.  |

State (c) is a good outcome, not a failure. An issue with a written root cause and a
correct label is worth more than a rushed fix, and far more than a re-read six weeks later.

**Most issues should end in (a) or (c).** If most of your batch is ending in (b), you are
fixing rather than triaging, and the backlog is not getting shorter any faster.

## Session start

1. Ask **which issues** — all open, a range, a label, or a milestone. Do not assume.
2. Fetch the list:
   ```bash
   gh issue list --state open --limit 100 \
     --json number,title,labels,assignees,milestone \
     --jq '.[]|"\(.number) [\(.labels|map(.name)|join(","))] \(.title)"'
   ```
3. Present a plan — one line per issue, which agent takes it — and get approval **before**
   launching anything.
4. Launch 3-5 agents, one issue each. Hand each a new issue as it finishes.

## Agent workflow

### 1. Read the issue

```bash
gh issue view <N> --json title,body,labels,assignees,state,comments \
  --jq '{title,state,labels:[.labels[].name],assignees:[.assignees[].login],comments:[.comments[]|{author:.author.login,body:.body}]}'
```

Read the body **and every comment**. The thread is where an issue actually lands — a comment
routinely narrows, corrects or supersedes the opening text, and the newest guidance wins.

Then restate in one or two lines what it claims and what a fix would require. If you cannot
state that, you do not understand it yet. Do not proceed.

### 2. Claim it, or stop

**Hard stop** if an assignee is set, or a comment carries an `[agent-claim...]` marker —
another agent owns it. Do not comment, do not branch. Report it and take the next one.

Otherwise, marker first (it is the lock; posting it first shrinks the race window), then
assignee. **Your marker carries a unique id of your own** — every agent runs as the same
account, so an unadorned marker is undecidable between two agents (#819):

```bash
gh issue comment <N> --body "[agent-claim:<your-id>] Triaging."
gh issue edit <N> --add-assignee Mahmoud-Emad
```

Re-read the comments and confirm the only marker is yours. If a marker with a **different**
id is there, delete your own and stop. Never delete a marker you cannot attribute to
yourself.

### 3. Take your own worktree

Only if you need to read or run code — a docs question or an obvious duplicate does not need
one.

```bash
N=245
WT=../kimtos-worktrees/main_triage_$N
git -C $REPO fetch origin
git -C $REPO worktree add "$WT" -b main_triage_$N origin/main
cd "$WT" && npm ci
```

Worktrees live in the **sibling** `../kimtos-worktrees/` — never inside the repo, where an
`import.meta.glob` would pick them up.

If `worktree add` fails with `already exists`, **stop**. That is almost certainly another
agent's live worktree, not your leftover — two agents deriving the same slug land on the
same path (#819). Go back and re-check the claim.

`npm ci` in your own worktree, never `npm install` in the shared checkout — that deletes the
toolchain out from under whatever is running there (#154).

### 4. Read the code before judging

Open every file and line the issue cites and confirm the claim is **still true**. Issues go
stale; a wrong premise produces a wrong verdict. Reproduce it if there is a way to.

If the issue's diagnosis is wrong, say so plainly in your comment — that is a useful
outcome, not an awkward one.

### 5. Decide

**(a) Not a bug** — works as intended, cannot reproduce, already fixed, or invalid:

```bash
gh issue comment <N> --body "Not a bug. the validator rejects an empty name on purpose, so the behaviour in the report is the guard working."
gh issue edit <N> --add-label invalid          # only if one genuinely fits
gh issue close <N>
```

Already fixed since it was filed? Say which change fixed it and close:

```bash
gh issue comment <N> --body "Fixed by #1178 — the session model landed and windows now restore. Closing."
gh issue close <N>
```

**(c) Real, but not a quick fix:**

```bash
gh issue edit <N> --add-label bug --milestone 0.7.0
gh issue comment <N> --body "Real bug, labelled it. `appsController.ts:208` early-returns for anything not running, so the control does nothing on a failed row. The fix needs a decision about what replaces the button — a failed row has no other control — so I would rather not rush it. Leaving open."
```

The comment is the whole value of state (c). **Write the root cause down.** The next person
should not have to re-derive what you just derived.

**(b) Real, simple and safe** — hand it to `issue-workflow`. Note in your comment that you
are doing so, release your claim if a different agent will take it, and clean up your
worktree. Do not fix it inside triage: the fix needs a branch, a PR, the full gate and a
self-review, which is exactly what that skill is.

If you are the one taking it forward, `issue-workflow` starts from step 1 and re-claims —
your triage marker is not a substitute for its claim.

### 6. Filing something new

Found an unrelated bug while reading? File it with the **`issue-create`** skill — title,
anchors, root cause, label, milestone. One sentence about it in your triage comment, then
move on. Do not fix it, and do not leave it only in chat: chat is lost, the tracker is the
memory.

## If you do fix something (state b, via issue-workflow)

The gate is `issue-workflow` step 7, in full. The short version for a typical extension fix:

```bash
npm run lint -w @kimtos/extension
npm run typecheck -w @kimtos/extension
npm run test -w @kimtos/extension
npm run build -w @kimtos/extension
npm test                 # root — the repo's own guards
npm run check            # root — every Conventions guard
npm run format:check     # root — prettier over EVERY file, not just your workspace
```

**Never disable, skip or weaken a check to get green.** If a check fails, the code is wrong.
If the check itself is wrong, stop and raise it.

**Report failures honestly with their output. Never claim green you did not see.** A CI
failure that is a known flake is still worth naming as one, with the evidence — say which
runs on `main` show it, rather than waving it away.

## Cleanup

The moment your issue reaches its end state — including (a) and (c), where you changed
nothing:

```bash
cd $REPO     # never remove a worktree you are standing in
git worktree remove ../kimtos-worktrees/main_triage_$N
git branch -d main_triage_$N                    # -d, never -D
git worktree prune
```

`-d` refuses if the branch has unmerged work. That refusal is information: find out why
before forcing anything.

**Only remove what you created.** Another `main_*` worktree in `git worktree list` is another
agent mid-flight. Leave it alone.

Before reporting done:

- `git -C $REPO status` is clean — you should not have
  touched the shared checkout
- `git worktree list` shows only the main checkout and other agents' live worktrees
- temp files and scratch scripts deleted

## Reporting back

One block per issue, and say the end state plainly:

```
#1142  (c) real  — admin support socket never reconnects after a forced disconnect. Labelled bug, 0.7.0.
#1150  (a) not a bug — works as designed, the caller should handle null. Closed.
#1163  (b) real, simple — handed to issue-workflow, PR #1171.
#1166  (a) fixed already by #1178. Closed.
```

Then the totals, and anything you filed with `issue-create`.

## Tone

### Issue comments

> Not a bug. A closed app reopening on its initial page is the documented behaviour of
> convention 10 — minimize is the verb that remembers. Closing.

> Cannot reproduce on `main` at e7b7d29. The switcher shows the minimized app and restores
> it on click. Closing — reopen with the exact steps if you still hit it.

> Real bug, labelled it. `kimtManager.ts:208` returns early for anything not running, so the
> Stop on a failed row does nothing. Fixing it properly means deciding what replaces the
> button, since a failed row has no other control. Leaving open for that.

> Fixed by #1209 — the changelog guard is skipped on a dry run now, so the documented order
> works. Closing.

Note what these have in common: a specific anchor, one claim, and a decision. No preamble,
no summary of what the issue said back at the person who wrote it.

### Never

- An emoji, anywhere
- "I have successfully triaged this issue"
- A bullet-point essay restating the issue body
- A fix pushed straight to `main`
- Any mention of Claude, an AI, or a `Co-Authored-By`
