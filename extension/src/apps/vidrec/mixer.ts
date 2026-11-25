// Video Recorder's compositing + audio-remux engine, split out of index.js. These
// are pure, self-contained media helpers (no app/UI state): the live canvas mixer
// that the studio records from, and the post-recording audio re-mux used when
// "Reduce noise" is on.

import { el } from '../../lib/dom.js';
import { createFrameClock } from './frameClock.js';
import { audioPosition, resyncOffset } from './avSync.js';

// HTMLMediaElement.captureStream isn't in the standard DOM lib yet.
type Capturable = HTMLVideoElement & { captureStream: () => MediaStream };

// Prefer VP8 — its software encoder is much lighter than VP9, which matters for
// real-time screen+camera capture (VP9 can saturate the CPU and stall the UI).
const VIDEO_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
export const pickVideoType = (): string => VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';

export const FPS = 30; // frame-rate cap — drawing/encoding every frame is the main-thread cost

// --- the camera bubble ---------------------------------------------------
// The camera drawn over the shared screen. Everything about it is live state the
// draw loop reads, so it can be changed mid-recording (see setBubble below).

export const CAM_CORNERS = ['br', 'bl', 'tr', 'tl'] as const;
export const CAM_SHAPES = ['square', 'circle'] as const;
export const CAM_SIZES = ['sm', 'md', 'lg'] as const;
export type CamCorner = (typeof CAM_CORNERS)[number];
export type CamShape = (typeof CAM_SHAPES)[number];
export type CamSize = (typeof CAM_SIZES)[number];

/** How the bubble looks: where it sits, its outline, and how big it is. */
export interface BubbleStyle {
  corner: CamCorner;
  shape: CamShape;
  size: CamSize;
}
/** The bubble's full live state — its look plus whether it is drawn at all. */
export interface BubbleState extends BubbleStyle {
  visible: boolean;
}

export const BUBBLE_DEFAULTS: BubbleState = { corner: 'br', shape: 'square', size: 'md', visible: true };

/** Bubble width as a fraction of the frame width. `md` is the historical 24%. */
const SIZE_FRACTION: Record<CamSize, number> = { sm: 0.16, md: 0.24, lg: 0.32 };
/** Gap between the bubble and the frame edge, as a fraction of the frame width. */
const MARGIN_FRACTION = 0.022;
/** Camera aspect (height / width) assumed before the video reports its size. */
const FALLBACK_ASPECT = 0.5625;
/** A square bubble's corner rounding, as a fraction of its width. */
const SQUARE_RADIUS_FRACTION = 0.08;

/** Where the bubble is drawn, and the radius its clip path is rounded by. */
export interface BubbleRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius of the clip: half the width for a circle, a soft corner otherwise. */
  r: number;
}

/** A source rectangle to sample from, so a picture fills a box without stretching. */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// The centred source rectangle that covers a dw x dh box: trim the overhanging
// dimension rather than squash the picture into the box's aspect. A circular
// bubble is square, so without this a 16:9 camera would come out as an oval face.
export function coverCrop(srcW: number, srcH: number, dw: number, dh: number): CropRect {
  if (!srcW || !srcH || !dw || !dh) return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  const scale = Math.max(dw / srcW, dh / srcH);
  const sw = Math.min(srcW, dw / scale);
  const sh = Math.min(srcH, dh / scale);
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

// Bubble geometry, kept pure so the corner arithmetic, the aspect and the clip
// radius are testable without a canvas (mixer.test.ts). An unknown size or shape
// falls back to the default rather than producing a NaN box — stored settings can
// come from an old backup.
export function bubbleRect(frameW: number, frameH: number, camW: number, camH: number, style: BubbleStyle): BubbleRect {
  const circle = style.shape === 'circle';
  const m = Math.round(frameW * MARGIN_FRACTION);
  // A circle is a SQUARE box (aspect 1) with the camera cover-cropped into it —
  // that is what keeps it a circle instead of an oval, and why the camera's own
  // aspect does not size it.
  const aspect = circle ? 1 : camW > 0 && camH > 0 ? camH / camW : FALLBACK_ASPECT;
  const maxH = Math.max(1, frameH - 2 * m);
  let w = Math.round(frameW * (SIZE_FRACTION[style.size] ?? SIZE_FRACTION[BUBBLE_DEFAULTS.size]));
  let h = Math.max(1, Math.round(w * aspect));
  // Shrink to fit rather than hang off an edge. A tall camera at the largest size is
  // already taller than the frame — a portrait webcam is 16:9 the other way up, so at
  // 32% of a 1280x720 frame's width it is 410 wide and 729 tall against 720 of frame,
  // before margins. The aspect (so also a circle's squareness) survives the clamp.
  // Only the height needs it: the widest size is 32% of the frame width.
  //
  // The bound leaves the margin on BOTH edges, not just the one the bubble is pinned
  // to — a bubble clamped flush against the opposite edge reads as a mistake.
  //
  // `floor`, and the second `min`, are what make that hold for EVERY aspect and not
  // just plausible ones. Rounding the clamped width back up re-inflates the height
  // past the bound it was just held to, and for an aspect steeper than the frame no
  // integer width fits at all — at which point a box inside the frame beats one that
  // keeps its proportions, since coverCrop fills it either way.
  if (h > maxH) {
    w = Math.max(1, Math.floor(maxH / aspect));
    h = Math.max(1, Math.min(maxH, Math.round(w * aspect)));
  }
  return {
    x: style.corner.includes('r') ? frameW - w - m : m,
    y: style.corner.includes('b') ? frameH - h - m : m,
    w,
    h,
    // Never rounder than a half-circle end-cap. Canvas would scale an oversized
    // radius down itself, but a rect whose radius contradicts its own size is not
    // worth handing out — a very flat box would claim corners bigger than it is.
    r: circle ? w / 2 : Math.min(Math.round(w * SQUARE_RADIUS_FRACTION), Math.min(w, h) / 2),
  };
}

interface MixerOptions {
  w: number;
  h: number;
  bubble?: Partial<BubbleState>;
  mirror?: boolean;
  screenAudio?: boolean;
}

// A persistent compositor: one canvas video track + one mixed-audio track (both
// stable for the whole session), with the camera/screen/mic inputs swappable live.
export function createMixer({ w, h, bubble, mirror = true, screenAudio = true }: MixerOptions) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d', { alpha: false })!;
  const holder = el('div', 'vid-offscreen');
  document.body.append(holder);
  const Ctx = window.AudioContext || window.webkitAudioContext!;
  const audioCtx = new Ctx();
  const dest = audioCtx.createMediaStreamDestination();

  let sv: HTMLVideoElement | null = null;
  let cv: HTMLVideoElement | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let scrNode: MediaStreamAudioSourceNode | null = null;
  let scrTracks: MediaStreamTrack[] | null = null; // screen audio tracks, (dis)connected live
  let mirrorOn = mirror;
  let screenAudioOn = screenAudio;
  let bubbleState: BubbleState = { ...BUBBLE_DEFAULTS, ...bubble };

  const mkVideo = (stream: MediaStream): HTMLVideoElement => {
    const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    v.srcObject = stream;
    holder.append(v);
    v.play().catch(() => {});
    return v;
  };
  const drawContain = (img: HTMLVideoElement): void => {
    const s = Math.min(w / img.videoWidth, h / img.videoHeight);
    const dw = img.videoWidth * s;
    const dh = img.videoHeight * s;
    cx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };
  // Camera draw: cover-cropped into the box (never squashed), mirrored by default
  // and as-is when the user turns mirror off.
  const drawCam = (img: HTMLVideoElement, x: number, y: number, dw: number, dh: number): void => {
    const c = coverCrop(img.videoWidth, img.videoHeight, dw, dh);
    if (!mirrorOn) return cx.drawImage(img, c.sx, c.sy, c.sw, c.sh, x, y, dw, dh);
    cx.save();
    cx.translate(x + dw, y);
    cx.scale(-1, 1);
    cx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, dw, dh);
    cx.restore();
  };

  // The canvas IS the live preview (shown directly in the DOM). `onDraw` fires
  // after each draw so the recorder can grab a frame in lockstep.
  //
  // The clock is a WORKER, not requestAnimationFrame. rAF is suspended in a hidden tab, and a tab
  // sharing its screen is hidden by definition — so the draw loop stalled, the canvas stopped
  // updating, and the recording captured from it froze for exactly as long as the user was away
  // (#276). A worker's timers are not throttled. See frameClock.ts.
  let onDraw: (() => void) | null = null;
  const draw = (): void => {
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, w, h);
    if (sv && sv.videoWidth) drawContain(sv);
    if (cv && cv.videoWidth) {
      if (sv) {
        // Over the screen: the bubble. Hiding it keeps the camera live (it is still
        // the mixer's input) but leaves it out of the frame — which is not the same
        // thing as turning the camera off.
        if (bubbleState.visible) {
          const b = bubbleRect(w, h, cv.videoWidth, cv.videoHeight, bubbleState);
          cx.save();
          cx.beginPath();
          // roundRect covers both shapes: a circle is a square box rounded by half
          // its width. Guarded because a canvas mock may not implement it.
          if (cx.roundRect) cx.roundRect(b.x, b.y, b.w, b.h, b.r);
          else cx.rect(b.x, b.y, b.w, b.h);
          cx.clip();
          drawCam(cv, b.x, b.y, b.w, b.h);
          cx.restore();
        }
      } else {
        drawCam(cv, 0, 0, w, h); // on its own: fill the frame
      }
    }
    onDraw?.();
  };
  const clock = createFrameClock(FPS, draw);

  return {
    canvas,
    audioStream: dest.stream,
    sampleRate: audioCtx.sampleRate,
    setOnDraw: (fn: () => void): void => {
      onDraw = fn;
    },
    // MediaStream of the composite, for the MediaRecorder fallback only.
    fallbackStream: (): MediaStream =>
      new MediaStream([canvas.captureStream(FPS).getVideoTracks()[0], dest.stream.getAudioTracks()[0]]),
    resume: (): void => void audioCtx.resume?.().catch(() => {}),
    setScreen(stream: MediaStream | null): void {
      if (scrNode) {
        scrNode.disconnect();
        scrNode = null;
      }
      if (sv) {
        sv.srcObject = null;
        sv.remove();
        sv = null;
      }
      scrTracks = null;
      if (stream) {
        sv = mkVideo(stream);
        const at = stream.getAudioTracks();
        if (at.length) {
          scrTracks = at;
          if (screenAudioOn) {
            scrNode = audioCtx.createMediaStreamSource(new MediaStream(at));
            scrNode.connect(dest);
          }
        }
      }
    },
    // Mirror the camera or not, live (no re-acquire).
    setMirror(on: boolean): void {
      mirrorOn = on;
    },
    // Move, reshape, resize or hide the camera bubble, live. Like setMirror, this
    // only sets state the draw loop reads on its next tick — nothing is re-acquired
    // and no track changes, so it is safe mid-recording (which is the point: the
    // studio's controls stay operable while the clip is running).
    setBubble(patch: Partial<BubbleState>): void {
      bubbleState = { ...bubbleState, ...patch };
    },
    // Include/exclude the screen's system/tab audio, live, by (dis)connecting its node.
    setScreenAudio(on: boolean): void {
      screenAudioOn = on;
      if (!on && scrNode) {
        scrNode.disconnect();
        scrNode = null;
      } else if (on && !scrNode && scrTracks?.length) {
        scrNode = audioCtx.createMediaStreamSource(new MediaStream(scrTracks));
        scrNode.connect(dest);
      }
    },
    setCamera(stream: MediaStream | null): void {
      if (cv) {
        cv.srcObject = null;
        cv.remove();
        cv = null;
      }
      if (stream) cv = mkVideo(stream);
    },
    setMic(stream: MediaStream | null): void {
      if (micNode) {
        micNode.disconnect();
        micNode = null;
      }
      if (stream) {
        const at = stream.getAudioTracks();
        if (at.length) {
          micNode = audioCtx.createMediaStreamSource(new MediaStream(at));
          micNode.connect(dest);
        }
      }
    },
    stop(): void {
      clock.stop(); // terminates the ticking worker (or cancels the rAF fallback)
      holder.remove();
      audioCtx.close().catch(() => {});
    },
    /** True when the clock survives a hidden tab. False means we fell back to rAF and the
     *  recording WILL freeze while the tab is hidden — the caller can warn rather than lie. */
    resilient: (): boolean => clock.resilient,
  };
}

// Re-mux a recorded video with a cleaned audio track. Browsers can't swap an audio
// track in-place, so we play the clip back (video only) while feeding the cleaned
// audio, and re-record the pair. Resolves to the new webm Blob.
export function remuxWithAudio(
  videoBlob: Blob,
  wavBlob: Blob,
  bps: number,
  onProgress?: (p: { phase: string; label: string; ratio: number }) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(videoBlob);
    const v = Object.assign(document.createElement('video'), { src: url, muted: true, playsInline: true });
    const Ctx = window.AudioContext || window.webkitAudioContext!;
    const ctx = new Ctx();
    let settled = false;
    // Set once the progress clock exists. cleanup() is the one path every outcome goes through
    // — resolve, reject and error — so stopping it here is what guarantees the worker cannot
    // outlive the re-mux.
    let stopProgress: (() => void) | null = null;
    const cleanup = (): void => {
      stopProgress?.();
      stopProgress = null;
      ctx.close().catch(() => {});
      URL.revokeObjectURL(url);
    };
    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    v.onerror = () => fail(new Error('playback failed'));
    v.onloadedmetadata = async () => {
      try {
        const audioBuf = await ctx.decodeAudioData(await wavBlob.arrayBuffer());
        const dest = ctx.createMediaStreamDestination();
        // The audio is restarted at the video's position whenever the two drift apart (see
        // avSync.ts) — the video is the master, because it is the one that stalls.
        let srcNode: AudioBufferSourceNode | null = null;
        let audioOffset = 0;
        let audioStartedAt = 0;
        const startAudio = (offset: number): void => {
          if (srcNode) {
            srcNode.onended = null;
            try {
              srcNode.stop();
            } catch {
              /* already stopped */
            }
            srcNode.disconnect();
            srcNode = null;
          }
          if (offset >= audioBuf.duration) return;
          const node = ctx.createBufferSource();
          node.buffer = audioBuf;
          node.connect(dest);
          node.start(0, offset);
          srcNode = node;
          audioOffset = offset;
          audioStartedAt = ctx.currentTime;
        };

        const vTrack = (v as Capturable).captureStream().getVideoTracks()[0];
        const out = new MediaStream([vTrack, dest.stream.getAudioTracks()[0]]);
        const rec = new MediaRecorder(out, { mimeType: pickVideoType(), videoBitsPerSecond: bps });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
        };

        const dur = v.duration || 0;
        // The progress readout is driven by the worker clock, not rAF. rAF is suspended in a
        // hidden tab, so switching away mid-re-mux froze the bar and then snapped it to done
        // (#335) — the same "a clock that stops when you look away" defect #276 fixed for the
        // live compositor, in the same file.
        //
        // Only the READOUT is affected: the re-mux completes on `v.onended -> rec.stop()`, and
        // its frames come from `v.captureStream()`, neither of which is rAF. A few updates a
        // second is plenty for a progress bar.
        const progressClock = createFrameClock(10, () => {
          if (settled) return;
          if (srcNode && !v.paused) {
            const to = resyncOffset(
              v.currentTime,
              audioPosition(audioOffset, audioStartedAt, ctx.currentTime),
              audioBuf.duration,
            );
            if (to !== null) startAudio(to);
          }
          if (!dur) return;
          onProgress?.({ phase: 'run', label: 'Adding cleaned audio', ratio: Math.min(1, v.currentTime / dur) });
        });
        stopProgress = () => progressClock.stop();

        v.onended = () => rec.stop();
        rec.start();
        await v.play();
        startAudio(v.currentTime);
      } catch (e) {
        fail(e);
      }
    };
  });
}
