// The Voice Studio voice palette — the fixed set of Kokoro-82M voices we ship.
//
// Kokoro's repo carries ~50 voice styles, but only the English ones phonemise
// correctly through the eSpeak-NG (English) path we run in-browser; the Japanese
// and Chinese styles were trained on a different grapheme-to-phoneme frontend
// (misaki) that we do not ship, so they would sound wrong. This is the honest,
// working palette: 28 English voices across US/UK and female/male, each a real
// speaker style baked into the model.
//
// This file is DEPENDENCY-FREE (no DOM, no transformers) so both the app UI and
// the synthesis worker import it: the worker needs the voice→accent language
// mapping, the UI needs the display metadata.
//
// The catalog (ids, per-voice quality grades, US/UK + female/male) is derived from
// the Apache-2.0 kokoro-js project (hexgrad/kokoro); see THIRD-PARTY-NOTICES.md.
// The original carried decorative emoji "traits"; those are intentionally dropped
// (this repo forbids emoji, and they were never load-bearing).

/** eSpeak accent used when phonemising for this voice. */
export type VoiceLang = 'en-us' | 'en-gb';
export type VoiceGender = 'Female' | 'Male';

export interface Voice {
  /** Kokoro voice id, e.g. `af_heart` — also the `voices/<id>.bin` filename. */
  id: string;
  /** Display name. */
  name: string;
  lang: VoiceLang;
  gender: VoiceGender;
  /** Kokoro's own overall quality grade (A best … F). Drives the "top voices"
   *  preview shortlist and a small quality hint in the UI. */
  grade: string;
}

// The 28 English voices, in Kokoro's own quality order within each group.
export const VOICES: readonly Voice[] = Object.freeze([
  // US female
  { id: 'af_heart', name: 'Heart', lang: 'en-us', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', lang: 'en-us', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-us', gender: 'Female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_nova', name: 'Nova', lang: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'af_sky', name: 'Sky', lang: 'en-us', gender: 'Female', grade: 'C-' },
  { id: 'af_alloy', name: 'Alloy', lang: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'af_jessica', name: 'Jessica', lang: 'en-us', gender: 'Female', grade: 'D' },
  { id: 'af_river', name: 'River', lang: 'en-us', gender: 'Female', grade: 'D' },
  // US male
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_santa', name: 'Santa', lang: 'en-us', gender: 'Male', grade: 'D-' },
  { id: 'am_adam', name: 'Adam', lang: 'en-us', gender: 'Male', grade: 'F+' },
  // UK female
  { id: 'bf_emma', name: 'Emma', lang: 'en-gb', gender: 'Female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-gb', gender: 'Female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', lang: 'en-gb', gender: 'Female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', lang: 'en-gb', gender: 'Female', grade: 'D' },
  // UK male
  { id: 'bm_fable', name: 'Fable', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_george', name: 'George', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_daniel', name: 'Daniel', lang: 'en-gb', gender: 'Male', grade: 'D' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-gb', gender: 'Male', grade: 'D+' },
]);

/** The default voice — Kokoro's highest-graded speaker. */
export const DEFAULT_VOICE = 'af_heart';

const BY_ID = new Map(VOICES.map((v) => [v.id, v]));

export const voiceById = (id: string): Voice | undefined => BY_ID.get(id);

/** Is this a voice we ship? Guards the engine against an unknown id. */
export const isKnownVoice = (id: string): boolean => BY_ID.has(id);

/** The eSpeak language for a voice id (from its first letter: `a`=US, `b`=UK),
 *  mirroring Kokoro's own convention. Falls back to US. */
export function langOf(id: string): VoiceLang {
  return id.charAt(0) === 'b' ? 'en-gb' : 'en-us';
}

/** A short human label for the accent + gender, e.g. "US · Female". */
export function voiceGroup(v: Voice): string {
  return `${v.lang === 'en-gb' ? 'UK' : 'US'} · ${v.gender}`;
}

export interface VoiceGrouping {
  label: string;
  voices: Voice[];
}

// The palette, grouped by accent then gender, in a stable display order.
const GROUP_ORDER = ['US · Female', 'US · Male', 'UK · Female', 'UK · Male'];

export function groupedVoices(): VoiceGrouping[] {
  const groups = new Map<string, Voice[]>();
  for (const v of VOICES) {
    const key = voiceGroup(v);
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }
  return GROUP_ORDER.filter((label) => groups.has(label)).map((label) => ({
    label,
    voices: groups.get(label) as Voice[],
  }));
}

/** A short, high-quality shortlist for one-tap previews across the palette
 *  (one strong US female, US male, UK female, UK male). */
export const TOP_VOICES: readonly string[] = Object.freeze(['af_heart', 'am_michael', 'bf_emma', 'bm_george']);
