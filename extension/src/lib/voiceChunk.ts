// Split long-form text into synthesis chunks at sentence boundaries.
//
// Kokoro truncates any single utterance past ~510 phoneme tokens, which would
// silently drop the tail of a long paragraph. So for narration we split the input
// into sentences, pack consecutive sentences up to a conservative character budget
// (phonemes run a little longer than characters, so we stay well under the token
// cap), and hard-split any single sentence that is itself over-long — first at
// clause punctuation, then on whitespace as a last resort. No text is ever dropped:
// the concatenation of the chunks equals the input with runs of whitespace
// collapsed.
//
// Pure and unit-tested — no DOM, no engine.

/** Conservative per-chunk character budget. Kept well below Kokoro's ~510-token
 *  cap because a phoneme string is typically longer than the source text. */
export const MAX_CHUNK_CHARS = 280;

// A sentence terminator (. ! ? … possibly followed by a closing quote/bracket),
// then whitespace, ONLY when what follows looks like a new sentence — a capital
// letter, an opening quote/bracket, or a digit. The lookahead keeps mid-sentence
// punctuation together (`"Stop!" she cried.` is one sentence, not two) while still
// splitting real boundaries. Over-splitting is harmless (each chunk is its own
// utterance) and under-splitting is caught by the length guard, so this stays
// deliberately simple.
const SENTENCE_BOUNDARY = /([.!?…]+["'”’)\]]?)(\s+)(?=["'“‘([{\p{Lu}\d])/gu;

/** Split text into sentences, preserving the terminating punctuation. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_BOUNDARY)) {
    const endOfSentence = (m.index ?? 0) + m[1].length;
    const piece = text.slice(last, endOfSentence).trim();
    if (piece) out.push(piece);
    last = endOfSentence + m[2].length;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

// Break one over-long sentence into <= maxChars pieces: prefer clause boundaries
// (comma, semicolon, colon, dash), fall back to packing whole words, and only as a
// final resort hard-cut a single word longer than the budget.
function splitLongSentence(sentence: string, maxChars: number): string[] {
  const clauses = sentence.split(/(?<=[,;:—-])\s+/);
  const out: string[] = [];
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  };
  for (const clause of clauses) {
    if (clause.length > maxChars) {
      flush();
      // Pack words; a single word longer than the budget is hard-cut.
      for (const word of clause.split(/\s+/)) {
        if (word.length > maxChars) {
          flush();
          for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
          continue;
        }
        if (buf && buf.length + 1 + word.length > maxChars) flush();
        buf = buf ? `${buf} ${word}` : word;
      }
      continue;
    }
    if (buf && buf.length + 1 + clause.length > maxChars) flush();
    buf = buf ? `${buf} ${clause}` : clause;
  }
  flush();
  return out;
}

/**
 * Split text into synthesis chunks, each at most `maxChars` characters (except an
 * unavoidable single word longer than the budget). Sentence boundaries are
 * preferred; consecutive short sentences are packed together to keep the number of
 * model runs down.
 */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      chunks.push(...splitLongSentence(sentence, maxChars));
      continue;
    }
    if (buf && buf.length + 1 + sentence.length > maxChars) flush();
    buf = buf ? `${buf} ${sentence}` : sentence;
  }
  flush();
  return chunks;
}
