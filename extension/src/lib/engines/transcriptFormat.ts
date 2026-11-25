// Rebuild readable paragraphs from Whisper's timestamped chunks (#957), and strip the
// decoder's runaway repetition before anyone reads it (#710).
//
// The pipeline's joined `text` is one unsegmented string — transcribe anything longer
// than a sentence or two and the card (and the downloaded .txt) is a single endless
// line. The only place sentence boundaries exist is the per-segment `chunks` that come
// back with `return_timestamps: true`: each chunk is roughly one spoken segment, and
// the GAP between one chunk's end and the next one's start is the speaker pausing.
// Segments flow into a paragraph; a pause of `PARAGRAPH_GAP_S` or more starts a new
// one, separated by a blank line.
//
// Pure and unit-tested here; the worker calls it. When no usable chunks come back (a
// model without timestamp support), the joined text passes through untouched.

export interface TranscriptChunk {
  /** Start/end in seconds. The final chunk's end can be null at runtime. */
  timestamp: [number | null, number | null];
  text: string;
}

/** A pause at least this long (seconds) between segments starts a new paragraph. */
export const PARAGRAPH_GAP_S = 1.0;

/**
 * Longest phrase the loop guard will look for. Whisper's runaway is short and
 * tight — a word or a few — and a long "repeat" is much more likely to be a real
 * refrain than a decoder fault.
 */
export const LOOP_PHRASE_WORDS = 6;

/**
 * How many back-to-back repeats mark a decoder loop rather than speech. Measured
 * on the shipped weights, 30 s of non-speech comes back as the same word repeated
 * over two hundred times; a person saying something three times over is emphasis,
 * so the line sits above that.
 */
export const LOOP_REPEATS = 4;

/**
 * Compare words by their letters alone, so "oh," and "Oh" are the same word. A
 * token with no letters at all (the model emits runs of bare punctuation too) is
 * compared verbatim, so "." matches "." but not "-".
 */
function loopKey(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || word;
}

/** Do the `len` words at `a` repeat verbatim at `b`? */
function repeatsAt(keys: string[], a: number, b: number, len: number): boolean {
  if (b + len > keys.length) return false;
  for (let k = 0; k < len; k += 1) if (keys[a + k] !== keys[b + k]) return false;
  return true;
}

/**
 * Collapse a phrase repeated `LOOP_REPEATS` times or more down to a single
 * occurrence.
 *
 * This is the second line of defence behind the speech gate in `speechSpans.ts`.
 * Whisper is decoded greedily — Transformers.js implements none of the upstream
 * safety valves (`no_speech_threshold`, `compression_ratio_threshold`, the
 * temperature fallback), so once the decoder starts inventing there is nothing in
 * the library to stop it, and it emits the same phrase until it runs out of
 * tokens. Collapsing rather than deleting is deliberate: if the repetition WAS
 * real, one copy still says what was said.
 */
export function collapseLoops(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const words = trimmed.split(/\s+/);
  const keys = words.map(loopKey);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let jumped = false;
    for (let len = 1; len <= LOOP_PHRASE_WORDS && i + len * LOOP_REPEATS <= words.length; len += 1) {
      let reps = 1;
      while (repeatsAt(keys, i, i + reps * len, len)) reps += 1;
      if (reps >= LOOP_REPEATS) {
        for (let k = 0; k < len; k += 1) out.push(words[i + k]);
        i += reps * len;
        jumped = true;
        break;
      }
    }
    if (!jumped) {
      out.push(words[i]);
      i += 1;
    }
  }
  return out.join(' ');
}

/**
 * Below this many words per second, a long unbroken stretch of sound was not
 * somebody talking. Ordinary speech runs at two to three words a second, and the
 * energy gate has already stripped the pauses out of the stretch being judged, so
 * this floor is an order of magnitude below anything a speaker produces.
 */
export const MIN_WORDS_PER_S = 0.25;

/** Stretches shorter than this are never judged on density — one word can be the whole of a short one. */
export const DENSITY_MIN_S = 10;

/**
 * Could `text` really be everything that was said in `seconds` of continuous
 * sound? Continuous music or machine noise gets past an energy gate — it is loud,
 * and it never stops — and Whisper answers it with a token or two ("Thank you.",
 * "you"). Thirty seconds of sound yielding two words is not a transcription, and
 * saying nothing was heard is the honest answer (#710).
 */
export function plausibleTranscript(text: string, seconds: number): boolean {
  if (!(seconds >= DENSITY_MIN_S)) return true;
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return words >= seconds * MIN_WORDS_PER_S;
}

/** A segment's identity for the loop guard: its letters, lowercased. */
function segmentKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapse a run of `LOOP_REPEATS` or more identical segments to the first of
 * them. `collapseLoops` cannot see this shape: when the loop is slow enough that
 * each repetition lands in its own timestamped segment, every segment is clean on
 * its own and only the sequence gives it away.
 */
export function dropRepeatedSegments<T extends { text: string }>(parts: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < parts.length) {
    const key = segmentKey(parts[i].text);
    let j = i + 1;
    while (j < parts.length && segmentKey(parts[j].text) === key) j += 1;
    out.push(parts[i]);
    if (j - i < LOOP_REPEATS) for (let k = i + 1; k < j; k += 1) out.push(parts[k]);
    i = j;
  }
  return out;
}

export function paragraphsFromChunks(chunks: TranscriptChunk[] | undefined, fallbackText: string): string {
  const parts = dropRepeatedSegments(
    (chunks ?? []).map((c) => ({ ...c, text: collapseLoops(c.text || '') })).filter((c) => c.text.length > 0),
  );
  if (!parts.length) return collapseLoops(fallbackText || '');

  let out = parts[0].text;
  for (let i = 1; i < parts.length; i += 1) {
    const prevEnd = parts[i - 1].timestamp?.[1];
    const start = parts[i].timestamp?.[0];
    // An unknown boundary (null timestamp) is treated as continuous speech: joining
    // two segments that belong together reads fine, a spurious blank line does not.
    const pause = typeof prevEnd === 'number' && typeof start === 'number' && start - prevEnd >= PARAGRAPH_GAP_S;
    out += (pause ? '\n\n' : ' ') + parts[i].text;
  }
  return out;
}
