---
name: issue-create
description: How to write and open a good GitHub issue on kimtos-core — title, body, labels, milestone, and the dedupe check. Use this EVERY time you file an issue, including the ones the issue-workflow and issue-triage skills tell you to file, and the "complex gap" ones CLAUDE.md says to open rather than fix inline. Trigger on: "file an issue", "open an issue", "raise a ticket", "gh issue create", "log this", "worth its own issue".
---

# issue-create

The authoring side of an issue. For taking an existing issue to a merged PR, see
`issue-workflow`. For clearing a backlog, see `issue-triage`.

**Use this whenever you file an issue.** CLAUDE.md tells every agent to open an issue for
any complex gap it finds; `issue-workflow` says the same for scope creep. This is the how.

## Repo facts (do not re-derive)

| Thing            | Value                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo             | `MoonLandingLabs/kimtos-core`                                                                                                                                                       |
| Tool             | `gh` — never the web UI, never `curl` against the API                                                                                                                               |
| Labels           | `bug`, `documentation`, `enhancement`, `critical`, `question`, `duplicate`, `invalid`, `wontfix`, `good first issue`, `help wanted`, `dependencies`, `javascript`, `github_actions` |
| Active milestone | `0.7.0`                                                                                                                                                                             |

Never invent a label. If none of them fits, use no label rather than a new one.

## Rules

Not style preferences. An issue that breaks them costs the next person time.

- **No emojis.** Anywhere — title, headings, body. `scripts/check-emoji.mjs` enforces this
  across the repo and the same bar applies to issues, which it cannot see.
- **No AI attribution.** Never mention Claude, an agent, "generated with", and never add a
  `Co-Authored-By`. The issue reads as if a developer wrote it, because one did.
- **Short.** A section with nothing to say gets deleted, not left empty.
- **Plain sentences.** No marketing, no hedging, no "it seems that perhaps".
- **Every claim gets an anchor** — a `file.ts:61`, an exact error string, a command someone
  can run, or a CI run URL. A claim with no anchor is a guess, and you label it as one.
- **Verify before you file.** Open the file, run the command, check the live surface. An
  issue built on a guess wastes more time than it saves.
- **Search first.** A duplicate is worse than silence, because now two threads drift.

## Before you write

```bash
gh issue list --state all --search "<the distinctive words>" --limit 20 \
  --json number,title,state --jq '.[]|"\(.number) [\(.state)] \(.title)"'
```

If it already exists and is open, comment there instead. If it exists and is closed with the
bug still live, reopen it with the new evidence rather than filing a second one.

## Title

State the defect and its consequence, not the topic. The reader decides whether it affects
them without opening it.

```
bad   Switcher issue
bad   Fix KimtManager
good  A failed job still renders a Stop that does nothing, on both KimtManager and the switcher
good  The documented release order is impossible: the dry run verifies a changelog section only 'make release' writes
```

The good ones are long. That is fine — a title that carries the finding is worth more than a
short one that carries nothing.

## Body

Start from the shape that fits. Delete every section you have nothing to put in.

### A code-level bug

The one we file most. **Root cause replaces "steps to reproduce"** once you know it.

````markdown
## What is wrong

What breaks, in one or two sentences, with the exact error string the reader will search for.

`extension/src/lib/kimtManager.ts:208` returns early for anything that is not running:

```ts
if (!rec.spec.cancellable || (rec.status !== 'running' && rec.status !== 'queued')) return;
```

## Root cause

Why it is broken, and what the naive reading gets wrong. This is the most valuable part of
the issue — it stops the next person re-debugging something that is not the problem.

## Cost

Who hits it and what breaks for them. A reader should be able to prioritise it without
re-deriving the impact.

## Verified

- `lib/kimtManager.ts` -> `cancelRecord` early-returns on a failed record.
- No Retry or Dismiss affordance exists on either row today.
````

### A behavioural bug you cannot yet explain

```markdown
## What is wrong

## To reproduce

1. ...
2. ...
3. See `<exact error string>`

## Expected

## Environment

- Extension version:
- Browser:
```

### A feature or a change of approach

```markdown
## Summary

The problem, concretely. Not aspirational.

## Proposed shape

What should happen.

## Alternatives considered

What you rejected and why. A proposal with one option has not been thought about.

## Cost and risk

What it touches, and what could go wrong.
```

## Sections worth adding when they apply

- **`## Suggested fix`** — as a short list. Say what should NOT change and why, if there is
  an obvious wrong fix: "the fix deliberately does not belong in the view, because ...".
- **`## Acceptance`** — what has to be true to close it. Especially valuable when you are
  filing work for someone else to pick up.
- **Cross-reference** — link the issue or PR that caused this, inline and in the first
  paragraph: `Found in the self-review of #1214.` One line.
- **`## Out of scope`** — what this issue is deliberately not about, when it sits next to a
  bigger change someone might otherwise fold in.

## Filing it

**Write the body to a file.** Inline shell quoting mangles newlines and backticks, and a
mangled body is how a code block ends up as one line.

```bash
cat > /tmp/issue.md <<'EOF'
## What is wrong
...
EOF

gh issue create \
  --title "<defect and consequence>" \
  --label bug \
  --milestone 0.7.0 \
  --body-file /tmp/issue.md
```

**Milestone.** Put it on `0.7.0` if it is work we intend to do. Leave it off if it is a
question, a duplicate, or something you expect to be closed unfixed — a milestone is a
commitment, and a milestone full of things nobody will do stops meaning anything.

**Labels.** One is usually right. `critical` is for something breaking users now, not for
something you would like looked at soon.

## After filing

Say the number and the link in your reply, and in the PR body if the finding came out of
one. An issue nobody is told about is only marginally better than no issue.

If you later find the issue was wrong, **say so on the issue** with the evidence and adjust
its scope. A confidently wrong issue sends the next person down a dead end, which is worse
than never having filed it.

## Checklist

- [ ] Searched for a duplicate first
- [ ] Title names the defect AND its consequence
- [ ] Exact error string in the body, verbatim
- [ ] Every claim has a `file:line`, a command, a run URL, or is labelled a guess
- [ ] Root cause stated, or explicitly called unknown
- [ ] No empty sections
- [ ] No emojis, no AI attribution, no `Co-Authored-By`
- [ ] Label applied; milestone `0.7.0` if we mean to do it
- [ ] Related issue or PR cross-referenced
