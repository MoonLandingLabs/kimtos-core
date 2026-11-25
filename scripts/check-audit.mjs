// `npm audit`, with an explicit allowlist of advisories we have looked at and accepted.
//
// `make audit` was a bare `npm audit --audit-level=moderate`, which is the right instinct and the
// wrong tool for the one case that actually happens: an advisory with no non-breaking fix. When
// that lands, a bare audit goes red and STAYS red, and the only ways out are to force a breaking
// upgrade or to lower the threshold — so the job stops meaning "no new advisories" and starts
// meaning "somebody gave up". Two were open when this was written (#1194, #1145) and the Makefile
// job had been red on them, unnoticed, because `main` never finished a run (#1196). Both are fixed
// now (#1206) and ALLOW is empty — but the shape of the problem is why this script exists, so the
// reasoning stays here rather than leaving only a check with no account of what it is for.
//
// So: fail on anything NEW, at moderate or worse. Do not fail on an advisory listed below, each of
// which needs a REASON — the same convention as check-theme-subscribers.mjs
// and check-draft-guard.mjs.
//
// And fail on a STALE entry too. An allowlist that keeps entries after upstream has fixed them is
// how the next real advisory gets waved through under an old name.
//
//   node scripts/check-audit.mjs
//   npm audit --json | node scripts/check-audit.mjs   (same thing, pre-fetched)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Anything this severe or worse must be allowlisted or the build fails. */
const FAIL_AT = ['moderate', 'high', 'critical'];

/**
 * Accepted advisories, keyed `name@vulnerableRange` so a NEW advisory for the same package — a
 * different range — is not covered by an old decision.
 *
 * `matches` is not decoration: two DIFFERENT advisories can share a package and a range, and an
 * accepted decision about a denial of service must not silently cover a remote-code-execution
 * filed against the same range later. The live advisory's title has to contain it or the entry
 * does not apply.
 */
export const ALLOW = {
  // EMPTY, which is the goal state (#1206). An entry needs a REASON, and a `matches` string, and is
  // reported stale as soon as upstream fixes it. Before accepting an advisory, check whether an
  // INTERMEDIATE package has already published a patched version: `npm update <pkg>
  // --package-lock-only` re-resolves one package in a few lines, and an `overrides` floor in the
  // root package.json keeps a later resolution from walking it back.
};

/**
 * Every distinct ROOT advisory. `npm audit` reports a path per consumer, which inflates two
 * advisories into nineteen and buries what actually has to be decided.
 *
 * Deduped by the advisory's own identity — npm's numeric `source`, falling back to the title —
 * and NOT by `name@range` alone. Keying on the range collapsed two different advisories that
 * happened to share one, so a critical could be dropped by whichever low-severity entry npm
 * happened to emit second, and vanish below the threshold with no trace.
 */
export function rootAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !via.range) continue; // a string `via` is a path, not the source
      const identity = `${via.name}@${via.range}#${via.source ?? via.title ?? ''}`;
      found.set(identity, {
        key: `${via.name}@${via.range}`,
        identity,
        name: via.name,
        range: via.range,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return [...found.values()];
}

/**
 * Is this a real audit report, or something else that happens to be JSON?
 *
 * `npm audit --json` emits a valid JSON ERROR object when it cannot reach the registry —
 * `{"message":..., "error":{...}}`, with no `vulnerabilities` key at all. Read as a report that is
 * exactly "no advisories", so an audit that never ran looks like a clean one. Today the stale-entry
 * check happens to catch it, with a message that invites someone to delete an accepted risk over a
 * network blip; and the moment ALLOW is empty — which is the goal — it goes silently green.
 *
 * So the shape is checked explicitly: a real report always carries `vulnerabilities` (an object,
 * possibly empty) and `metadata`.
 */
export function reportError(report) {
  if (!report || typeof report !== 'object') return 'the audit output was not an object';
  if (report.error) return `npm audit reported an error: ${report.error.summary ?? report.message ?? 'unknown'}`;
  if (typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null)
    return 'the audit output has no `vulnerabilities` — it is not an audit report';
  return null;
}

/**
 * What is wrong, as human-readable lines. Empty means the audit is acceptable.
 *
 * @param {object} report parsed `npm audit --json`
 * @param {Record<string,{matches: string, reason: string}>} allow the accepted set (injectable for the test)
 */
export function problemsFor(report, allow = ALLOW) {
  const broken = reportError(report);
  if (broken) return [`${broken} — treating that as a FAILURE, not as a clean audit`];

  const roots = rootAdvisories(report);
  const problems = [];

  for (const a of roots) {
    if (!FAIL_AT.includes(String(a.severity).toLowerCase())) continue;
    const entry = allow[a.key];
    // The title must match, or this is a different advisory that happens to share the range.
    if (entry && (a.title ?? '').toLowerCase().includes(entry.matches.toLowerCase())) continue;
    const why = entry ? ` (allowlisted entry for ${a.key} does not describe this advisory)` : '';
    problems.push(`NEW ${a.severity} advisory: ${a.key} — ${a.title}${why}${a.url ? `\n      ${a.url}` : ''}`);
  }

  // The other direction: an entry that no longer matches anything real.
  const live = new Set(roots.map((a) => a.key));
  for (const key of Object.keys(allow)) {
    if (!live.has(key)) problems.push(`STALE allowlist entry: ${key} is no longer reported — remove it`);
  }

  return problems;
}

/**
 * Problems with the ALLOW list ITSELF — an entry that does not earn its place.
 *
 * This lived only in the test file, which was fine while ALLOW had entries and useless the moment
 * it emptied: an unenforced rule about a list nobody is adding to is not a rule. It runs in the
 * guard now, so a future entry with a shrug for a reason fails `make audit` rather than waiting
 * for someone to run the script's own tests.
 *
 * Deliberately NOT folded into `problemsFor`: that takes an injected allowlist and the tests feed
 * it deliberately minimal fixtures to exercise the matching logic. Shape and matching are two
 * different questions and mixing them would make both harder to test.
 */
export function allowlistProblems(allow = ALLOW) {
  const problems = [];
  for (const [key, entry] of Object.entries(allow)) {
    const matches = entry?.matches ?? '';
    const reason = entry?.reason ?? '';
    if (matches.length <= 3)
      problems.push(`ALLOW["${key}"]: needs a title fragment, to bind the decision to ONE advisory`);
    if (reason.length <= 80) problems.push(`ALLOW["${key}"]: an accepted advisory needs a real reason, not a shrug`);
    // A reason has to say what would change the decision, or it is permanent by accident.
    if (!/revisit/i.test(reason)) problems.push(`ALLOW["${key}"]: say what would make this reviewable again`);
  }
  return problems;
}

function main() {
  let raw = '';
  // `npm audit` exits non-zero when it finds anything, which is the whole point — capture instead.
  try {
    raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    raw = err.stdout ?? '';
  }
  if (!raw.trim()) {
    console.error('check-audit: `npm audit --json` produced nothing. Are dependencies installed?');
    process.exit(1);
  }

  const report = JSON.parse(raw);
  const problems = [...allowlistProblems(), ...problemsFor(report)];
  const roots = rootAdvisories(report);

  if (!problems.length) {
    const counts = roots.length ? ` (${roots.length} known, all accepted with a reason)` : '';
    console.log(`check-audit: no new moderate-or-worse advisory${counts}.`);
    return;
  }

  console.error('check-audit: the dependency audit needs a decision.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`
A NEW advisory means one of three things, and all three are a person's call:

  - upgrade it, if a non-breaking version exists (\`npm audit fix\`, then re-run this);
  - accept it, by adding \`name@range\` to ALLOW in this script WITH A REASON — say why it cannot
    be fixed and what would change that. Dev-only reach and "the fix is a breaking major" are
    reasons; "it is noisy" is not;
  - remove the dependency.

A STALE entry means upstream fixed it: delete the entry. Leaving it lets the next advisory for that
package slip through under a decision nobody made about it.`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
