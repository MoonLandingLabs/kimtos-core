// What a release actually touched.
//
// This is the one genuinely new piece, and it exists to answer questions the old scripts
// could not:
//
//   - Which APPS changed? (PR 2 needs this to bump each app's version and write its
//     changelog — today every app declares version 1.0.0, that number is shown to users,
//     and nothing ever bumps it.)
//   - Which WORKSPACES changed? A release that touched only `docs/` does not need a Chrome
//     Web Store submission at all; one that touched `extension/` does. Knowing the
//     difference is what lets the release decide that for itself later, instead of a human
//     remembering.
//
// Attribution uses two independent signals, and unions them, because either alone lies:
//
//   - the conventional-commit SCOPE (`feat(notaboard): …`) — what the author *said* they
//     changed;
//   - the FILE PATHS under `extension/src/apps/<id>/` — what they *actually* changed.
//
// A PR titled `fix(notes)` that also edits notaboard is caught by paths; a PR that edits
// no app file but is scoped to one (a docs-only tweak, say) is caught by the scope.
import { execFileSync } from 'node:child_process';
import { mergedPRs, type MergedPR } from './notes.js';

export interface DiffReport {
  from: string;
  to: string;
  prs: MergedPR[];
  /** Commit count in the range (all commits, not just merges). */
  commits: number;
  /** Every file changed in the range. */
  files: string[];
  /** App ids touched — by commit scope or by a file under `extension/src/apps/<id>/`. */
  apps: string[];
  /** Top-level workspaces touched: extension, www, docs … */
  workspaces: string[];
}

const APP_PATH = /^extension\/src\/apps\/([^/]+)\//;

/**
 * The top-level directory a file lives in — `extension`, `www`, `docs`, `shared-modules`.
 *
 * A file at the repo ROOT (`Makefile`, `package-lock.json`) has no workspace, and must not
 * report its own filename as one. Returns '' for those, and the caller drops it.
 */
const workspaceOf = (file: string): string => (file.includes('/') ? (file.split('/')[0] ?? '') : '');

export function diffReport(from: string, to = 'HEAD', cwd = process.cwd()): DiffReport {
  const range = from ? `${from}..${to}` : to;
  // Argument array, no shell — the range/refs can't be read as a command
  // (js/shell-command-constructed-from-input).
  const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();

  const prs = mergedPRs(from, to, cwd);

  const commits = git(['rev-list', '--count', range]);

  // The files the COMMITS in the range touched — deliberately not `git diff`, which with an
  // empty `from` degrades to "working tree vs HEAD" and reports whatever is uncommitted
  // right now. `git log --name-only` asks the question we actually mean, in both cases.
  const files = [
    ...new Set(
      git(['log', '--name-only', '--pretty=format:', range])
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];

  // Union the two signals. A scope is only an app id if it really names an app directory —
  // `fix(www)` must not invent an app called "www".
  const appDirs = new Set(
    git(['ls-tree', '--name-only', 'HEAD', 'extension/src/apps/'])
      .split('\n')
      .map((p) => p.replace(/\/$/, '').split('/').pop() ?? '')
      .filter(Boolean),
  );

  const apps = new Set<string>();
  for (const f of files) {
    const m = f.match(APP_PATH);
    if (m?.[1]) apps.add(m[1]);
  }
  for (const pr of prs) {
    if (pr.scope && appDirs.has(pr.scope)) apps.add(pr.scope);
  }

  const workspaces = new Set(files.map(workspaceOf).filter(Boolean));

  return {
    from,
    to,
    prs,
    commits: Number(commits) || 0,
    files,
    apps: [...apps].sort(),
    workspaces: [...workspaces].sort(),
  };
}
