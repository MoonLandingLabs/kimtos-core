// A compact, theme-matching waveform audio player — play/pause, a clickable
// waveform that fills as it plays, and a time readout. Reusable anywhere we show
// audio (Voice to Text history, Denoise A/B). Returns { el, audio, destroy }.
//
// `src` is a URL string (e.g. an object URL); the caller owns its lifetime.
//
// Perf: each clip is decoded once into a high-resolution peak array (cached by
// src), then cheaply downsampled to the number of bars that fit. Resizing only
// re-buckets that small array — no re-decode, no re-scan of the samples.

import { el } from '../lib/dom.js';

// Safari exposes AudioContext under a webkit-prefixed name.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PLAY = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`;

const BAR = 2; // bar width (css px)
const GAP = 1.5; // gap between bars
const BASE_RES = 1024; // peaks computed once at this resolution, then downsampled

// Colour knobs. Each is either a CSS colour used verbatim, or a `--custom-property`
// name resolved off the player's root — so a host tunes the waveform to its own palette
// with a token, never a hard-coded literal (see the `theming` skill). The defaults read
// the same tokens the app has always used, so a caller that passes nothing looks identical.
const DEFAULT_ACCENT = '--accent'; // played-through bars
const DEFAULT_IDLE = '--audio-wave-idle'; // not-yet-played bars / track
// Last-resort fallbacks when a token cannot be resolved (no stylesheet loaded, e.g. a test):
// the exact colours these tokens carry in the dark theme, so the visual result is unchanged.
const FALLBACK_ACCENT = '#6c8cff';
const FALLBACK_IDLE = 'rgba(255, 255, 255, 0.16)';

export interface AudioPlayerOptions {
  /** Colour of the played-through portion of the waveform. A CSS colour, or a
   *  `--custom-property` name resolved off the player root. Default: `--accent`. */
  accent?: string;
  /** Colour of the not-yet-played (idle) bars / track. A CSS colour, or a
   *  `--custom-property` name. Default: the `--audio-wave-idle` theme token. */
  idle?: string;
}

// Resolve a colour spec: a `--token` is read off `root`; any other value is used verbatim.
// Falls back to `fallback` when a token resolves to nothing.
export function resolveWaveColor(root: HTMLElement, spec: string, fallback: string): string {
  const value = spec.startsWith('--') ? getComputedStyle(root).getPropertyValue(spec).trim() : spec.trim();
  return value || fallback;
}

// Decoded peaks keyed by src, so reopening a clip never decodes twice.
const peakCache = new Map<string, { base: Float32Array; duration: number }>();

const fmt = (s: number): string => {
  const sec = !isFinite(s) || s < 0 ? 0 : s;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};

// One pass over the samples → BASE_RES normalized peaks.
function basePeaksOf(channel: Float32Array): Float32Array {
  const n = Math.min(BASE_RES, channel.length || 1);
  const block = Math.floor(channel.length / n) || 1;
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    let p = 0;
    const start = i * block;
    for (let j = 0; j < block; j += 1) {
      const v = Math.abs(channel[start + j] || 0);
      if (v > p) p = v;
    }
    out[i] = p;
    if (p > max) max = p;
  }
  if (max > 0) for (let i = 0; i < n; i += 1) out[i] /= max;
  return out;
}

// Cheaply bucket the base peaks down to `n` bars.
function downsample(base: Float32Array, n: number): Float32Array {
  if (n >= base.length) return base;
  const out = new Float32Array(n);
  const block = base.length / n;
  for (let i = 0; i < n; i += 1) {
    let p = 0;
    const e = Math.floor((i + 1) * block);
    for (let j = Math.floor(i * block); j < e; j += 1) if (base[j] > p) p = base[j];
    out[i] = p;
  }
  return out;
}

export function createAudioPlayer(
  src: string,
  options: AudioPlayerOptions = {},
): {
  el: HTMLDivElement;
  audio: HTMLAudioElement;
  destroy: () => void;
} {
  const accentSpec = options.accent ?? DEFAULT_ACCENT;
  const idleSpec = options.idle ?? DEFAULT_IDLE;
  const audio = new Audio();
  audio.preload = 'metadata';

  const root = el('div', 'audio-player');
  const play = el('button', 'audio-play');
  play.type = 'button';
  play.innerHTML = PLAY;
  play.setAttribute('aria-label', 'Play');
  const canvas = el('canvas', 'audio-wave');
  const time = el('span', 'audio-time', '0:00');
  root.append(play, canvas, time);

  const ctx = canvas.getContext('2d')!;
  let base: Float32Array | null = null; // high-res normalized peaks
  let peaks: Float32Array | null = null; // bars at the current width
  let duration = 0;
  // Cached so we don't read getComputedStyle every frame; refreshed in layout().
  let accent = FALLBACK_ACCENT;
  let idle = FALLBACK_IDLE;

  const renderTime = (): void => {
    time.textContent = `${fmt(audio.currentTime)} / ${fmt(duration)}`;
  };

  function draw(): void {
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 44;
    ctx.clearRect(0, 0, w, h);
    if (!peaks) return;
    const mid = h / 2;
    const progress = duration ? audio.currentTime / duration : 0;
    for (let i = 0; i < peaks.length; i += 1) {
      const bh = Math.max(2, peaks[i] * (h - 2));
      ctx.fillStyle = i / peaks.length <= progress ? accent : idle;
      const x = i * (BAR + GAP);
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, mid - bh / 2, BAR, bh, 1);
        ctx.fill();
      } else {
        ctx.fillRect(x, mid - bh / 2, BAR, bh);
      }
    }
  }

  function layout(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 44;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    accent = resolveWaveColor(root, accentSpec, accent);
    idle = resolveWaveColor(root, idleSpec, idle);
    if (base) peaks = downsample(base, Math.max(8, Math.floor(w / (BAR + GAP))));
    draw();
  }

  const ro = new ResizeObserver(layout);
  ro.observe(canvas);

  audio.addEventListener('timeupdate', () => {
    renderTime();
    draw();
  });
  audio.addEventListener('play', () => {
    play.innerHTML = PAUSE;
    play.setAttribute('aria-label', 'Pause');
  });
  audio.addEventListener('pause', () => {
    play.innerHTML = PLAY;
    play.setAttribute('aria-label', 'Play');
  });
  audio.addEventListener('ended', draw);
  audio.addEventListener('loadedmetadata', () => {
    if (!duration && isFinite(audio.duration)) {
      duration = audio.duration;
      renderTime();
    }
  });

  play.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  const seekTo = (clientX: number): void => {
    if (!duration) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
    renderTime();
    draw();
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    seekTo(e.clientX);
    const move = (ev: PointerEvent): void => seekTo(ev.clientX);
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  audio.src = src;
  renderTime();

  const cached = peakCache.get(src);
  if (cached) {
    base = cached.base;
    duration = cached.duration;
    renderTime();
    layout();
  } else {
    // Decode once for the waveform + an accurate duration (independent of the
    // <audio>'s metadata, which is Infinity for MediaRecorder webm blobs).
    void (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const actx = new AC();
        const decoded = await actx.decodeAudioData(buf);
        actx.close();
        base = basePeaksOf(decoded.getChannelData(0));
        duration = decoded.duration;
        if (peakCache.size > 60) {
          const oldest = peakCache.keys().next().value;
          if (oldest !== undefined) peakCache.delete(oldest);
        }
        peakCache.set(src, { base, duration });
        renderTime();
        layout();
      } catch {
        /* no waveform — the play/pause + time still work */
      }
    })();
  }

  const destroy = (): void => {
    ro.disconnect();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };

  return { el: root, audio, destroy };
}
