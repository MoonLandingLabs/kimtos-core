// Regenerate extension/public/voice/lexicon.txt.gz — the pronunciation dictionary Voice
// Studio's grapheme-to-phoneme frontend looks words up in.
//
//   node scripts/gen-voice-lexicon.mjs                # writes extension/public/voice/lexicon.txt.gz
//   node scripts/gen-voice-lexicon.mjs --out /tmp/l   # write somewhere else (for inspection)
//   node scripts/gen-voice-lexicon.mjs --cache <dir>  # where the download is kept
//
// WHY THIS EXISTS. Voice Studio synthesises with Kokoro-82M, which is fed IPA phonemes,
// not letters. The obvious way to get them — the `phonemizer` npm package — declares
// itself Apache-2.0 but is an Emscripten build of eSpeak-NG, which is GPL-3.0-or-later
// (#1092). We convey the extension to end users, so bundling it is a copyleft
// conflict, and the owner's decision was to replace it with a permissive path rather
// than ship it. This script builds the data half of that path.
//
// THE SOURCE AND ITS LICENCE. The CMU Pronouncing Dictionary (cmudict) is
// **BSD-2-Clause** — Copyright (C) 1993-2015 Carnegie Mellon University — which permits
// redistribution in binary form provided the copyright notice, the conditions and the
// disclaimer are reproduced "in the documentation and/or other materials provided with
// the distribution". THIRD-PARTY-NOTICES.md is that material: the notice is authored in
// scripts/model-notices.mjs and check-model-notices.mjs fails the build if it goes
// missing. Do not regenerate this file without it.
//
// WHAT IS IN THE FILE. 125k-odd words, each with ONE pronunciation (cmudict's first;
// its `word(2)` alternates are dropped — with no part-of-speech tagger we cannot choose
// between them, and picking the first is what every cmudict-based frontend does). The
// phones are ARPAbet, not IPA: the ARPAbet -> IPA mapping is a pure, unit-tested
// function in the extension (extension/src/lib/g2p/arpabet.ts) rather than baked into
// this blob, so it stays auditable and testable in source.
//
// THE ENCODING. One character per phone. `# codes<TAB>AA0 AA1 ...` in the header lists
// every phone token in code order, and the code for token N is the character
// `String.fromCharCode(0x21 + N)`. The header carries the alphabet so the file is
// self-describing — a runtime table and a generator table that had to agree by hand
// would be one more thing to drift. Gzipped, because Chrome gives us
// DecompressionStream for free and the extension already ships a .gz asset
// (public/ocr/eng.traineddata.gz).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** cmudict, pinned to an exact commit and digest. A changed upstream must be reviewed and
 *  re-pinned deliberately — this file becomes how millions of words are pronounced. */
export const SOURCE = {
  commit: '74790861f652b15e4ac49015a90074ad62a27690',
  url: 'https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict',
  file: 'cmudict.dict',
  sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
};

/** The 39 ARPAbet phones cmudict uses. Vowels carry a stress digit (0/1/2); consonants
 *  do not. Listing them here rather than deriving them means a phone cmudict adds is a
 *  loud failure, not a silently mis-decoded word. */
export const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
export const CONSONANTS = [
  'B',
  'CH',
  'D',
  'DH',
  'F',
  'G',
  'HH',
  'JH',
  'K',
  'L',
  'M',
  'N',
  'NG',
  'P',
  'R',
  'S',
  'SH',
  'T',
  'TH',
  'V',
  'W',
  'Y',
  'Z',
  'ZH',
];

/** Every phone token that can appear in an entry, in the order their codes are assigned. */
export function phoneAlphabet() {
  return [...VOWELS.flatMap((v) => [`${v}0`, `${v}1`, `${v}2`]), ...CONSONANTS];
}

/** The character a phone token is encoded as. Printable ASCII from `!` upward, so the
 *  file stays a text file and never collides with the tab that separates the columns. */
export const codeOf = (index) => String.fromCharCode(0x21 + index);

/** Words we do not ship. cmudict is a speech-recognition lexicon, so it carries tokens no
 *  reader will ever type as a word — and every entry costs bytes in the crx. Anything with
 *  a character the frontend's tokenizer cannot produce is dead weight. */
export function isShippableWord(word) {
  return /^[a-z][a-z'.-]*$/.test(word) && word.length <= 32;
}

/** Parse cmudict's `word  PH1 PH2 # comment` format into `[word, phones[]]` pairs, first
 *  pronunciation only, filtered to what we ship. Pure, so the test can drive it. */
export function parseCmudict(text) {
  const seen = new Set();
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [word, ...phones] = line.split(/\s+/);
    // `word(2)` is an alternate pronunciation of a word we already have.
    if (/\(\d+\)$/.test(word)) continue;
    if (!phones.length || seen.has(word) || !isShippableWord(word)) continue;
    seen.add(word);
    out.push([word, phones]);
  }
  return out;
}

/** The shipped file's text, header included. Throws on a phone the alphabet does not
 *  cover rather than encoding it as something else. */
export function encodeLexicon(entries, { commit } = {}) {
  const alphabet = phoneAlphabet();
  const code = new Map(alphabet.map((token, i) => [token, codeOf(i)]));
  const lines = [
    '# kimtos Voice Studio pronunciation lexicon. GENERATED by scripts/gen-voice-lexicon.mjs — do not edit.',
    '# Source: the CMU Pronouncing Dictionary, BSD-2-Clause, Copyright (C) 1993-2015 Carnegie Mellon',
    '# University. The full notice is in THIRD-PARTY-NOTICES.md, which ships with the extension.',
    `# commit\t${commit ?? 'unpinned'}`,
    `# codes\t${alphabet.join(' ')}`,
  ];
  for (const [word, phones] of entries) {
    let encoded = '';
    for (const phone of phones) {
      const c = code.get(phone);
      if (!c) throw new Error(`${word}: unknown ARPAbet phone "${phone}" — update VOWELS/CONSONANTS`);
      encoded += c;
    }
    lines.push(`${word}\t${encoded}`);
  }
  return `${lines.join('\n')}\n`;
}

// --- CLI ---------------------------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value) throw new Error(`${flag} needs a value`);
  return value;
}

/** Fetch the source once into the cache and prove it is the revision we pinned. Lands on
 *  a `.part` file so a truncated body never becomes a cache entry later runs trust. */
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
          'Upstream changed. Review the new revision, then update SOURCE in this script.',
      );
    }
    renameSync(partial, path);
  }
  return path;
}

function main() {
  const cache = arg('--cache', join(tmpdir(), 'kimtos-voice-lexicon'));
  const out = arg('--out', join(ROOT, 'extension/public/voice/lexicon.txt.gz'));
  mkdirSync(cache, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });

  const entries = parseCmudict(readFileSync(download(SOURCE, cache), 'utf8'));
  if (entries.length < 100_000) {
    throw new Error(`only ${entries.length} entries parsed — expected 100k+. Check the cmudict download.`);
  }
  const text = encodeLexicon(entries, { commit: SOURCE.commit });
  // Level 9: this is written once in a blue moon and downloaded by every user.
  const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  writeFileSync(out, gz);

  console.log(
    `gen-voice-lexicon: ${entries.length} words, ${(text.length / 1024).toFixed(0)} KB raw, ` +
      `${(gz.length / 1024).toFixed(0)} KB gzipped -> ${out}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
