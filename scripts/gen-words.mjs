// Regenerate extension/public/words.txt — the 60k-word dictionary Grammit's speller
// treats as the definition of a real word.
//
//   node scripts/gen-words.mjs                 # writes extension/public/words.txt
//   node scripts/gen-words.mjs --out /tmp/w    # write somewhere else (for inspection)
//   node scripts/gen-words.mjs --cache <dir>   # where the two downloads are kept
//
// WHY THIS SCRIPT EXISTS. The list used to be derived by an awk one-liner that lived
// only in a commit message, so nobody could re-derive it — and what it derived was
// wrong. It intersected Norvig's `count_1w.txt` (word COUNTS from a web crawl, where
// frequent misspellings rank high) with dwyl/english-words `words_alpha.txt`, which is
// itself a permissive scrape rather than a curated dictionary. Misspellings present in
// both survived the intersection: `langauge`, `accomodate`, `enviroment`, `untill` and
// `wich` all shipped as dictionary words, so the speller could never flag them — and,
// being "real words", they were offered as corrections for a near miss (`langauges` was
// corrected to `langauge`). See #961.
//
// WHAT IT DOES INSTEAD. Membership comes from a CURATED dictionary and nothing else;
// Norvig's counts are kept only to ORDER the result, which is what the speller needs
// them for (suggestions are ranked by frequency, and the file's line order IS the rank).
//
//   words.txt = the first 60,000 words of Norvig's frequency order
//               that SCOWL also contains
//
// SCOWL (Spell Checker Oriented Word Lists, http://wordlist.aspell.net/) is the curated
// source behind hunspell's en_US, Aspell and every dictionary derived from them. Its
// `final/` directory is a matrix of <dialect>-<category>.<size> files; we take:
//
//   - every dialect (english, american, british, canadian, australian) plus their
//     `variant_1` files — "acceptable variants", so a British speller does not flag
//     `colour` and an American one does not flag `color`. `variant_2` (seldom used) and
//     `variant_3` (questionable) are excluded: that is where archaic spellings live, and
//     an archaic spelling is indistinguishable from a typo to a user.
//   - every category — `words`, `proper-names`, `upper`, `abbreviations`, `contractions`.
//     Proper names matter because the speller checks a capitalized word at a sentence
//     start by lowercasing it, so dropping them would flag "January" and "America".
//   - sizes 10 through 70 only. SCOWL's 80 and 95 lists are explicitly the ones that
//     "contain many words that are not in most dictionaries"; measured against them,
//     `wich`, `teh` and `thier` come back — the exact defect this script exists to stop.
//
// The result is verified against extension/src/lib/data/known-misspellings.txt before it
// is written, and asserted again on every CI run by
// extension/src/lib/spellcheck.dictionary.test.ts — the script runs once in a blue moon,
// the test runs on every PR, so the test is the guard that actually holds.
//
// LICENCE. SCOWL is Copyright 2000-2016 Kevin Atkinson, under a permissive notice that
// allows redistribution of "the output created from the scripts" provided the copyright
// notice travels with it. That notice is in THIRD-PARTY-NOTICES.md (scripts/model-notices.mjs
// is where it is authored) — do not ship a regenerated list without it.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** How many words the shipped list holds. The speller's cost is linear in this. */
export const LIMIT = 60000;

/** The largest SCOWL size we trust. 80 and 95 reintroduce misspellings — see the header. */
export const MAX_SIZE = 70;

/** The two upstream sources, pinned by digest. A changed upstream must be reviewed and
 *  re-pinned deliberately: silently absorbing a new revision of either is how the last
 *  list acquired its misspellings. */
export const SOURCES = {
  scowl: {
    url: 'https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz',
    file: 'scowl-2020.12.07.tar.gz',
    sha256: '5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc',
  },
  counts: {
    url: 'https://norvig.com/ngrams/count_1w.txt',
    file: 'count_1w.txt',
    sha256: '51df159fd3de12b20e403c108f526e96dbd723d9cabdd5f17955cdc16059e690',
  },
};

/** Does `name` (a bare filename from SCOWL's `final/`) belong in the curated set?
 *  `<dialect>-<category>.<size>`, e.g. `british_variant_1-words.55`. The variant suffix is
 *  anchored on `^` as well as `_` because the dialect-neutral variants are named bare —
 *  `variant_2-words.50`, not `english_variant_2-words.50`. */
export function isCuratedFile(name) {
  const match = /^([a-z_0-9]+)-([a-z-]+)\.(\d+)$/.exec(name);
  if (!match) return false;
  const [, dialect, , size] = match;
  if (/(^|_)variant_[23]$/.test(dialect)) return false;
  return Number(size) <= MAX_SIZE;
}

/** An accented word with its diacritics dropped — `café` to `cafe`. SCOWL spells such a
 *  word only in its accented form, but the shipped list is ASCII by construction (the
 *  speller only ever looks up `[a-z]+`, and skips any token carrying a non-ASCII letter
 *  whole — #642). Without this, `cafe`, `resume` and `naive` are absent from the
 *  dictionary and the speller "corrects" them. */
export const asciiFold = (word) => word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** The curated word set from SCOWL's `final/` directory.
 *  The carriage return is stripped rather than assumed absent: the list this one replaces
 *  came from a CRLF source, and a `\r` welded to every entry is a whole dictionary that
 *  silently matches nothing.
 *  @param {Iterable<[string, string]>} files [filename, contents] pairs. */
export function curatedSet(files) {
  const curated = new Set();
  for (const [name, text] of files) {
    if (!isCuratedFile(name)) continue;
    for (const line of text.split('\n')) {
      const word = line.replace(/\r$/, '');
      if (!word) continue;
      curated.add(word);
      const folded = asciiFold(word);
      if (folded !== word) curated.add(folded);
    }
  }
  return curated;
}

/** Is `word` (always lowercase here) a curated word? SCOWL stores proper names and
 *  initialisms in their natural case, so a lowercase token also counts as known when its
 *  capitalized or upper-cased form is — the speller lowercases before it looks up. */
export const isCurated = (curated, word) =>
  curated.has(word) || curated.has(word[0].toUpperCase() + word.slice(1)) || curated.has(word.toUpperCase());

/** Norvig's `count_1w.txt` (`word<TAB>count`, most frequent first) as the plain a-z words
 *  in that order. Everything else — digits, hyphens, accents — the speller cannot use:
 *  it only ever looks up `[a-z]+`. */
export function rankedWords(countsText) {
  const out = [];
  for (const line of countsText.split('\n')) {
    const word = line.split('\t')[0];
    if (word && /^[a-z]+$/.test(word)) out.push(word);
  }
  return out;
}

/** The shipped list: the first `limit` frequency-ordered words SCOWL also has. */
export function pickWords(ranked, curated, limit = LIMIT) {
  const out = [];
  const seen = new Set();
  for (const word of ranked) {
    if (seen.has(word) || !isCurated(curated, word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length === limit) break;
  }
  return out;
}

/** The committed fixture of words that are only ever a misspelling. One per line;
 *  `#` comments and blank lines ignored. Shared with the CI test so there is one list. */
export function parseFixture(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

// --- CLI ---------------------------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value) throw new Error(`${flag} needs a value`);
  return value;
}

/** Fetch `url` into the cache once, and prove it is the revision we pinned.
 *  The download lands on a `.part` file and is only renamed into place once the digest
 *  matches: a truncated or redirected body must not become a cache entry that every later
 *  run then trusts (or, worse, re-fails against forever without saying why). */
function download({ url, file, sha256 }, cache) {
  const path = join(cache, file);
  if (!existsSync(path)) {
    console.log(`  fetching ${url}`);
    const partial = `${path}.part`;
    execFileSync('curl', ['-sSL', '--fail', '--max-time', '600', '-o', partial, url], { stdio: 'inherit' });
    const digest = createHash('sha256').update(readFileSync(partial)).digest('hex');
    if (digest !== sha256) {
      rmSync(partial, { force: true });
      throw new Error(
        `${file}: sha256 ${digest} does not match the pinned ${sha256}.\n` +
          'Upstream changed. Review the new revision, then update SOURCES in this script.',
      );
    }
    renameSync(partial, path);
  }
  return path;
}

function main() {
  const cache = arg('--cache', join(tmpdir(), 'kimtos-words'));
  const out = arg('--out', join(ROOT, 'extension/public/words.txt'));
  mkdirSync(cache, { recursive: true });

  const scowlArchive = download(SOURCES.scowl, cache);
  const countsPath = download(SOURCES.counts, cache);

  execFileSync('tar', ['xzf', scowlArchive, '-C', cache], { stdio: 'inherit' });
  const finalDir = join(cache, SOURCES.scowl.file.replace(/\.tar\.gz$/, ''), 'final');

  // SCOWL's final/ files are Latin-1. Decoding them as UTF-8 replaces every high byte with
  // U+FFFD, which would silently merge `café` and `cafá` into one entry and defeat the
  // ASCII fold — the words that need the fold are exactly the ones that decode wrong.
  const curated = curatedSet(readdirSync(finalDir).map((name) => [name, readFileSync(join(finalDir, name), 'latin1')]));
  const ranked = rankedWords(readFileSync(countsPath, 'utf8'));
  const words = pickWords(ranked, curated);
  const chosen = new Set(words);

  if (words.length < LIMIT) {
    throw new Error(`only ${words.length} curated words available — expected ${LIMIT}. Check the SCOWL extraction.`);
  }

  const fixture = parseFixture(readFileSync(join(ROOT, 'extension/src/lib/data/known-misspellings.txt'), 'utf8'));
  const leaked = fixture.filter((word) => chosen.has(word));
  if (leaked.length) {
    throw new Error(
      `refusing to write: ${leaked.length} known misspelling(s) are in the result — ${leaked.join(', ')}.\n` +
        'A curated source that contains these is not curated enough; do not relax the filter.',
    );
  }

  const previous = existsSync(out) ? new Set(readFileSync(out, 'utf8').split('\n').filter(Boolean)) : new Set();
  writeFileSync(out, `${words.join('\n')}\n`);

  console.log(`gen-words: ${curated.size} curated SCOWL entries, ${ranked.length} ranked candidates`);
  console.log(`gen-words: wrote ${words.length} words to ${out}`);
  if (previous.size) {
    const added = words.filter((word) => !previous.has(word)).length;
    const removed = [...previous].filter((word) => !chosen.has(word)).length;
    console.log(`gen-words: ${added} added, ${removed} removed against the previous list`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
