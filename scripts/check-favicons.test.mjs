// The favicon check, held to catching each way the surfaces drift.
//
// A guard whose subject is currently correct prints a reassuring line whatever it is doing, so the
// only way to know it works is to hand it a tree that HAS drifted. `problems()` and `docsProblems()`
// take their reader for exactly that: the repo stays intact while each failure is fed in.
//
// The cases are the ones that really happened, not invented ones: a stale .svg (nothing runs
// `make favicons`, it is a manual target), a missing .ico (admin had none, so its host served an
// HTML page for it), and a mark that moved on without the raster being re-cut (#1321).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MARK,
  expectedSvg,
  digestOf,
  ICO_MARK,
  recordedIcoDigest,
  problems,
  docsProblems,
  FILE_SURFACES,
} from './check-favicons.mjs';

/** A tree that agrees with itself: every surface has the current mark, the same raster, and a head
 *  that points at both. */
function goodTree() {
  const files = new Map([[ICO_MARK, `# comment\n${digestOf(MARK)}\n`]]);
  for (const s of FILE_SURFACES) {
    files.set(s.svg, expectedSvg());
    files.set(s.ico, 'ICO-BYTES');
    files.set(s.config, "link: [{ href: '/favicon.ico' }, { href: '/favicon.svg' }]");
  }
  return files;
}

const reader = (files) => ({
  read: (rel) => {
    if (!files.has(rel)) throw new Error(`unexpected read of ${rel}`);
    return files.get(rel);
  },
  exists: (rel) => files.has(rel),
});

describe('check-favicons: the file surfaces', () => {
  test('a tree that agrees has no problems', () => {
    assert.deepEqual(problems(reader(goodTree())), []);
  });

  test('a stale favicon.svg is caught — `make favicons` is manual, so this is the only thing asserting it', () => {
    const files = goodTree();
    files.set('../www/public/favicon.svg', expectedSvg().replace('viewBox', 'viewbox'));
    const found = problems(reader(files));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /^www: favicon\.svg is not the current brand mark/);
  });

  test('a missing favicon.ico is caught, and says what a host does without one', () => {
    const files = goodTree();
    files.delete('../www/public/favicon.ico');
    const found = problems(reader(files));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /favicon\.ico is missing/);
    assert.match(found[0], /HTTP 200/, 'the message has to say why an absent icon is worse than no icon');
  });

  test('a mark that moved on without the raster being re-cut is caught', () => {
    // The drift the .ico is uniquely exposed to: the SVGs regenerate, the raster cannot, and
    // nothing before this noticed.
    const files = goodTree();
    files.set(ICO_MARK, `# comment\n${'0'.repeat(64)}\n`);
    const found = problems(reader(files));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /rasterised from a different mark/);
    assert.match(found[0], new RegExp(digestOf(MARK)), 'and prints the digest to record, so the fix is mechanical');
  });

  test('a missing digest file is caught rather than treated as agreement', () => {
    const files = goodTree();
    files.delete(ICO_MARK);
    assert.match(problems(reader(files)).join('\n'), /recorded mark digest .* is missing/);
  });

  test('a surface that ships a file its head never declares is caught', () => {
    // The state admin was actually in: the mark was there as an SVG and declared, so nobody noticed
    // the .ico was neither present nor referred to.
    const files = goodTree();
    files.set('../www/nuxt.config.ts', "link: [{ href: '/favicon.svg' }]");
    const found = problems(reader(files));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /does not declare \/favicon\.ico/);
  });

  test('a config that only MENTIONS the file in a comment does not count as declaring it', () => {
    // Found by running the check against admin as it really was: a plain substring search passed,
    // because the comment explaining the .ico contains its name. The comment this very fix added
    // would have been enough to satisfy it.
    const files = goodTree();
    files.set(
      '../www/nuxt.config.ts',
      "// the .ico is for what asks for /favicon.ico by convention\nlink: [{ href: '/favicon.svg' }]",
    );
    assert.match(problems(reader(files)).join('\n'), /does not declare \/favicon\.ico/);
  });

  test('the recorded digest ignores comments and blank lines', () => {
    assert.equal(recordedIcoDigest('# note\n\n  abc123  \n'), 'abc123');
  });
});

describe('check-favicons: the docs site, which commits no favicon of its own', () => {
  const real = {
    build: readFileSync(fileURLToPath(new URL('../www-docs/scripts/build-content.mjs', import.meta.url)), 'utf8'),
    config: readFileSync(fileURLToPath(new URL('../www-docs/.vitepress/config.mts', import.meta.url)), 'utf8'),
  };
  const docsReader = (build, config) => ({
    read: (rel) => (rel.includes('build-content') ? build : config),
  });

  test('the real docs site passes', () => {
    assert.deepEqual(docsProblems(docsReader(real.build, real.config)), []);
  });

  test('a build that has dropped the .ico from the copy is caught', () => {
    // Docs commits neither file, so the copy step IS its guarantee. Losing half of it would leave
    // its /favicon.ico answered by the SPA fallback, the way admin's was.
    const build = real.build.replace("['favicon.svg', 'favicon.ico']", "['favicon.svg']");
    assert.match(docsProblems(docsReader(build, real.config)).join('\n'), /no longer copies BOTH/);
  });

  test('a head that no longer declares the icon is caught', () => {
    const config = real.config.replace(/rel: 'icon'/g, "rel: 'shortcut'");
    assert.match(docsProblems(docsReader(real.build, config)).join('\n'), /no longer declares the favicon/);
  });
});

describe('check-favicons: the real tree', () => {
  // THE ASSERTION THAT ACTUALLY PROTECTS THE SURFACES. Everything above proves the guard can
  // detect drift; this is what runs it against what is committed. It lives here rather than in a
  // workflow step because the module imports `@kimtos/icons` — see the note at the top of
  // check-favicons.mjs, and fc1da73a, which removed exactly that step for exactly that reason.
  const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

  test('every committed surface serves the current brand mark', () => {
    const found = problems({ read: (rel) => readFileSync(at(rel), 'utf8'), exists: (rel) => existsSync(at(rel)) });
    assert.deepEqual(found, [], found.join('\n'));
  });
});

describe('check-favicons: the docs copy step, order-independent', () => {
  const build = readFileSync(fileURLToPath(new URL('../www-docs/scripts/build-content.mjs', import.meta.url)), 'utf8');
  const config = readFileSync(fileURLToPath(new URL('../www-docs/.vitepress/config.mts', import.meta.url)), 'utf8');

  test('swapping the two filenames is not a failure', () => {
    // Both are copied either way. A guard that failed on this would be crying at a no-op, which
    // teaches people to route around it rather than use it.
    const swapped = build.replace("['favicon.svg', 'favicon.ico']", "['favicon.ico', 'favicon.svg']");
    assert.deepEqual(docsProblems({ read: (rel) => (rel.includes('build-content') ? swapped : config) }), []);
  });
});
