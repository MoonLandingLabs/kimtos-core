// Fails the build when a model weight or language pack we ship/download is NOT attributed in
// THIRD-PARTY-NOTICES.md.
//
//   node scripts/check-model-notices.mjs
//
// The on-device models are not npm packages, so the bundler scan in gen-third-party-notices.mjs
// cannot see them — their attribution list (scripts/model-notices.mjs) is maintained by hand, and
// a hand-maintained list with nothing asserting it stays complete is this repo's recurring failure
// mode. It shipped exactly that way: the notices omitted whisper-base, flan-t5-small, TinyLlama,
// SmolLM2-1.7B and the Tesseract OCR trained data, and the generator's list had even fallen out of
// sync with the committed file (#669). This is the drift-assert that closes it, mirroring the other
// convention checks (check-network-hosts, check-generated). It is dependency-free
// (no npm ci — it runs in the `conventions` CI job): it reads the committed manifests, the committed
// notices, and the extension source as TEXT — it never imports or builds any of them.
//
// It proves three things:
//   1. Every asset we distribute — every Hugging Face model repo named in the extension source,
//      plus the Tesseract language packs — is attributed by an entry in scripts/model-notices.mjs
//      (and no attribution points at an asset we no longer ship).
//   2. The generator's list and the committed THIRD-PARTY-NOTICES.md agree — so an edit to
//      model-notices.mjs that was never regenerated (or a hand-edit of the notices) is a red check,
//      not a silent gap.
//
// The models are no longer mirrored behind a CDN (the project runs no infrastructure), so there is
// no manifest to reconcile: the extension source IS the list of what we ship, read as text.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './model-notices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = 'extension/src';

/** The Hugging Face orgs the extension loads models from. A model id in the source is always
 *  `<org>/<repo>`, and matching these prefixes finds them all. */
const ORGS = ['Xenova', 'onnx-community', 'HuggingFaceTB', 'kimtos-labs'];

/** The set of assets we distribute, keyed the same way model-notices.mjs's `assets` are: every
 *  `<org>/<repo>` model id in the source, plus the single key 'tesseract-langs' (every language
 *  pack, one notice). Pure, so the test can drive it with fixtures. */
export function shippedAssetKeys({ sourceIds }) {
  return new Set([...sourceIds, 'tesseract-langs']);
}

/** Every `<org>/<repo>` model id referenced by the extension's shipped source, given the
 *  source files' contents. Comments are stripped first: a comment naming a model (or the
 *  `kimtos-labs/*` glob) is documentation, not something we fetch, and counting it would make
 *  this cry wolf — which is how checks get disabled. Only a complete quoted string literal
 *  counts, which is how every real model id is written.
 *
 *  Pure over the texts so the test can drive it with fixtures. */
export function sourceModelIds(texts) {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const ids = new Set();
  const re = new RegExp(`['"\`]((?:${ORGS.join('|')})/[A-Za-z0-9][A-Za-z0-9._-]*)['"\`]`, 'g');
  for (const text of texts) for (const m of strip(text).matchAll(re)) ids.add(m[1]);
  return ids;
}

/** The model names attributed in the "# On-device models" section of the notices — the bold
 *  bullets `- **<name>** — ...`. Bounded to the bullet block (the heading up to the first `## `
 *  detail heading) so a `- **x** —` line inside a later package's license text can't be mistaken
 *  for a model name. */
export function noticeModelNames(noticesText) {
  const start = noticesText.indexOf('# On-device models');
  if (start === -1) return new Set();
  const rest = noticesText.indexOf('\n## ', start);
  const section = noticesText.slice(start, rest === -1 ? undefined : rest);
  return new Set([...section.matchAll(/^- \*\*(.+?)\*\* —/gm)].map((m) => m[1]));
}

/** Every way the shipped set, the attribution list and the committed notices can disagree,
 *  as human-readable error lines. Empty means everything is in sync. */
export function driftErrors({ shipped, models, noticesText }) {
  const attributed = new Set();
  for (const m of models) for (const a of m.assets ?? []) attributed.add(a);
  const listNames = new Set(models.map((m) => m.name));
  const noticeNames = noticeModelNames(noticesText);
  const errors = [];

  // 1a. Every shipped asset must be attributed.
  for (const asset of shipped) {
    if (!attributed.has(asset)) {
      errors.push(
        `  ${asset}\n    is loaded by the extension but no entry in scripts/model-notices.mjs attributes it.`,
      );
    }
  }
  // 1b. Every attribution must point at something we still ship (catches a stale entry).
  for (const asset of attributed) {
    if (!shipped.has(asset)) {
      errors.push(
        `  ${asset}\n    is attributed in scripts/model-notices.mjs but the extension no longer loads it — remove the stale attribution.`,
      );
    }
  }
  // 2. The generator's list and the committed notices must agree, both ways.
  for (const name of listNames) {
    if (!noticeNames.has(name)) {
      errors.push(
        `  "${name}"\n    is in scripts/model-notices.mjs but not in THIRD-PARTY-NOTICES.md — regenerate: node scripts/gen-third-party-notices.mjs`,
      );
    }
  }
  for (const name of noticeNames) {
    if (!listNames.has(name)) {
      errors.push(
        `  "${name}"\n    is in THIRD-PARTY-NOTICES.md but not in scripts/model-notices.mjs — the notices were hand-edited; regenerate instead.`,
      );
    }
  }
  return errors;
}

/** The contents of every shipped `.ts`/`.js` file under extension/src. Test files and the DOM
 *  test harness are excluded: a fixture id is not something we serve. Same walk as
 *  check-network-hosts. Exported so the test can assert against the REAL source tree. */
export function extensionSourceTexts(dir = join(ROOT, SRC), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test') extensionSourceTexts(p, out);
    } else if (/\.(ts|js)$/.test(p) && !/\.test\.(ts|js)$/.test(p)) {
      out.push(readFileSync(p, 'utf8'));
    }
  }
  return out;
}

// Only when run as a CLI — importing this file (the test does) must not process.exit.
function main() {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const sourceIds = sourceModelIds(extensionSourceTexts());
  const shipped = shippedAssetKeys({ sourceIds });
  // Tripwire: the source scan is a regex over text, so a change in how model ids are written
  // (or a moved source tree) could make it match nothing — and a check that finds zero model ids
  // is back to the blind spot it was written to close, quietly. The extension always ships
  // several, so an empty result means the scan broke, not that there are none.
  if (sourceIds.size === 0) {
    console.error(
      `check-model-notices: found no model ids in ${SRC}. The source scan has gone blind ` +
        `to models referenced only in code (#1096). Fix the scan.`,
    );
    process.exit(1);
  }
  const errors = driftErrors({ shipped, models: MODELS, noticesText: read('THIRD-PARTY-NOTICES.md') });

  if (errors.length) {
    console.error('check-model-notices: shipped models and their attribution are out of sync.\n');
    console.error(errors.join('\n'));
    console.error(
      '\nEvery model weight or language pack we distribute must be attributed in ' +
        'scripts/model-notices.mjs and regenerated into THIRD-PARTY-NOTICES.md ' +
        '(node scripts/gen-third-party-notices.mjs). MIT and Apache-2.0 both require the notice to ' +
        'travel with what we distribute.',
    );
    process.exit(1);
  }

  console.log(
    `check-model-notices: ${shipped.size} shipped assets, all attributed by ${MODELS.length} entries; ` +
      `notices in sync.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
