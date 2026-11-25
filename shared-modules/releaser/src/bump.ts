// Propose a version bump for every app and deployable a release touched.
//
// This is the piece that makes the whole thing hold. The old mechanism was "remember to
// bump the version in meta.ts" — and it failed 19 times out of 19, for months, while the
// App Store showed users a number that was never true.
//
// So nobody has to remember. `diffReport` already knows which units a release touched (by
// commit scope AND by file path); this turns that into a proposed version, and the release
// asks a human to confirm. A major bump stays a human decision: a commit type cannot be
// trusted to declare a breaking change.
import { diffReport } from './report.js';
import { prFiles } from './notes.js';
import { units, unitVersion, proposeBump, type Unit } from './units.js';

export interface UnitBump {
  unit: Unit;
  from: string;
  to: string;
  /** The PR titles attributed to this unit — the notes for its changelog entry. */
  changes: string[];
}

/**
 * What each touched unit should become, and why.
 *
 * A unit is "touched" when `diffReport` attributed a merged PR to it — either the
 * conventional-commit scope named it (`feat(notaboard):`) or a file under its directory
 * changed. Units nobody touched are not proposed, and so do not get a spurious bump.
 */
export function proposeBumps(from: string, to = 'HEAD', root = process.cwd()): UnitBump[] {
  const report = diffReport(from, to, root);
  const all = units(root);
  const out: UnitBump[] = [];

  const touched = new Set<string>([...report.apps, ...report.workspaces]);

  // Each PR's OWN files, resolved once. Attribution has to be per-PR: the aggregate file
  // list says "something under notaboard changed in this range", which would credit every
  // PR in the release with notaboard's changes.
  const filesByPR = new Map(report.prs.map((pr) => [pr.number, prFiles(pr.sha, root)]));

  for (const unit of all) {
    if (!touched.has(unit.id)) continue;

    const prefix = unit.kind === 'app' ? `extension/src/apps/${unit.id}/` : `${unit.id}/`;

    // A PR belongs to this unit if it NAMED it (conventional scope) or CHANGED it (its own
    // files). Either signal alone lies — a PR scoped `fix(ui)` can still rewrite notaboard,
    // and a docs-only PR scoped to an app touches none of its files.
    const prs = report.prs.filter(
      (pr) => pr.scope === unit.id || (filesByPR.get(pr.number) ?? []).some((f) => f.startsWith(prefix)),
    );
    if (!prs.length) continue;

    const current = unitVersion(unit.dir);
    out.push({
      unit,
      from: current,
      to: proposeBump(
        current,
        prs.map((p) => p.type),
      ),
      changes: prs.map((p) => p.title),
    });
  }
  return out;
}
