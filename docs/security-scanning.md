# Security scanning: what runs, what does not, and why

Written while closing [#21](https://github.com/MoonLandingLabs/kimtos-core/issues/21), and
rewritten when CodeQL was replaced by Semgrep. Read this before "fixing" CodeQL — the
obvious move makes things worse.

## The state today

| Check                                   | Runs?                     | Where                                                                                                                 |
| --------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **SAST** (Semgrep OSS)                  | **Yes** — fails the build | `.github/workflows/security.yml`                                                                                      |
| **Dependency advisories** (`npm audit`) | **Yes** — fails the build | `make audit`, and a step in the _Makefile_ CI job ([#150](https://github.com/MoonLandingLabs/kimtos-core/issues/150)) |
| **CodeQL / code scanning**              | **No** — see below        | —                                                                                                                     |
| Dependabot version bumps                | Yes                       | `.github/dependabot.yml`                                                                                              |

## CodeQL does not work on this repo, and cannot be made to

The repository is **private**, and CodeQL is free only on **public** repositories. On a
private one it requires an organization on GitHub Team or Enterprise Cloud **with a GitHub
Code Security licence**, which this org does not have. From GitHub's own CLI documentation:

> The CodeQL CLI is free to use on public repositories. The CodeQL CLI is also available in
> private repositories owned by organizations that use GitHub Team or GitHub Enterprise
> Cloud and have a license for GitHub Code Security.

This is a **licensing** limit (once the repository is public, CodeQL is free and can be enabled), not a configuration mistake, and no amount of
workflow YAML changes it.

### What actually happens when you try

A `codeql.yml` was added on the self-hosted runners (797e8ba) on the theory that owning the
runners was the missing piece. It is not. The analysis itself ran perfectly — extraction
completed, all 89 queries evaluated, results interpreted — and then the job died on the
last step:

```
##[error]Please verify that the necessary features are enabled:
Advanced Security must be enabled for this repository to use code scanning.
```

Every run was a red check. The workflow has been **deleted**, and it should stay deleted
until a licence exists.

### The trap: "just skip the upload"

The tempting workaround is to run CodeQL with the upload disabled and gate on the local
SARIF instead. **Do not.** The restriction is on the CLI **analysing private code**, not on
the dashboard upload — skipping the upload does not bring the repo inside the licence. Nor
does running it on our own hardware: the limit is the licence, not the compute.

## Why Semgrep, and why not eslint-plugin-security

Both were measured on this codebase rather than assumed.

**`eslint-plugin-security`** was the first candidate, since ESLint already runs here:

|                                                               |                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Total findings                                                | **195**                                                                          |
| `detect-object-injection` (fires on any `obj[key]`)           | **179** — noise                                                                  |
| `detect-unsafe-regex` (ReDoS)                                 | 3 — **all false positives**; plain linear regexes like `/^#settings(?:=(.+))?$/` |
| `detect-possible-timing-attacks`, `detect-non-literal-regexp` | 13 — false positives in on-device app code                                       |

Zero real findings, 195 false positives. Gating on that would mean ~179 inline disable
comments buying no signal, and a lint step everyone learns to ignore. It was **not**
adopted, and that reasoning still stands.

**Semgrep OSS** was measured the same way, and came out very differently:

|                 |                                                                  |
| --------------- | ---------------------------------------------------------------- |
| Rule packs      | `p/javascript`, `p/typescript`, `p/secrets`                      |
| Files scanned   | 889                                                              |
| Total findings  | **1**                                                            |
| Real issues     | **0**                                                            |
| False positives | 1 — annotated at its site in `shared-modules/icons/src/index.ts` |

The single finding is `insertAdjacentHTML` in `paintAppTile`, where the markup comes from
the hardcoded `APP_GLYPHS` table and never from caller input. It carries a `nosemgrep`
line explaining exactly that. **The suppression must sit on the line directly above the
call** — Semgrep ignores it if another comment line comes between.

So Semgrep gives a gate that is green on the current tree and would go red on a real
finding, which is the whole point of a check. Its OSS engine and the `p/*` packs carry no
private-repo condition, so it runs on our own runners at no cost.

### Runner prerequisite

Semgrep is **provisioned on the runner host**, not installed per run — a pip install would
cost roughly 30 seconds of every job for a binary that does not change between them:

```sh
python3 -m venv /usr/local/lib/semgrep-venv
/usr/local/lib/semgrep-venv/bin/pip install semgrep
ln -sf /usr/local/lib/semgrep-venv/bin/semgrep /usr/local/bin/semgrep
```

The workflow checks for it first and fails with those exact instructions if it is missing,
so a reprovisioned runner reports the real cause rather than a bare "command not found".

## If code scanning on a private repo is genuinely wanted

Pick one, deliberately:

1. **Buy a GitHub Code Security licence.** The CodeQL analysis already runs clean on our
   runners — only the upload is refused — so this works with no further code change.
2. **Go public.** CodeQL is free on public repositories.

Either can sit **alongside** Semgrep; they are complementary, not alternatives. Until then,
Semgrep and `npm audit` (`make audit`) are the security signals that actually work here,
and both fail the build.
