// Prove Voice Studio actually SPEAKS — the check nothing else can give.
//
//   node scripts/verify-voice-audio.mjs                                  # the shipped model id
//   node scripts/verify-voice-audio.mjs --model onnx-community/Kokoro-82M-v1.0-ONNX
//   node scripts/verify-voice-audio.mjs --wav /tmp/out                   # also write the clips
//
// Dev-run, NOT CI: it needs network and downloads ~400 MB the first time.
//
// WHY IT EXISTS. #60's acceptance bar is "at least three distinct voices produce clearly
// different, INTELLIGIBLE, non-silent speech", and #1092 replaced the phoneme frontend
// wholesale — eSpeak-NG is GPL-3.0, so the phonemes now come from a BSD-2-Clause
// dictionary instead. A green unit suite proves the IPA is what we intended; it cannot
// prove the model says the words. Loading a model is not evidence it speaks, and a TTS app
// that ships silence is the exact failure `on-device-models` warns about.
//
// So this runs the REAL weights through the REAL frontend and then measures three things:
//
//   1. Non-silence — peak and RMS per clip.
//   2. Distinctness — the pairwise correlation of the waveforms. Three voices reading one
//      sentence must not be near-identical, or the voice palette is a lie.
//   3. INTELLIGIBILITY — Whisper transcribes each clip and it is scored, word by word,
//      against the text that went in. This is the part that is worth having: "the audio
//      was not silent" is a much weaker claim than "a speech recogniser understood it",
//      and a phoneme-frontend regression shows up here as a word error rate, not as a
//      subjective impression nobody can re-run.
//
// It bundles the extension's own TypeScript frontend with esbuild rather than reimplementing
// it, so what is verified is the code that ships.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env, pipeline } from '@huggingface/transformers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

// The model as the extension ships it (Hugging Face). Override with --model to try another repo.
const MODEL = arg('--model', 'onnx-community/Kokoro-82M-v1.0-ONNX');
const WAV_DIR = arg('--wav', null);
const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;

const TEXT = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn.';
const VOICES = [
  { id: 'af_heart', lang: 'a' },
  { id: 'am_michael', lang: 'a' },
  { id: 'bf_emma', lang: 'b' },
];

/** The extension's own frontend, bundled from source so this verifies the shipped code. */
async function loadFrontend() {
  const bundle = (entry) => {
    const out = execFileSync(
      'npx',
      ['esbuild', entry, '--bundle', '--format=esm', '--platform=neutral', '--log-level=error'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`);
  };
  const [phonemize, lexicon] = await Promise.all([
    bundle(join(EXT, 'src/lib/engines/voicePhonemize.ts')),
    bundle(join(EXT, 'src/lib/g2p/lexicon.ts')),
  ]);
  const text = gunzipSync(readFileSync(join(EXT, 'public/voice/lexicon.txt.gz'))).toString('utf8');
  const dictionary = lexicon.parseLexicon(text);
  return { dictionary, phonemizeWith: phonemize.phonemizeWith };
}

async function voiceStyle(voice) {
  const url = `${env.remoteHost.replace(/\/?$/, '/')}${MODEL}/resolve/main/voices/${voice}.bin`;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function stats(pcm) {
  let peak = 0;
  let sumsq = 0;
  let loud = 0;
  for (const v of pcm) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumsq += v * v;
    if (a > 1e-3) loud += 1;
  }
  return { peak, rms: Math.sqrt(sumsq / pcm.length), voiced: loud / pcm.length, seconds: pcm.length / SAMPLE_RATE };
}

/** Pearson correlation over the shared prefix — near 1 means two voices are the same voice. */
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return cov / (Math.sqrt(va * vb) || 1);
}

/** Word error rate of `heard` against `said`, the standard edit distance over words. */
export function wordErrorRate(said, heard) {
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = norm(said);
  const b = norm(heard);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length] / a.length;
}

function wav(pcm) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i += 1) buf.writeInt16LE(Math.max(-1, Math.min(1, pcm[i])) * 32767, 44 + i * 2);
  return buf;
}

async function main() {
  const { dictionary, phonemizeWith } = await loadFrontend();
  console.log(`frontend: ${dictionary.size} dictionary words`);

  const model = await StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL);

  const say = async (text, voice, lang) => {
    const phonemes = phonemizeWith(text, dictionary, lang);
    const { input_ids } = tokenizer(phonemes, { truncation: true });
    const numTokens = Math.min(Math.max(Number(input_ids.dims.at(-1)) - 2, 0), 509);
    const style = (await voiceStyle(voice)).slice(numTokens * STYLE_DIM, numTokens * STYLE_DIM + STYLE_DIM);
    const { waveform } = await model({
      input_ids,
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', [1], [1]),
    });
    return { pcm: waveform.data, phonemes };
  };

  const clips = [];
  for (const { id, lang } of VOICES) {
    const { pcm, phonemes } = await say(TEXT, id, lang);
    const s = stats(pcm);
    clips.push({ id, pcm, s });
    console.log(
      `${id.padEnd(12)} ${s.seconds.toFixed(2)}s peak=${s.peak.toFixed(3)} rms=${s.rms.toFixed(4)} ` +
        `voiced=${(s.voiced * 100).toFixed(0)}%`,
    );
    console.log(`             ${phonemes}`);
  }

  console.log('\ndistinctness (1.0 would mean the same voice twice):');
  for (let i = 0; i < clips.length; i += 1) {
    for (let j = i + 1; j < clips.length; j += 1) {
      console.log(`  ${clips[i].id} vs ${clips[j].id}: ${correlation(clips[i].pcm, clips[j].pcm).toFixed(3)}`);
    }
  }

  // A long, multi-paragraph render must come out as ONE continuous clip.
  const paragraphs = [
    'Voice Studio turns written text into speech on your own device.',
    'Nothing you type is uploaded, and the model runs entirely in the browser.',
    'Paste a whole chapter and it renders as a single continuous recording.',
  ].join('\n\n');
  const long = await say(paragraphs, VOICES[0].id, VOICES[0].lang);
  const longStats = stats(long.pcm);
  console.log(
    `\nmulti-paragraph: ${longStats.seconds.toFixed(2)}s peak=${longStats.peak.toFixed(3)} ` +
      `voiced=${(longStats.voiced * 100).toFixed(0)}%`,
  );

  console.log('\nintelligibility (Whisper transcribes what the voice said):');
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype: 'q8' }).catch(() =>
    pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { dtype: 'q8' }),
  );
  let worst = 0;
  for (const clip of clips) {
    const { text: heard } = await asr(Float32Array.from(clip.pcm), { language: 'en', task: 'transcribe' });
    const wer = wordErrorRate(TEXT, heard);
    worst = Math.max(worst, wer);
    console.log(`  ${clip.id.padEnd(12)} WER ${(wer * 100).toFixed(1)}%  "${heard.trim()}"`);
  }
  const { text: heardLong } = await asr(Float32Array.from(long.pcm), { language: 'en', task: 'transcribe' });
  console.log(
    `  multi-paragraph WER ${(wordErrorRate(paragraphs, heardLong) * 100).toFixed(1)}%  "${heardLong.trim()}"`,
  );

  if (WAV_DIR) {
    mkdirSync(WAV_DIR, { recursive: true });
    for (const clip of clips) writeFileSync(join(WAV_DIR, `${clip.id}.wav`), wav(clip.pcm));
    writeFileSync(join(WAV_DIR, 'multi-paragraph.wav'), wav(long.pcm));
    console.log(`\nwrote ${clips.length + 1} clips to ${WAV_DIR}`);
  }

  const silent = clips.filter((c) => c.s.peak < 0.05 || c.s.voiced < 0.2);
  const identical = clips.some((a, i) => clips.some((b, j) => j > i && correlation(a.pcm, b.pcm) > 0.9));
  const failures = [
    silent.length ? `${silent.map((c) => c.id).join(', ')} produced silence` : '',
    identical ? 'two voices are near-identical' : '',
    worst > 0.25 ? `the worst voice has a ${(worst * 100).toFixed(0)}% word error rate` : '',
  ].filter(Boolean);

  console.log(failures.length ? `\nFAIL: ${failures.join('; ')}` : '\nPASS');
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
