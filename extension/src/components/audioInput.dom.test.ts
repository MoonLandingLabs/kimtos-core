// The recording sources, as the user drives them.
//
// The headline guarantee is the one in the first test: recording system audio must
// never ask for a microphone. It used to — the two were welded into a single
// either/or choice whose 'system' branch called getUserMedia unconditionally — so a
// user whose mic was blocked at the OS level (the Windows default for desktop apps)
// could not record a meeting that needed no microphone at all (#1327).
//
// The rest pin the surrounding promises: nothing is recorded with every source off,
// a refusal is explained rather than swallowed, and a leg can be dropped mid-take.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

class FakeTrack {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  onended: (() => void) | null = null;
  constructor(kind = 'audio') {
    this.kind = kind;
  }
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: FakeStream) {}
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

interface Calls {
  mic: number;
  display: number;
}

describe('createAudioInput sources', () => {
  let env: DomEnv;
  let createAudioInput: typeof import('./audioInput.js').createAudioInput;
  let calls: Calls;
  let micResult: () => Promise<FakeStream>;
  let displayTracks: FakeTrack[];

  const g = (): Record<string, unknown> => globalThis as unknown as Record<string, unknown>;

  before(async () => {
    env = installDom();
    g().MediaStream = FakeStream;
    g().MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          calls.mic += 1;
          return micResult();
        },
        getDisplayMedia: () => {
          calls.display += 1;
          return Promise.resolve(new FakeStream(displayTracks));
        },
      },
    });
    ({ createAudioInput } = await import('./audioInput.js'));
  });
  after(() => env.cleanup());

  beforeEach(() => {
    calls = { mic: 0, display: 0 };
    micResult = () => Promise.resolve(new FakeStream([new FakeTrack()]));
    displayTracks = [new FakeTrack('video'), new FakeTrack('audio')];
  });

  const segs = (el: HTMLElement): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('.rec-source-seg')];
  const recordBtn = (el: HTMLElement): HTMLButtonElement => el.querySelector('.record-btn') as HTMLButtonElement;
  const hint = (el: HTMLElement): string => el.querySelector('.rec-source-hint')?.textContent ?? '';
  const errorLine = (el: HTMLElement): string => el.querySelector('.app-error')?.textContent ?? '';
  /** Let the click's async start settle. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  test('system audio alone NEVER asks for the microphone', async () => {
    const input = createAudioInput({ getMic: () => false, getSystem: () => true });
    recordBtn(input.el).click();
    await settle();
    assert.equal(calls.display, 1);
    assert.equal(calls.mic, 0, 'the microphone must not be requested when it was not asked for');
    input.destroy();
  });

  test('the microphone alone never opens the screen picker', async () => {
    const input = createAudioInput({ getMic: () => true, getSystem: () => false });
    recordBtn(input.el).click();
    await settle();
    assert.equal(calls.mic, 1);
    assert.equal(calls.display, 0);
    input.destroy();
  });

  test('both switches on captures both', async () => {
    // Mixing two legs needs an AudioContext; the fake is only here so the mix path runs.
    g().AudioContext = class {
      createMediaStreamDestination(): { stream: FakeStream } {
        return { stream: new FakeStream([new FakeTrack()]) };
      }
      createMediaStreamSource(): { connect: () => void } {
        return { connect: (): void => {} };
      }
      close(): Promise<void> {
        return Promise.resolve();
      }
    };
    const input = createAudioInput({ getMic: () => true, getSystem: () => true });
    recordBtn(input.el).click();
    await settle();
    assert.equal(calls.display, 1);
    assert.equal(calls.mic, 1);
    input.destroy();
  });

  test('with every source off there is nothing to record, and the button says so', () => {
    const input = createAudioInput({ getMic: () => false, getSystem: () => false });
    assert.equal(recordBtn(input.el).disabled, true);
    assert.match(hint(input.el), /at least one source/i);
    input.destroy();
  });

  test('turning a source on and off is remembered — and both can be on at once', () => {
    const picked: Record<string, boolean> = {};
    const input = createAudioInput({
      getMic: () => true,
      getSystem: () => false,
      onPickMic: (on) => (picked.mic = on),
      onPickSystem: (on) => (picked.system = on),
    });
    const [mic, sys] = segs(input.el);
    sys.click();
    assert.deepEqual({ ...picked }, { system: true });
    assert.equal(mic.getAttribute('aria-pressed'), 'true');
    assert.equal(sys.getAttribute('aria-pressed'), 'true');
    mic.click();
    assert.equal(picked.mic, false);
    assert.equal(recordBtn(input.el).disabled, false, 'system audio alone is still a recording');
    input.destroy();
  });

  test('a blocked microphone is explained, and the choice is NOT quietly turned off', async () => {
    micResult = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    const picked: string[] = [];
    const input = createAudioInput({
      getMic: () => true,
      getSystem: () => false,
      onPickMic: () => picked.push('mic'),
    });
    recordBtn(input.el).click();
    await settle();
    assert.match(errorLine(input.el), /chrome:\/\/settings\/content\/microphone/);
    assert.deepEqual(picked, [], 'a failure is not the user changing their mind');
    assert.equal(segs(input.el)[0].getAttribute('aria-pressed'), 'true');
    input.destroy();
  });

  test('sharing a screen with no audio is refused rather than recorded as silence', async () => {
    displayTracks = [new FakeTrack('video')];
    const input = createAudioInput({ getMic: () => false, getSystem: () => true });
    recordBtn(input.el).click();
    await settle();
    assert.match(errorLine(input.el), /Share audio/);
    input.destroy();
  });

  test('a leg can be muted and unmuted mid-take without ending the recording', async () => {
    const micTrack = new FakeTrack();
    micResult = () => Promise.resolve(new FakeStream([micTrack]));
    const input = createAudioInput({ getMic: () => true, getSystem: () => false });
    recordBtn(input.el).click();
    await settle();

    const [mic, sys] = segs(input.el);
    assert.equal(sys.disabled, true, 'a source that was not captured cannot join the mix mid-take');
    mic.click();
    assert.equal(micTrack.enabled, false);
    assert.match(hint(input.el), /muted/i);
    assert.equal(recordBtn(input.el).classList.contains('is-recording'), true, 'still recording');
    mic.click();
    assert.equal(micTrack.enabled, true);
    input.destroy();
  });
});
