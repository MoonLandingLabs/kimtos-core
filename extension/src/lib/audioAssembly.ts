// Pure audio assembly for Voice Studio: stitch per-chunk PCM into one clip and
// encode it to a WAV. No DOM, no engine imports — so it is unit-tested directly
// and importable from anywhere.
//
// Long-form narration synthesises one chunk (a sentence or a few) at a time, each
// its own Kokoro utterance. Concatenating them with a hard `set()` leaves a
// discontinuity at every seam — a faint but audible click, the obvious failure of
// naive stitching. So joins are CROSSFADED over a short equal-power ramp: the tail
// of one chunk fades out while the head of the next fades in, over ~30 ms of the
// near-silence that brackets each utterance, which removes the click without
// clipping speech.

/** Mono 16-bit PCM WAV from float samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** Total sample count of a stitch (accounting for the overlap removed at each join). */
export function stitchedLength(lengths: number[], fade: number): number {
  if (lengths.length === 0) return 0;
  let total = lengths[0];
  for (let i = 1; i < lengths.length; i += 1) {
    const overlap = Math.min(fade, lengths[i - 1], lengths[i]);
    total += lengths[i] - overlap;
  }
  return total;
}

/**
 * Crossfade-concatenate mono PCM chunks into one continuous clip.
 *
 * @param chunks     per-chunk float samples (all the same sample rate)
 * @param sampleRate sample rate, for converting `fadeMs` to samples
 * @param fadeMs     crossfade length at each seam (default 30 ms)
 *
 * The fade uses an equal-power (cosine) curve so the perceived loudness stays
 * constant through the seam; a linear fade dips in the middle. Chunks shorter than
 * the fade shrink the fade to fit rather than overlap past their own start.
 */
export function crossfadeConcat(chunks: Float32Array[], sampleRate: number, fadeMs = 30): Float32Array {
  const parts = chunks.filter((c) => c.length > 0);
  if (parts.length === 0) return new Float32Array(0);
  if (parts.length === 1) return parts[0];

  const fade = Math.max(0, Math.floor((fadeMs / 1000) * sampleRate));
  const out = new Float32Array(
    stitchedLength(
      parts.map((p) => p.length),
      fade,
    ),
  );

  out.set(parts[0], 0);
  let end = parts[0].length; // write cursor: samples already committed

  for (let i = 1; i < parts.length; i += 1) {
    const next = parts[i];
    const overlap = Math.min(fade, end, next.length);
    const start = end - overlap; // where the crossfade region begins in `out`
    for (let j = 0; j < overlap; j += 1) {
      // t goes 0→1 across the overlap; equal-power gains sum in power to 1.
      const t = overlap === 1 ? 1 : j / (overlap - 1);
      const gOut = Math.cos((t * Math.PI) / 2); // fading-out tail of the previous chunk
      const gIn = Math.sin((t * Math.PI) / 2); // fading-in head of the next chunk
      out[start + j] = out[start + j] * gOut + next[j] * gIn;
    }
    // Append the remainder of the next chunk after the overlap.
    out.set(next.subarray(overlap), end);
    end = start + next.length;
  }
  return out.subarray(0, end);
}
