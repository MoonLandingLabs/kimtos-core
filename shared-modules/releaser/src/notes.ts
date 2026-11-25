// Release notes, generated from the PRs merged in a version range.
//
// Ported VERBATIM from the old `scripts/gen-release-notes.mjs` — same regexes, same
// bucket order, same output, byte for byte. The only addition is a `cwd`, so the tests
// can point this at a fixture git repository instead of the real one. Resist the urge to
// "improve" any of it here: the point of the extraction was to make this testable, not to
// change what ships.
//
// Reads the MERGED PULL REQUESTS in `from..to` — not raw commits. A PR is the unit of
// change a user can understand: one title, written for review, instead of the dozens of
// internal commits behind it. Every PR lands as a merge commit whose subject is
// "Merge pull request #N from …" and whose body's first line is the PR title, so the pair
// is exact — no API call, no network.
//
// Titles are bucketed by conventional-commit type:
//
//   New       feat:      or "Add …"     (user-visible additions)
//   Improved  refactor/perf/style/…     (everything else that's kept)
//   Fixed     fix:       or "Fix …"
//
// Output is Markdown (no emoji) — this is what a release publishes, and what the
// in-extension changelog renders.
import { execFileSync } from 'node:child_process';

export interface MergedPR {
  number: string;
  title: string;
  /** Conventional-commit type, when the title has one: feat, fix, refactor … */
  type: string;
  /** Conventional-commit scope, when the title has one: the `notaboard` in `feat(notaboard):`. */
  scope: string;
  /** The merge commit. Lets a caller ask what THIS PR changed, without re-walking the log. */
  sha: string;
}

/** Lines we never surface to users. */
const NOISE: RegExp[] = [
  /^merge\b/i,
  /^bump\b/i, // dependabot: "Bump X from A to B"
  /^(chore|build|ci)(\(.*\))?!?:\s*bump\b/i,
  /(^|:\s*)release\s+v?\d/i, // "Release v0.1.2", "build: release v0.4.0"
  /prettier/i,
  /^format\b.*\bcodebase\b/i,
  /apply\s+prettier\s+formatting/i,
  /\.prettierignore/i,
];

/**
 * Strip a conventional prefix ("feat:", "fix(dock):", "refactor(css)!:") and any trailing
 * short-hash, then sentence-case.
 */
export function clean(subject: string): string {
  let s = subject.replace(/^([a-z]+)(\([^)]+\))?!?:\s+/i, '');
  // trimEnd FIRST, then a single, bounded `\s*` before the hash — the old `\s*(…)\s*$` had a
  // trailing `\s*$` that made the match polynomial-time on long whitespace (js/polynomial-redos).
  s = s.trimEnd().replace(/\s*\([0-9a-f]{7,40}\)$/, '');
  s = s.trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function categorize(subject: string): 'New' | 'Improved' | 'Fixed' {
  if (/^(feat|feature)(\(.*\))?!?:/i.test(subject) || /^add(ed)?\s/i.test(subject)) return 'New';
  if (/^fix(es|ed)?(\(.*\))?!?:/i.test(subject) || /^fix\s/i.test(subject)) return 'Fixed';
  return 'Improved';
}

/** Escape every regex metacharacter, so a string can be embedded in a `new RegExp` as a
 *  literal — not just `.`, which left `*+?()[]` etc. interpretable (js/regex-injection). */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `feat` and `notaboard` in `feat(notaboard): …`. Empty strings when absent. */
function conventional(title: string): { type: string; scope: string } {
  const m = title.match(/^([a-z]+)(?:\(([^)]+)\))?!?:/i);
  return { type: (m?.[1] ?? '').toLowerCase(), scope: (m?.[2] ?? '').toLowerCase() };
}

/** The merged PRs in `from..to`, newest first. An empty `from` means the whole history. */
export function mergedPRs(from: string, to = 'HEAD', cwd = process.cwd()): MergedPR[] {
  const range = from ? `${from}..${to}` : to;

  // Detect BOTH merge styles. GitHub "Create a merge commit" leaves a merge commit whose `%s`
  // is "Merge pull request #N …" and whose body's first line is the PR title. "Squash and
  // merge" — what this repo uses — leaves a SINGLE regular commit whose subject IS the PR
  // title with a trailing `(#N)`, and no merge commit at all. So we read every commit (`%P` =
  // parents, to tell them apart) instead of only `--merges`, or a squash-merged repo's
  // changelog comes out empty (#653). NUL-separate fields, RS-separate records.
  const records = execFileSync('git', ['log', range, '--format=%H%x00%s%x00%b%x00%P%x1e'], {
    encoding: 'utf8',
    cwd,
  })
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean);

  const prs: MergedPR[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const [sha = '', subject = '', body = '', parents = ''] = record.split('\x00');
    const isMerge = parents.trim().split(/\s+/).filter(Boolean).length > 1;

    let num: string | undefined;
    let title: string | undefined;
    if (isMerge) {
      num = subject.match(/Merge pull request #(\d+)/)?.[1];
      title = body
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean); // first non-empty line of the body = the PR title
    } else {
      // Squash-merge: subject is "type(scope): title (#N)", where GitHub appended the PR
      // number. Strip only that LAST `(#N)` — an earlier `(#123)` the author wrote is part of
      // the title and stays.
      const m = subject.match(/^(.*?)\s*\(#(\d+)\)\s*$/);
      if (m) {
        title = m[1].trim();
        num = m[2];
      }
    }

    // No PR number means a direct push or a release/merge-branch commit — not a PR.
    if (!num || !title || seen.has(num)) continue;
    seen.add(num);
    prs.push({ number: num, title, sha: sha.trim(), ...conventional(title) });
  }
  return prs;
}

/**
 * The files a single merged PR changed — its merge commit against its first parent.
 *
 * Needed to attribute a PR to an app or a deployable *individually*. The aggregate file
 * list from `diffReport` cannot do it: "some file under notaboard changed in this range"
 * says nothing about WHICH PR changed it, and using the aggregate would credit every PR in
 * the release with every unit's changes.
 */
export function prFiles(sha: string, cwd = process.cwd()): string[] {
  if (!sha) return [];
  try {
    return execFileSync('git', ['diff', '--name-only', `${sha}^1`, sha], { encoding: 'utf8', cwd })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    // A merge with no first parent (the very first commit) — nothing to diff against.
    return [];
  }
}

/**
 * Markdown release notes for `from..to`.
 *
 * An empty `from` means "no previous tag", i.e. the first release. There is nothing to
 * diff against, so every PR ever merged would qualify — hundreds of lines of internal
 * churn, which is not a changelog anyone can read. Say what it is instead.
 */
export function generateNotes(from: string, to = 'HEAD', cwd = process.cwd()): string {
  if (!from) return '### New\n- Initial release.\n';

  const subjects = mergedPRs(from, to, cwd).map((p) => p.title);

  const buckets: Record<'New' | 'Improved' | 'Fixed', string[]> = { New: [], Improved: [], Fixed: [] };
  const seen = new Set<string>();
  for (const subject of subjects) {
    if (NOISE.some((re) => re.test(subject))) continue;
    const text = clean(subject);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Deliberately no PR number in the output. These notes are published on the PUBLIC
    // repo and read by end users: a bare "#123" would auto-link to that repo's issues (the
    // wrong thing entirely), and a link to the private repo would 404 for everyone who
    // reads it. The PR title is the whole value here.
    buckets[categorize(subject)].push(text);
  }

  const out: string[] = [];
  for (const section of ['New', 'Improved', 'Fixed'] as const) {
    if (!buckets[section].length) continue;
    out.push(`### ${section}`);
    for (const item of buckets[section]) out.push(`- ${item}`);
    out.push('');
  }

  // Never publish an empty body.
  const body = out.join('\n').trim() || '### Improved\n- Maintenance and internal improvements.';
  return body + '\n';
}
