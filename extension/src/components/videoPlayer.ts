// A compact, theme-matching video player — our own controls (play/pause, a
// clickable progress bar, time, fullscreen) instead of the browser's native ones.
// `src` is a URL string (e.g. an object URL); the caller owns its lifetime.
// Returns { el, video, destroy }.

import { el } from '../lib/dom.js';

const PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`;
const FULL = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
const VOL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"></path></svg>`;
const MUTE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"></path><path d="M22 9l-6 6M16 9l6 6"></path></svg>`;

const fmt = (s: number): string => {
  const sec = !isFinite(s) || s < 0 ? 0 : s;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};

export function createVideoPlayer(src: string): {
  el: HTMLDivElement;
  video: HTMLVideoElement;
  destroy: () => void;
} {
  const root = el('div', 'video-player');
  const video = Object.assign(el('video', 'video-frame'), {
    src: src || '',
    playsInline: true,
    preload: 'metadata',
  });
  const bar = el('div', 'video-bar');
  const play = el('button', 'video-btn');
  play.type = 'button';
  play.innerHTML = PLAY;
  play.setAttribute('aria-label', 'Play');
  const seek = el('div', 'video-seek');
  const fill = el('div', 'video-seek-fill');
  seek.append(fill);
  const time = el('span', 'video-time', '0:00 / 0:00');
  // Volume: a mute toggle plus a slider (0–1).
  const vol = el('div', 'video-vol');
  const volBtn = el('button', 'video-btn');
  volBtn.type = 'button';
  volBtn.innerHTML = VOL;
  volBtn.setAttribute('aria-label', 'Mute');
  const volSlider = Object.assign(el('input', 'video-vol-slider'), {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: '1',
  });
  volSlider.setAttribute('aria-label', 'Volume');
  vol.append(volBtn, volSlider);

  // Playback speed: cycles through common rates.
  const SPEEDS = [1, 1.25, 1.5, 2, 0.5];
  let speedIdx = 0;
  const speed = el('button', 'video-btn video-speed', '1×');
  speed.type = 'button';
  speed.setAttribute('aria-label', 'Playback speed');
  const applySpeed = (): void => {
    video.playbackRate = SPEEDS[speedIdx];
    speed.textContent = `${SPEEDS[speedIdx]}×`;
  };
  speed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    applySpeed();
  });

  const full = el('button', 'video-btn');
  full.type = 'button';
  full.innerHTML = FULL;
  full.setAttribute('aria-label', 'Fullscreen');
  bar.append(play, seek, time, vol, speed, full);
  root.append(video, bar);
  // Focusable so it can own keyboard shortcuts without hijacking the whole page.
  root.tabIndex = 0;

  // Keep the button icon, slider position, and accent fill in sync with the
  // <video>'s actual volume/muted state (whatever changes them).
  let lastVol = 1; // restore level when unmuting
  const renderVol = (): void => {
    const level = video.muted ? 0 : video.volume;
    volSlider.value = String(level);
    volSlider.style.setProperty('--fill', `${level * 100}%`);
    const off = level === 0;
    volBtn.innerHTML = off ? MUTE : VOL;
    volBtn.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
  };
  volSlider.addEventListener('input', () => {
    const v = Number(volSlider.value);
    video.muted = v === 0;
    video.volume = v;
    if (v > 0) lastVol = v;
  });
  const toggleMute = (): void => {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      video.volume = lastVol || 1;
    } else {
      lastVol = video.volume;
      video.muted = true;
    }
  };
  volBtn.addEventListener('click', toggleMute);
  video.addEventListener('volumechange', renderVol);

  let duration = 0;
  const render = (): void => {
    time.textContent = `${fmt(video.currentTime)} / ${fmt(duration)}`;
    fill.style.width = duration ? `${Math.min(100, (video.currentTime / duration) * 100)}%` : '0%';
  };
  const setDur = (d: number): void => {
    if (isFinite(d) && d > 0) {
      duration = d;
      render();
    }
  };

  // MediaRecorder webm blobs report duration = Infinity until played through;
  // nudge currentTime to force the browser to compute the real duration.
  video.addEventListener('loadedmetadata', () => {
    if (!isFinite(video.duration) || video.duration === 0) {
      const onSeek = (): void => {
        video.removeEventListener('timeupdate', onSeek);
        setDur(video.duration);
        video.currentTime = 0;
      };
      video.addEventListener('timeupdate', onSeek);
      try {
        video.currentTime = 1e101;
      } catch {
        /* ignore */
      }
    } else {
      setDur(video.duration);
    }
  });
  video.addEventListener('durationchange', () => setDur(video.duration));
  video.addEventListener('timeupdate', render);
  const setIcon = (): void => {
    play.innerHTML = video.paused ? PLAY : PAUSE;
    play.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
  };
  video.addEventListener('play', setIcon);
  video.addEventListener('pause', setIcon);

  const toggle = (): void => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };
  play.addEventListener('click', toggle);
  video.addEventListener('click', () => {
    root.focus(); // so keyboard shortcuts work after clicking the video
    toggle();
  });

  const toggleFull = (): void => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {});
  };

  // Keyboard shortcuts, scoped to the player (root is focusable). Skip when a
  // control with its own key behavior is focused (the volume slider's arrows).
  root.addEventListener('keydown', (e) => {
    if (e.target === volSlider) return;
    const seekBy = (d: number): void => {
      if (duration) video.currentTime = Math.min(duration, Math.max(0, video.currentTime + d));
      render();
    };
    switch (e.key) {
      case ' ':
      case 'k':
        if ((e.target as HTMLElement).tagName === 'BUTTON') return; // let Space activate a focused button
        e.preventDefault();
        toggle();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekBy(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekBy(5);
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'f':
      case 'F':
        toggleFull();
        break;
      default:
    }
  });

  const seekTo = (clientX: number): void => {
    if (!duration) return;
    const r = seek.getBoundingClientRect();
    video.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
    render();
  };
  seek.addEventListener('pointerdown', (e) => {
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

  full.addEventListener('click', toggleFull);

  render();
  renderVol();
  applySpeed();

  const destroy = (): void => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  return { el: root, video, destroy };
}
