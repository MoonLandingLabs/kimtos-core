// What the transcription engine hands the model (#710).
//
// The bug this pins: the engine used to decode the recording and post ALL of it to
// the worker. Whisper does not decline audio it cannot transcribe — fed room tone
// it invents a word, fed modulated noise it loops one phrase for hundreds of
// characters — so a voice note with a long quiet tail came back as the sentence
// plus fabricated text welded onto the end.
//
// The worker and the model are faked here: the real ones pull hundreds of MB. What
// the fake proves is the contract around them — that the quiet parts are found
// before the model runs and are never sent, and that a recording with no speech in
// it costs no inference at all.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';
import type { SpeechSpan } from '../speechSpans.js';

const SR = 16000;
const n = (seconds: number): number => Math.round(seconds * SR);

/** A voice: a tone under a syllabic envelope, which is the shape the gate keys on. */
function voice(seconds: number, amp = 0.3): Float32Array {
  const out = new Float32Array(n(seconds));
  for (let i = 0; i < out.length; i += 1) {
    const syllable = 0.15 + 0.85 * Math.abs(Math.sin((2 * Math.PI * 3 * i) / SR));
    out[i] = Math.sin((2 * Math.PI * 200 * i) / SR) * amp * syllable;
  }
  return out;
}

/** A live mic in a quiet room: steady low-level hiss, deterministic. */
function roomTone(seconds: number, amp = 0.02): Float32Array {
  const out = new Float32Array(n(seconds));
  let seed = 1;
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = (seed / 2147483648 - 0.5) * 2 * amp;
  }
  return out;
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

interface RunMsg {
  type: string;
  audio?: Float32Array;
  spans?: SpeechSpan[];
  model?: string;
  language?: string;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: RunMsg[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: RunMsg): void {
    this.posted.push(msg);
    // Answer on a later turn, the way a real worker does.
    setTimeout(() => this.onmessage?.({ data: { type: 'done', text: 'transcript' } }), 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** Install the globals `transcribeAudio` reaches for, and the samples it should decode to. */
function installAudio(samples: Float32Array): void {
  const g = globalThis as unknown as { window: Record<string, unknown>; Worker?: unknown };
  FakeWorker.instances = [];
  g.Worker = FakeWorker;
  g.window.AudioContext = class {
    async decodeAudioData(): Promise<{ numberOfChannels: number; length: number; getChannelData: () => Float32Array }> {
      return { numberOfChannels: 1, length: samples.length, getChannelData: () => samples };
    }
    close(): void {}
  };
}

/** A stand-in recording; its bytes are irrelevant because the AudioContext is faked. */
const clip = (): Blob => new Blob([new Uint8Array(8)], { type: 'audio/webm' });

describe('transcribeAudio hands the model only the speech (#710)', () => {
  let env: DomEnv;
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).Worker;
    env?.cleanup();
  });

  test('a recording with no sound never reaches the model', async () => {
    env = installDom();
    installAudio(new Float32Array(n(30)));
    const { transcribeAudio } = await import('./transcribe.js');
    assert.equal(await transcribeAudio(clip()), '');
    assert.equal(FakeWorker.instances.length, 0, 'no worker, so no download and no inference');
  });

  test('a recording of room tone alone never reaches the model either', async () => {
    env = installDom();
    installAudio(roomTone(30));
    const { transcribeAudio } = await import('./transcribe.js');
    assert.equal(await transcribeAudio(clip()), '');
    assert.equal(FakeWorker.instances.length, 0, 'room tone is not speech');
  });

  test('the silent tail of a real voice note is not sent — this is the regression', async () => {
    env = installDom();
    installAudio(join(voice(5), roomTone(60)));
    const { transcribeAudio } = await import('./transcribe.js');
    assert.equal(await transcribeAudio(clip()), 'transcript');

    assert.equal(FakeWorker.instances.length, 1);
    const msg = FakeWorker.instances[0].posted[0];
    assert.equal(msg.type, 'run');
    assert.ok(msg.spans?.length, 'the worker is told where the speech is');
    const covered = msg.spans!.reduce((sum, s) => sum + (s.end - s.start), 0);
    assert.ok(covered < 10, `${covered.toFixed(1)}s of 65s sent — the tail leaked`);
    assert.ok(
      msg.spans!.every((s) => s.start < 7),
      JSON.stringify(msg.spans),
    );
  });

  test('two utterances separated by a long pause are sent as two spans', async () => {
    env = installDom();
    installAudio(join(voice(3), roomTone(8), voice(3)));
    const { transcribeAudio } = await import('./transcribe.js');
    await transcribeAudio(clip());
    assert.equal(FakeWorker.instances[0].posted[0].spans?.length, 2);
  });

  test('the model and language the caller picked are passed through', async () => {
    env = installDom();
    installAudio(voice(5));
    const { transcribeAudio } = await import('./transcribe.js');
    await transcribeAudio(clip(), { model: 'kimtos-labs/whisper-base', language: 'ar' });
    const msg = FakeWorker.instances[0].posted[0];
    assert.equal(msg.model, 'kimtos-labs/whisper-base');
    assert.equal(msg.language, 'ar');
  });
});
