// The audit gate, against what it must catch and what it must let through.
//
// Both directions matter equally here. Fail on a NEW advisory, or the gate is decoration. Pass a
// decided one, or the gate is red forever and people learn to ignore it — which is exactly the
// state it was in (#1194, #1145). And fail on a STALE entry, because an allowlist that outlives
// the advisory it describes is how the next one slips through under an old decision.
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemsFor, rootAdvisories, reportError, allowlistProblems, ALLOW } from './check-audit.mjs';

/** An `npm audit --json` shape, reduced to what this gate reads. */
const report = (...advisories) => ({
  vulnerabilities: Object.fromEntries(
    advisories.map((a, i) => [
      `pkg${i}`,
      { via: [{ name: a.name, range: a.range, severity: a.severity, title: a.title ?? 'x', url: a.url }] },
    ]),
  ),
});

const BRACE = { name: 'brace-expansion', range: '<=5.0.7', severity: 'high' };

test('a clean audit passes', () => {
  assert.deepEqual(problemsFor({ vulnerabilities: {} }, {}), []);
});

test('a new moderate-or-worse advisory fails', () => {
  const p = problemsFor(report({ name: 'left-pad', range: '<1.0.0', severity: 'high', title: 'boom' }), {});
  assert.equal(p.length, 1);
  assert.match(p[0], /NEW high advisory: left-pad@<1\.0\.0 — boom/);
});

test('low and info are below the bar', () => {
  assert.deepEqual(problemsFor(report({ name: 'x', range: '<1', severity: 'low' }), {}), []);
  assert.deepEqual(problemsFor(report({ name: 'y', range: '<1', severity: 'info' }), {}), []);
});

test('an allowlisted advisory passes', () => {
  const allow = { 'brace-expansion@<=5.0.7': { matches: 'x', reason: 'dev tooling only' } };
  assert.deepEqual(problemsFor(report({ ...BRACE, title: 'a DoS x thing' }), allow), []);
});

test('a DIFFERENT range for an allowlisted package is NOT covered', () => {
  // The whole reason the key carries the range: a new advisory for a package we already accepted
  // one for must not inherit that decision.
  const allow = { 'brace-expansion@<=5.0.7': { matches: 'a new one', reason: 'r' } };
  const p = problemsFor(report({ ...BRACE, range: '<=9.9.9', title: 'a new one' }), allow);
  assert.equal(p.length, 2, 'the new range fails, and the old entry is now stale');
  assert.ok(p.some((x) => /NEW high advisory: brace-expansion@<=9\.9\.9/.test(x)));
});

test('a stale allowlist entry fails', () => {
  const allow = { 'gone@<1.0.0': { matches: 'x', reason: 'fixed upstream ages ago' } };
  assert.match(problemsFor({ vulnerabilities: {} }, allow)[0], /STALE allowlist entry: gone@<1\.0\.0/);
});

test('many paths through one advisory collapse to one decision', () => {
  // npm reports a path per consumer — 19 lines for 2 real advisories, which is what buried these.
  const many = {
    vulnerabilities: {
      minimatch: { via: [{ name: 'brace-expansion', range: '<=5.0.7', severity: 'high', title: 'DoS' }] },
      glob: { via: ['minimatch', { name: 'brace-expansion', range: '<=5.0.7', severity: 'high', title: 'DoS' }] },
      nuxt: { via: ['nitropack'] },
    },
  };
  assert.deepEqual(
    rootAdvisories(many).map((a) => a.key),
    ['brace-expansion@<=5.0.7'],
  );
});

test('every shipped allowlist entry states a real reason', () => {
  // ALLOW is empty today (#1206 fixed both advisories rather than accepting them), so iterating
  // it proves nothing on its own — which is exactly how a rule quietly stops being a rule. The
  // shape check is therefore asserted against fixtures too, and it runs inside the guard now, so
  // a bad entry fails `make audit` rather than only this file.
  assert.deepEqual(allowlistProblems(ALLOW), [], 'the shipped allowlist must satisfy its own rule');

  const good = {
    'pkg@<1.0.0': {
      matches: 'unbounded expansion',
      reason:
        'A long, specific reason that explains the reach, why no non-breaking fix exists today, and what would change the decision. Revisit when upstream publishes a patched release.',
    },
  };
  assert.deepEqual(allowlistProblems(good), [], 'a well-formed entry is accepted');

  assert.match(allowlistProblems({ 'p@<1': { matches: 'x', reason: 'y' } }).join('\n'), /title fragment/);
  assert.match(allowlistProblems({ 'p@<1': { matches: 'unbounded', reason: 'too short' } }).join('\n'), /not a shrug/);
  assert.match(
    allowlistProblems({ 'p@<1': { matches: 'unbounded', reason: 'x'.repeat(120) } }).join('\n'),
    /reviewable again/,
    'a reason with no revisit condition is permanent by accident',
  );
});

// --- the two holes the self-review on #1197 found -----------------------------------------------
//
// Both were the same shape as every gate bug in this repo: the check found nothing and concluded
// nothing was wrong. For a security gate that is the only direction that matters.

test('an error-shaped audit is a FAILURE, never a clean audit', () => {
  // `npm audit --json` emits valid JSON with no `vulnerabilities` when it cannot reach the
  // registry. Read as a report, that is exactly "no advisories" — an audit that never ran, green.
  // This used to be masked by the stale-entry check firing on a non-empty ALLOW. ALLOW is empty
  // now (#1206), so that accident is gone and the explicit shape check is the only thing between
  // a network blip and a green security gate.
  const registryDown = { message: 'request to https://registry.npmjs.org failed', error: { summary: 'ENOTFOUND' } };
  assert.match(problemsFor(registryDown, {})[0], /reported an error.*FAILURE/s);
  assert.match(problemsFor({ metadata: {} }, {})[0], /no `vulnerabilities`.*FAILURE/s);
  assert.equal(reportError({ vulnerabilities: {} }), null, 'a genuinely clean report is fine');
});

test('two different advisories sharing one range are BOTH reported', () => {
  // Deduping by `name@range` collapsed them, so a critical could be dropped by whichever
  // low-severity entry npm emitted second and vanish below the threshold with no trace.
  const shared = {
    vulnerabilities: {
      a: { via: [{ name: 'pkg', range: '<=1.0.0', severity: 'low', title: 'a small thing', source: 1 }] },
      b: { via: [{ name: 'pkg', range: '<=1.0.0', severity: 'critical', title: 'remote code execution', source: 2 }] },
    },
  };
  assert.equal(rootAdvisories(shared).length, 2, 'both advisories must survive the dedup');
  const p = problemsFor(shared, {});
  assert.equal(p.length, 1, 'the low one is below the bar, the critical one is not');
  assert.match(p[0], /NEW critical advisory: pkg@<=1\.0\.0 — remote code execution/);
});

test('an allowlist entry does not cover a DIFFERENT advisory on the same range', () => {
  // The decision was about a denial of service. It must not silently absorb an RCE filed later
  // against the same range.
  const allow = {
    'pkg@<=1.0.0': { matches: 'denial of service', reason: 'dev-only DoS, revisit when upstream moves' },
  };
  const dos = {
    vulnerabilities: {
      a: { via: [{ name: 'pkg', range: '<=1.0.0', severity: 'high', title: 'denial of service', source: 1 }] },
    },
  };
  assert.deepEqual(problemsFor(dos, allow), [], 'the advisory it describes is accepted');

  const rce = {
    vulnerabilities: {
      a: { via: [{ name: 'pkg', range: '<=1.0.0', severity: 'critical', title: 'remote code execution', source: 2 }] },
    },
  };
  assert.match(problemsFor(rce, allow)[0], /does not describe this advisory/);
});
