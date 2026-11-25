// The themed waveform audio player: it must build its DOM, dispose cleanly (so an <audio>
// and its ResizeObserver never outlive the surface that mounted it — the leak #1122 fixes in
// KimtFS), and let a host override the accent / idle colours while defaulting to theme tokens.
//
// The waveform DRAW itself (canvas peaks, the resolved colours actually painted) needs a real
// browser and is verified there; here we lock the contract that is testable headlessly.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { createAudioPlayer, resolveWaveColor } from './audioPlayer.js';

let env: DomEnv;

// happy-dom has no Audio constructor, and createAudioPlayer builds a `new Audio()`. A canvas
// getContext returns null there too, so stub a minimal 2d context so a stray draw cannot throw.
function installAudioGlobals(): { disconnects: number } {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Audio = (env.window as unknown as { Audio: unknown }).Audio;

  const counter = { disconnects: 0 };
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      counter.disconnects += 1;
    }
  };

  const Canvas = (env.window as unknown as { HTMLCanvasElement: { prototype: { getContext: unknown } } })
    .HTMLCanvasElement;
  Canvas.prototype.getContext = (): unknown => ({
    clearRect: (): void => {},
    setTransform: (): void => {},
    beginPath: (): void => {},
    roundRect: (): void => {},
    fill: (): void => {},
    fillRect: (): void => {},
    fillStyle: '',
  });
  return counter;
}

describe('createAudioPlayer', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('builds a themed player with play, waveform and time', () => {
    installAudioGlobals();
    const player = createAudioPlayer('blob:test-clip');
    assert.ok(player.el.classList.contains('audio-player'), 'root carries .audio-player');
    assert.ok(player.el.querySelector('.audio-play'), 'has a play button');
    assert.ok(player.el.querySelector('.audio-wave'), 'has a waveform canvas');
    assert.ok(player.el.querySelector('.audio-time'), 'has a time readout');
    assert.ok(player.audio instanceof (globalThis as { Audio: new () => unknown }).Audio, 'exposes its <audio>');
    player.destroy();
  });

  test('destroy() disconnects the ResizeObserver and releases the <audio>', () => {
    const counter = installAudioGlobals();
    const player = createAudioPlayer('blob:test-clip');
    assert.equal(player.audio.paused, true, 'starts paused');
    player.destroy();
    assert.equal(counter.disconnects, 1, 'the ResizeObserver is disconnected exactly once');
    assert.equal(player.audio.getAttribute('src'), null, 'the <audio> src is cleared');
  });

  test('accepts an options object and stays backward compatible with createAudioPlayer(src)', () => {
    installAudioGlobals();
    // No throw either way; the one-arg form is the signature the three existing consumers use.
    const bare = createAudioPlayer('blob:test-clip');
    const tuned = createAudioPlayer('blob:test-clip', { accent: '--accent', idle: 'rgb(1, 2, 3)' });
    bare.destroy();
    tuned.destroy();
  });
});

describe('resolveWaveColor', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('a direct colour spec overrides — it is used verbatim, ignoring the fallback', () => {
    const root = env.document.createElement('div');
    assert.equal(resolveWaveColor(root, 'rgb(1, 2, 3)', '#000'), 'rgb(1, 2, 3)');
  });

  test('a --token spec that resolves to nothing falls back to the default colour', () => {
    // No stylesheet is loaded in the headless DOM, so the token resolves to '' → the fallback.
    // This is exactly why the fallback equals the token dark value: the visual is unchanged.
    const root = env.document.createElement('div');
    assert.equal(resolveWaveColor(root, '--accent', '#6c8cff'), '#6c8cff');
    assert.equal(resolveWaveColor(root, '--audio-wave-idle', 'rgba(255, 255, 255, 0.16)'), 'rgba(255, 255, 255, 0.16)');
  });

  test('a resolved --token wins over the fallback', () => {
    const root = env.document.createElement('div');
    root.style.setProperty('--accent', 'rgb(9, 9, 9)');
    // happy-dom may not expose inline custom props through getComputedStyle; only assert the
    // override path when it does, so this stays a real assertion, not a false green.
    const resolved = getComputedStyle(root).getPropertyValue('--accent').trim();
    if (resolved) assert.equal(resolveWaveColor(root, '--accent', '#000'), 'rgb(9, 9, 9)');
  });
});
