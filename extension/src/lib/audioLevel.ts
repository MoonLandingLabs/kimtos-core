// How loud is a decoded audio buffer, and is there anything in it at all?
//
// Whisper does not return "nothing" for an empty recording — fed silence it
// invents a token, reliably the word "you" (#805). So a recording that captured
// no sound has to be caught BEFORE the model sees it, and the only way to know
// is to look at the samples.
//
// `levelOf` is deliberately pure (samples in, numbers out) so it is unit
// testable without an AudioContext.

export interface AudioLevel {
  /** Loudest single sample, 0..1 (full scale). */
  peak: number;
  /** Root-mean-square amplitude — the average energy, 0..1. */
  rms: number;
}

// -40 dBFS. Speech recorded at any usable level peaks far above this; a muted
// mic, a screen share with no audio shared, or a dead track sits far below.
export const SILENT_PEAK = 0.01;
// -60 dBFS average. Catches the other shape of an empty clip: a single click or
// pop (a high peak) over an otherwise flat, empty recording.
export const SILENT_RMS = 0.001;

/** Peak and RMS amplitude of one channel of decoded audio. */
export function levelOf(samples: Float32Array): AudioLevel {
  if (!samples.length) return { peak: 0, rms: 0 };
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / samples.length) };
}

/**
 * True when the buffer holds no speech worth transcribing. Either metric being
 * that low is enough: a flat buffer fails both, a clip that is one pop of noise
 * passes `peak` but fails `rms`.
 */
export function isSilent({ peak, rms }: AudioLevel): boolean {
  return peak < SILENT_PEAK || rms < SILENT_RMS;
}
