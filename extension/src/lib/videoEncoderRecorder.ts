// Hardware-accelerated recording with WebCodecs (VideoEncoder/AudioEncoder) muxed
// to WebM with webm-muxer. This keeps encoding off the main thread (the GPU/codec
// does it), which avoids the software-encode bottleneck that made canvas +
// MediaRecorder lag and degrade over time. Falls back to MediaRecorder where
// WebCodecs isn't available (see createRecorder caller).
//
// Everything stays on-device: webm-muxer is pure JS, the encoders are the
// browser's — nothing is uploaded.

import { Muxer, ArrayBufferTarget } from 'webm-muxer';

// MediaStreamTrackProcessor is still experimental (not in the standard DOM lib).
interface MediaStreamTrackProcessorReader<T> {
  readonly readable: ReadableStream<T>;
}
declare const MediaStreamTrackProcessor: {
  new (init: { track: MediaStreamTrack }): MediaStreamTrackProcessorReader<AudioData>;
};

export const webcodecsSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'VideoEncoder' in window &&
  'AudioEncoder' in window &&
  'MediaStreamTrackProcessor' in window;

// The VP9 codec string must declare a *level* that covers the resolution/frame
// rate — too low a level (e.g. 1.0) makes the encoder clamp bitrate/quality hard
// (that's what looked low-res). Pick the smallest level whose luma sample-rate
// ceiling fits this stream.
function vp9Level(width: number, height: number, framerate: number): string {
  const rate = width * height * Math.max(1, framerate);
  const table: [number, string][] = [
    [829440, '10'],
    [2764800, '11'],
    [4608000, '20'],
    [9216000, '21'],
    [20736000, '30'],
    [36864000, '31'],
    [83558400, '40'],
    [160432128, '41'],
    [311951360, '50'],
    [588251136, '51'],
    [1176502272, '52'],
  ];
  for (const [max, lvl] of table) if (rate <= max) return lvl;
  return '60';
}

interface VideoCodecChoice {
  codec: string;
  mux: 'V_VP9' | 'V_VP8';
}

// Pick a WebCodecs video codec the browser can actually encode at this size.
async function pickVideoCodec(
  width: number,
  height: number,
  framerate: number,
  bitrate: number,
): Promise<VideoCodecChoice | null> {
  const candidates: VideoCodecChoice[] = [
    { codec: `vp09.00.${vp9Level(width, height, framerate)}.08`, mux: 'V_VP9' },
    { codec: 'vp8', mux: 'V_VP8' },
  ];
  for (const c of candidates) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width,
        height,
        framerate,
        bitrate,
      });
      if (supported) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

export interface RecorderOptions {
  canvas: HTMLCanvasElement;
  audioStream?: MediaStream | null;
  fps?: number;
  bitrate?: number;
}

export interface Recorder {
  addFrame: () => void;
  stop: () => Promise<Blob>;
  pause: () => void;
  resume: () => void;
}

// Create a recorder that pulls video frames from `canvas` (call addFrame() on your
// own cadence) and audio from `audioStream`. stop() resolves to a WebM Blob.
export async function createRecorder({
  canvas,
  audioStream,
  fps = 30,
  bitrate = 5_000_000,
}: RecorderOptions): Promise<Recorder> {
  const width = canvas.width;
  const height = canvas.height;
  const vc = await pickVideoCodec(width, height, fps, bitrate);
  if (!vc) throw new Error('No supported WebCodecs video codec');

  const audioTrack = audioStream?.getAudioTracks?.()[0] || null;
  const aSettings: MediaTrackSettings = audioTrack?.getSettings?.() || {};
  const sampleRate = aSettings.sampleRate || 48000;
  const channels = aSettings.channelCount || 2;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vc.mux, width, height, frameRate: fps },
    ...(audioTrack ? { audio: { codec: 'A_OPUS' as const, numberOfChannels: channels, sampleRate } } : {}),
    firstTimestampBehavior: 'offset',
  });

  let failure: DOMException | null = null;
  // Pause support: paused wall-clock time is removed from the output so the clip
  // stays gapless. The same integer-µs shift is subtracted from both video frame
  // timestamps and audio chunk timestamps, which preserves A/V sync (webm-muxer
  // applies its first-timestamp offset per track). Allocation-free: the no-pause
  // path subtracts 0 and never copies a frame.
  let paused = false;
  let pauseStart = 0;
  let pausedMs = 0;
  const shiftUs = (): number => Math.round(pausedMs * 1000);
  // Audio runs on its own monotonic timeline built from encoded-chunk durations
  // (NOT the input track clock, whose origin differs from the video clock). Paused
  // frames are never encoded, so this never advances across a pause → gapless and
  // always increasing, with no dependence on wall-clock offsets.
  let audioOutTs = 0;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  videoEncoder.configure({
    codec: vc.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'realtime',
  });

  let audioEncoder: AudioEncoder | null = null;
  let audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
  if (audioTrack) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta, audioOutTs);
        audioOutTs += chunk.duration && chunk.duration > 0 ? chunk.duration : 20000; // Opus packets are ~20ms
      },
      error: (e) => {
        failure = e;
      },
    });
    audioEncoder.configure({ codec: 'opus', numberOfChannels: channels, sampleRate, bitrate: 128_000 });
    const processor = new MediaStreamTrackProcessor({ track: audioTrack });
    audioReader = processor.readable.getReader();
    const reader = audioReader;
    const encoder = audioEncoder;
    void (async () => {
      try {
        for (;;) {
          const res = await reader.read();
          if (res.done) break;
          const value = res.value;
          // Discard (don't buffer) audio captured while paused.
          if (paused) {
            value.close();
            continue;
          }
          if (encoder.state === 'configured') encoder.encode(value);
          value.close();
        }
      } catch {
        /* reader cancelled on stop */
      }
    })();
  }

  const startNow = performance.now();
  let lastKeyUs = -1e12;
  let running = true;

  // Encode the current canvas as one frame. Drop frames if the encoder is behind
  // (bounded queue) so a backlog can never build up and compound.
  const addFrame = (): void => {
    if (paused) return; // drop frames while paused; the queue drains meanwhile
    if (!running || failure || videoEncoder.state !== 'configured') return;
    if (videoEncoder.encodeQueueSize > 2) return;
    const ts = Math.max(0, Math.round((performance.now() - startNow) * 1000) - shiftUs());
    const keyFrame = ts - lastKeyUs >= 2_000_000; // a keyframe every ~2s
    if (keyFrame) lastKeyUs = ts;
    const frame = new VideoFrame(canvas, { timestamp: ts });
    try {
      videoEncoder.encode(frame, { keyFrame });
    } finally {
      frame.close();
    }
  };

  const stop = async (): Promise<Blob> => {
    running = false;
    try {
      await videoEncoder.flush();
    } catch {
      /* ignore */
    }
    if (audioReader) {
      try {
        await audioReader.cancel();
      } catch {
        /* ignore */
      }
    }
    if (audioEncoder) {
      try {
        await audioEncoder.flush();
      } catch {
        /* ignore */
      }
    }
    muxer.finalize();
    try {
      videoEncoder.close();
      audioEncoder?.close();
    } catch {
      /* ignore */
    }
    if (failure) throw failure;
    return new Blob([muxer.target.buffer], { type: 'video/webm' });
  };

  const pause = (): void => {
    if (running && !paused) {
      paused = true;
      pauseStart = performance.now();
    }
  };
  const resume = (): void => {
    if (running && paused) {
      pausedMs += performance.now() - pauseStart;
      paused = false;
    }
  };

  return { addFrame, stop, pause, resume };
}
