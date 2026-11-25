// The public surfaces serve ONE mark, and a build fails when they stop.
//
// www and docs are both the brand at its smallest and most-seen: a search result, a
// tab strip, a bookmark bar. `@kimtos/icons` exists so every one of them renders the same
// `brandMarkSvg`, and the `use-icons` skill says never to hardcode a mark or a favicon. That rule
// was prose, and prose is what let the status page sit outside it: it percent-encoded `#`, so its
// gradient reference resolved to nothing and its favicon rendered unfilled, for as long as nobody
// looked (#1321, fixed in #1322).
//
// This is the check that would have caught it, over every surface at once:
//
//   node scripts/check-favicons.mjs
//
// IT IS RUN BY THE TEST SUITE, NOT BY THE CONVENTIONS JOB, and that is not a preference. It
// imports `@kimtos/icons` below — it has to, since the whole point is comparing against the one
// mark — and the Conventions job runs with no `npm ci` by design, so every checker there must
// need no dependencies. A step added there fails on a clean checkout with a module-resolution
// error, which is a red build for a reason that has nothing to do with favicons.
//
// This has now been got wrong twice: the guard was added to that job in the first commit of
// #1322 and removed again in the next one (fc1da73a), whose message says exactly this. So the
// real-tree assertions live in check-favicons.test.mjs, which runs under the root `npm test`
// where `npm ci` has already built the shared packages, and `scripts/conventionsJob.test.mjs`
// now fails if any Conventions checker grows an import at all.
//
// WHAT EACH SURFACE CAN BE HELD TO differs, and pretending otherwise is how a guard ends up
// asserting nothing:
//
//   www            a committed favicon.svg, regenerable — compared to the mark byte for byte.
//   www            a committed favicon.ico, hand-rasterised — see the digest note below.
//   docs           commits no favicon at all; it copies www's at build time, so what is checked is
//                  that the COPY STEP and the head declaration are both still there.
//
// THE .ICO IS THE ONE THING THIS CANNOT REGENERATE. Comparing a raster to an SVG needs a renderer,
// and this repo keeps one hand-made file on purpose rather than taking an image dependency. So the
// digest of the mark it was rasterised FROM is committed beside it, the way a lockfile records
// digests for assets the build cannot rebuild. Change the mark and this check fails with "re-
// rasterise", which is still a human step — but no longer an invisible one, and being invisible is
// the entire defect being fixed.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { brandMarkSvg } from '@kimtos/icons';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/** The mark every surface must be showing. 64px is what a favicon is generated at. */
export const MARK = brandMarkSvg(64);

/** What a committed favicon.svg must contain — the mark, with the trailing newline a text file in
 *  this repo ends with (`gen-favicons.mjs` writes it, prettier would add it). */
export const expectedSvg = () => `${MARK}\n`;

export const digestOf = (text) => createHash('sha256').update(text).digest('hex');

/** Surfaces that commit their own favicon files, and the config that has to point at them. */
export const FILE_SURFACES = [
  {
    name: 'www',
    svg: '../www/public/favicon.svg',
    ico: '../www/public/favicon.ico',
    config: '../www/nuxt.config.ts',
  },
];

/** Where the raster's provenance is recorded. NOT under a `public/` directory: anything in there is
 *  served, and a stray digest file served as /favicon.ico.mark would be a new public URL. */
export const ICO_MARK = '../scripts/favicon-ico.mark';

/** The digest recorded beside the raster, ignoring comments and blank lines. */
export function recordedIcoDigest(text) {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) ?? ''
  );
}

/**
 * Every way the surfaces can have drifted, as a list of problems. Empty means they agree.
 *
 * Pure: it takes the file reader so the test can hand it a tree that has drifted, rather than
 * needing the repo to be broken to prove the check works.
 */
export function problems({ read, exists }) {
  const out = [];
  const svg = expectedSvg();
  const icos = [];

  for (const surface of FILE_SURFACES) {
    if (!exists(surface.svg)) {
      out.push(`${surface.name}: favicon.svg is missing — run \`make favicons\`.`);
    } else if (read(surface.svg) !== svg) {
      out.push(
        `${surface.name}: favicon.svg is not the current brand mark. Run \`make favicons\`.\n` +
          `      It is generated from @kimtos/icons, so an edited or stale file is drift, not a choice.`,
      );
    }
    if (!exists(surface.ico)) {
      out.push(
        `${surface.name}: favicon.ico is missing. Run \`make favicons\`, which copies it.\n` +
          `      A surface without one does not simply lack an icon: a static host answers /favicon.ico\n` +
          `      with its SPA index page at HTTP 200, which is what a deployed admin app once served (#1321).`,
      );
    } else {
      icos.push([surface.name, read(surface.ico)]);
    }

    // A file nothing points at is half a fix. Admin HAD the mark as an SVG and declared only that,
    // which is why its .ico being absent went unnoticed — nothing in the repo referred to it.
    if (!exists(surface.config)) {
      out.push(`${surface.name}: ${surface.config.replace('../', '')} is missing — this check cannot read its head.`);
    } else {
      const config = read(surface.config);
      for (const file of ['/favicon.svg', '/favicon.ico']) {
        // An `href`, not a mention. A plain substring search is satisfied by the file's name in a
        // COMMENT — including the comment this check's own fix added — so it would pass a surface
        // that only talks about the icon it never declares.
        if (!new RegExp(`href:\\s*['"]${file}['"]`).test(config)) {
          out.push(`${surface.name}: its head does not declare ${file}, so the file it ships is never asked for.`);
        }
      }
    }
  }

  if (icos.length > 1) {
    const [first, ...rest] = icos;
    for (const [name, bytes] of rest) {
      if (bytes !== first[1]) out.push(`${name}: favicon.ico differs from ${first[0]}'s — one mark, one raster.`);
    }
  }

  // The raster's provenance (see the header).
  if (!exists(ICO_MARK)) {
    out.push(`the recorded mark digest for favicon.ico is missing (${ICO_MARK.replace('../', '')}).`);
  } else {
    const recorded = recordedIcoDigest(read(ICO_MARK));
    const current = digestOf(MARK);
    if (recorded !== current) {
      out.push(
        `favicon.ico was rasterised from a different mark than the one in @kimtos/icons.\n` +
          `      recorded ${recorded || '(none)'}\n` +
          `      current  ${current}\n` +
          `      The .ico cannot be regenerated here — re-rasterise it from the new mark, then record\n` +
          `      the digest above in ${ICO_MARK.replace('../', '')}.`,
      );
    }
  }

  return out;
}

/** The docs site commits no favicon: it relies on a copy step and a head declaration. Both are
 *  mechanisms rather than assets, so both are asserted as text. */
export function docsProblems({ read }) {
  const out = [];
  const build = read('../www-docs/scripts/build-content.mjs');
  // The copy statement must name BOTH files, in whichever order — asserting a fixed order would
  // fail a harmless reordering, and a guard that cries at a no-op teaches people to route around it.
  const copies = /for \(const f of \[([^\]]*favicon[^\]]*)\]/.exec(build.replace(/\s+/g, ' '));
  const copied = copies ? copies[1] : '';
  if (!copied.includes('favicon.svg') || !copied.includes('favicon.ico')) {
    out.push(
      `www-docs: its build no longer copies BOTH favicon.svg and favicon.ico from www/public.\n` +
        `      Docs commits neither, so that copy is the only thing making its mark the shared one.`,
    );
  }
  const config = read('../www-docs/.vitepress/config.mts');
  if (!/rel: 'icon'/.test(config) || !/favicon\.svg/.test(config)) {
    out.push(`www-docs: its VitePress head no longer declares the favicon.svg as its icon.`);
  }
  return out;
}

export async function check() {
  const read = (rel) => readFileSync(at(rel), 'utf8');
  const exists = (rel) => existsSync(at(rel));
  const found = [...problems({ read, exists }), ...docsProblems({ read })];

  if (found.length) {
    console.error('check-favicons: the public surfaces do not all serve the same brand mark.\n');
    for (const problem of found) console.error(`  ${problem}\n`);
    console.error('See the use-icons skill, and #1321.');
    process.exit(1);
  }
  console.log(`check-favicons: ${FILE_SURFACES.length + 1} public surfaces (www, docs) all serve the shared mark.`);
}

// Only when run directly, so the test can import the pure halves without tripping the check.
if (process.argv[1] === fileURLToPath(import.meta.url)) await check();
