// Where in a recording is somebody actually speaking? (#710)
//
// Whisper does not decline to transcribe. Fed audio with no speech in it, it
// invents — and once it starts inventing it loops. Measured on the shipped
// `whisper-tiny` weights: 30 s of low-level room tone comes back as the word
// "you"; 30 s of amplitude-modulated noise comes back as "Oh, oh, oh, oh, …"
// repeated until the decoder runs out of tokens (888 characters from a clip
// nobody spoke into). That is the report in #710, verbatim.
//
// `isSilent` in `audioLevel.ts` already refuses a recording that is silent from
// end to end (#805), but it judges the WHOLE clip at once, so a real voice note
// with a long quiet tail passes it wholesale and the tail is handed to the model
// anyway. The fix is to find the speech first and transcribe only that: the
// model is never shown the parts it would have invented from.
//
// This is a plain energy detector, not a neural VAD — deliberately. It costs one
// pass over the samples, has no model to download, and the thing it has to get
// right is a threshold, which is exactly what a unit test can pin. It is tuned to
// err towards KEEPING audio: dropping a real sentence is a worse failure than
// letting one quiet stretch through, and the repetition guard in
// `transcriptFormat.ts` is the second line of defence for whatever does get
// through.
//
// KNOWN LIMIT — energy cannot tell a voice from any other sound with the same
// dynamics. Steady noise is rejected (it never rises above its own floor), but
// music, or noise with a speech-like rhythm, is not: it looks exactly like
// somebody talking. That case is caught downstream instead, by the repetition and
// density guards in `engines/transcriptFormat.ts`, which notice that a long
// stretch of sound came back as two words or as one phrase two hundred times.
// The same arithmetic means a perfectly CONSTANT tone is rejected as noise; real
// speech is never constant, so that is a fixture problem, not a product one.
//
// Pure (samples in, spans out) so it is testable without an AudioContext.

/** A stretch of the recording that holds speech, in seconds from the start. */
export interface SpeechSpan {
  start: number;
  end: number;
}

/** Analysis window. 20 ms is the usual VAD frame: long enough to be stable, short enough to catch a syllable. */
const FRAME_S = 0.02;

/**
 * Absolute noise gate, -48 dBFS RMS over one frame. Anything below this is the
 * noise floor of the recording chain, never a voice. Set well under a quiet voice
 * note (which sits around -30 dBFS) so a timid speaker survives.
 */
export const FRAME_FLOOR = 0.004;

/**
 * A frame must also be this many times above the clip's OWN noise floor. The
 * absolute gate alone cannot tell a loud hiss from a loud voice; this can,
 * because a voice is peaky against its background and a hiss is not.
 */
const FLOOR_FACTOR = 3;

/** Percentile of frame energy taken as the clip's noise floor. */
const FLOOR_PERCENTILE = 0.1;

/**
 * Keep transcribing for this long after the last loud frame. Speech is full of
 * gaps — stops, breaths, the pause mid-sentence — and cutting at the first quiet
 * frame would slice words in half.
 */
export const HANGOVER_S = 0.6;

/** Extra audio kept either side of a span, so the model gets a word's onset and tail. */
export const PAD_S = 0.25;

/** A span shorter than this is a click or a chair creak, not a word. */
export const MIN_SPAN_S = 0.25;

/**
 * Spans closer together than this are merged. Whisper pads every input to 30 s
 * regardless of length, so ten short spans cost ten full inferences — merging
 * across a short gap is far cheaper and the gap is too brief to invent from.
 */
export const MERGE_GAP_S = 2;

/** Merged spans stop growing here: one Whisper window is 30 s. */
export const MAX_SPAN_S = 28;

/** RMS of every non-overlapping `frame`-sample window. Exported for the tests. */
export function frameEnergies(samples: Float32Array, frame: number): Float32Array {
  const count = Math.floor(samples.length / frame);
  const out = new Float32Array(count);
  for (let f = 0; f < count; f += 1) {
    let sum = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i += 1) {
      const v = samples[base + i];
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / frame);
  }
  return out;
}

/** The `p` quantile of `values` (0..1), by sorting a copy. */
function quantile(values: Float32Array, p: number): number {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * The stretches of `samples` that hold speech. An empty array means the
 * recording holds none — the caller must then report that rather than let the
 * model invent a transcript for it.
 */
export function speechSpans(samples: Float32Array, sampleRate = 16000): SpeechSpan[] {
  const frame = Math.max(1, Math.round(FRAME_S * sampleRate));
  const energies = frameEnergies(samples, frame);
  if (!energies.length) return [];

  const threshold = Math.max(FRAME_FLOOR, quantile(energies, FLOOR_PERCENTILE) * FLOOR_FACTOR);
  const frameS = frame / sampleRate;
  const hangoverFrames = Math.ceil(HANGOVER_S / frameS);

  // Walk the frames, opening a span on the first loud one and closing it once the
  // recording has been quiet for the whole hangover.
  const raw: SpeechSpan[] = [];
  let start = -1;
  let quiet = 0;
  for (let f = 0; f < energies.length; f += 1) {
    if (energies[f] > threshold) {
      if (start < 0) start = f;
      quiet = 0;
    } else if (start >= 0) {
      quiet += 1;
      if (quiet >= hangoverFrames) {
        raw.push({ start: start * frameS, end: (f - quiet + 1) * frameS });
        start = -1;
        quiet = 0;
      }
    }
  }
  if (start >= 0) raw.push({ start: start * frameS, end: energies.length * frameS });

  const total = samples.length / sampleRate;
  const padded = raw.map((s) => ({
    start: Math.max(0, s.start - PAD_S),
    end: Math.min(total, s.end + PAD_S),
  }));

  // Merge neighbours that are close together, but never past one Whisper window.
  const merged: SpeechSpan[] = [];
  for (const span of padded) {
    const last = merged[merged.length - 1];
    if (last && span.start - last.end <= MERGE_GAP_S && span.end - last.start <= MAX_SPAN_S) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  return merged.filter((s) => s.end - s.start >= MIN_SPAN_S);
}
