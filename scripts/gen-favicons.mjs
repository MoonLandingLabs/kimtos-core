// Generate every public surface's favicon from the SINGLE SOURCE OF TRUTH: @kimtos/icons
// `brandMarkSvg`. So every surface shows the same mark and cannot drift apart. Idempotent — run by
// hand or via the build:
//
//   node scripts/gen-favicons.mjs
//   make favicons            # builds @kimtos/icons first, then writes them
//
// The SVG is written from the mark. The .ICO is hand-rasterised, not generated: this repo keeps one
// rather than take an image dependency, so `www/public` holds the only copy and the docs site
// copies it in at build time (www-docs/scripts/build-content.mjs reads it from there).
//
// A surface without the .ico does not simply lack an icon. A static host answers /favicon.ico with
// its SPA index page at HTTP 200: `Content-Type: text/html`, kilobytes of markup, to anything that
// asked for the icon by convention (#1321).
//
// (`scripts/check-favicons.mjs` holds www and the docs site to the same mark.)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MARK, expectedSvg, digestOf, ICO_MARK, recordedIcoDigest } from './check-favicons.mjs';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const show = (rel) => rel.replace(/^\.\.\//, '');

const SVG_TARGETS = ['../www/public/favicon.svg'];
/** The one hand-rasterised copy. */
const ICO_SOURCE = '../www/public/favicon.ico';

for (const rel of SVG_TARGETS) {
  writeFileSync(at(rel), expectedSvg());
  console.log(`\u2713 wrote ${show(rel)}`);
}

// Said here as well as in the check, because this is the command someone runs after changing the
// mark — and the raster is the one thing it cannot bring along.
const recorded = existsSync(at(ICO_MARK)) ? recordedIcoDigest(readFileSync(at(ICO_MARK), 'utf8')) : '';
if (recorded !== digestOf(MARK)) {
  console.log('');
  console.log(`! ${show(ICO_SOURCE)} was rasterised from a different mark than this one.`);
  console.log(`  Re-rasterise it, then record ${digestOf(MARK)} in ${show(ICO_MARK)}.`);
  console.log('  check-favicons will fail until you do.');
} else {
  console.log('favicons generated from @kimtos/icons brandMarkSvg — in sync.');
}
