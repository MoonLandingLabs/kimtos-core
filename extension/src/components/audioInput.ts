// Reusable audio input: drag-and-drop / click to upload, or record — from the
// microphone, from the system's own audio, or from both at once — with a live
// timer. Shows the chosen clip in a small player card. Any audio app can reuse
// this; it just holds the current clip and fires `change`.

import { createAudioPlayer } from './audioPlayer.js';
import { explainDeviceProblem } from './deviceProblem.js';
import { MIC, UPLOAD } from './icons.js';
import { formatSize, formatTime } from '../lib/format.js';
import { getAppValue, setAppConfig } from '../lib/appConfig.js';
import {
  acquireMic,
  acquireScreen,
  blockedProblem,
  DeviceError,
  permissionState,
  problemLine,
  supportsSystemAudio,
} from '../lib/devicePermission.js';

const AUDIO_EXTS = ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'opus', 'weba'];

// "System audio" icon (a monitor) for the recording-source chooser.
const SYSTEM_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>`;

// Spread this into any recording app's `settings` array — the two switches show up
// in Settings ▸ Apps and store per app. Pair them with appRecSource(appId) below.
//
// TWO independent switches, not one either/or choice. The old single "Recording
// source" select welded system audio to the microphone, so a blocked or missing mic
// took down a recording that needed no mic at all — capturing a meeting playing in
// another window, say (#1327). All four combinations are valid; both off means there
// is nothing to record, and the Record button says so.
export const REC_SOURCE_SETTINGS = [
  {
    key: 'recMic',
    label: 'Record my microphone',
    hint: 'Capture your voice. You can also switch this on and off each time you record.',
    type: 'toggle',
    default: true,
  },
  {
    key: 'recSystem',
    label: 'Record system audio',
    hint: 'Capture what your computer is playing, so you get the other side of a call. On macOS Chrome can capture a tab’s audio but not another application’s.',
    type: 'toggle',
    default: false,
  },
];

// Wire the recorder to an app's own stored recording-source choices.
export const appRecSource = (appId: string) => ({
  getMic: () => getAppValue(appId, 'recMic', true) !== false,
  getSystem: () => getAppValue(appId, 'recSystem', false) === true,
  onPickMic: (on: boolean) => setAppConfig(appId, 'recMic', on),
  onPickSystem: (on: boolean) => setAppConfig(appId, 'recSystem', on),
});

// True only for audio files. A .webm picked from disk is usually video, so we
// rely on the MIME type first and fall back to the extension.
function isAudioFile(file: File): boolean {
  const type = file.type || '';
  if (type.startsWith('audio/')) return true;
  if (type.startsWith('video/')) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return AUDIO_EXTS.includes(ext);
}

export interface AudioInputOptions {
  /** The remembered choices (optional; both default to mic-only). */
  getMic?: () => boolean;
  getSystem?: () => boolean;
  /** Persist a choice the user made before recording (per-app; optional). */
  onPickMic?: (on: boolean) => void;
  onPickSystem?: (on: boolean) => void;
}

export function createAudioInput({ getMic, getSystem, onPickMic, onPickSystem }: AudioInputOptions = {}) {
  let blob: Blob | null = null;
  let filename = 'audio.webm';
  let clipFrom: string | null = null; // which app this clip was handed over from
  let clipJob: string | null = null; // the handoff job id, so processing can be reported back
  let clipSrcId: string | null = null; // the source record's id, so results can be traced back

  const el = document.createElement('div');
  el.className = 'audio-input';

  // Dropzone (click + drag/drop)
  const dropzone = document.createElement('button');
  dropzone.type = 'button';
  dropzone.className = 'dropzone';
  dropzone.innerHTML = `
    ${UPLOAD}
    <span class="dropzone-title">Drop a voice note here, or click to browse</span>
    <span class="dropzone-hint">MP3, OGG, WAV, M4A, AAC or FLAC</span>`;

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.mp3,.ogg,.oga,.wav,.m4a,.aac,.flac,.opus,.weba,audio/*';
  file.hidden = true;

  // Validation error line (e.g. a video file was picked).
  const error = document.createElement('p');
  error.className = 'app-error';
  error.hidden = true;

  // "or" divider
  const divider = document.createElement('div');
  divider.className = 'audio-or';
  divider.innerHTML = '<span>or</span>';

  // Record row: two independent source switches (Mic, System) + the record button.
  // Recording starts immediately with the remembered sources — no popup.
  let micOn = getMic?.() ?? true; // the remembered CHOICE, not what is live right now
  let systemOn = getSystem?.() ?? false;
  let micLive = false; // this leg was acquired for the take in progress
  let systemLive = false;
  let micEnabled = true; // muted/unmuted mid-take; reset when the take ends
  let systemEnabled = true;
  let micBlocked = false; // the pre-flight found the mic denied before we ever asked

  const recordRow = document.createElement('div');
  recordRow.className = 'record-row';

  const sourceToggle = document.createElement('div');
  sourceToggle.className = 'rec-source-toggle';
  sourceToggle.setAttribute('role', 'group');
  sourceToggle.setAttribute('aria-label', 'Recording sources');

  const isRecording = (): boolean => Boolean(recorder && recorder.state === 'recording');

  // One switch. Before a take it picks whether the source is used (and remembers
  // that); during a take it mutes and unmutes the leg via `track.enabled`, so a
  // source can be dropped without ending the recording. A leg that was not acquired
  // cannot be added mid-take — the mix is already wired — so its switch is disabled.
  const seg = (icon: string, labelText: string, onToggle: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rec-source-seg';
    b.innerHTML = `${icon}<span>${labelText}</span>`;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      onToggle();
      updateToggle();
    });
    return b;
  };
  const segMic = seg(MIC, 'Mic', () => {
    if (isRecording()) {
      micEnabled = !micEnabled;
      setLegEnabled('mic', micEnabled);
      return;
    }
    micOn = !micOn;
    onPickMic?.(micOn); // remember per app (also reflected in Settings)
  });
  const segSys = seg(SYSTEM_ICON, 'System', () => {
    if (isRecording()) {
      systemEnabled = !systemEnabled;
      setLegEnabled('system', systemEnabled);
      return;
    }
    systemOn = !systemOn;
    onPickSystem?.(systemOn);
  });
  sourceToggle.append(segMic, segSys);

  const recordBtn = document.createElement('button');
  recordBtn.type = 'button';
  recordBtn.className = 'button-secondary record-btn';
  recordBtn.innerHTML = `${MIC}<span>Record a voice note</span>`;
  const timer = document.createElement('span');
  timer.className = 'record-timer';
  timer.hidden = true;
  recordRow.append(sourceToggle, recordBtn, timer);

  // The one line under the row that says what the current choice means: why Record
  // is unavailable, what a blocked mic needs, what System audio will and will not
  // capture on this platform.
  const recordHint = document.createElement('p');
  recordHint.className = 'rec-source-hint';

  const recordArea = document.createElement('div');
  recordArea.className = 'record-area';
  recordArea.append(recordRow, recordHint);

  const SHARE_TIP = 'Pick a tab or screen and tick “Share tab audio” to capture the other side.';
  const MACOS_TIP = 'On macOS Chrome can capture a tab’s audio, but not another application’s.';

  // What the hint says, in priority order — the thing that stops the user first.
  function hintText(): string {
    if (isRecording()) {
      if (!(micLive && micEnabled) && !(systemLive && systemEnabled)) {
        return 'Every source is muted — nothing is being captured right now.';
      }
      return 'Tap a source to mute it without ending the recording.';
    }
    if (!micOn && !systemOn) return 'Pick at least one source — Mic, System audio, or both.';
    if (micBlocked && micOn) return problemLine(blockedProblem('microphone', 'browser'));
    if (systemOn) return supportsSystemAudio() ? SHARE_TIP : `${SHARE_TIP} ${MACOS_TIP}`;
    return '';
  }

  function updateToggle(): void {
    const recording = isRecording();
    for (const [btn, on, live, enabled, noun] of [
      [segMic, micOn, micLive, micEnabled, 'microphone'],
      [segSys, systemOn, systemLive, systemEnabled, 'system audio'],
    ] as const) {
      const active = recording ? live && enabled : on;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      // Mid-take a source that was never acquired cannot join the mix, so the switch
      // is off-limits rather than silently doing nothing.
      btn.disabled = recording && !live;
      btn.title = btn.disabled
        ? `Turn ${noun} on before you start recording to include it`
        : recording
          ? `${active ? 'Mute' : 'Unmute'} ${noun}`
          : `${active ? 'Do not record' : 'Record'} ${noun}`;
    }
    recordBtn.disabled = !recording && !micOn && !systemOn;
    const hint = hintText();
    recordHint.textContent = hint;
    recordHint.hidden = !hint;
  }

  // Clip card (shown once a clip exists) — uses the themed waveform player.
  const clip = document.createElement('div');
  clip.className = 'audio-clip';
  clip.hidden = true;
  const playerHost = document.createElement('div');
  playerHost.className = 'audio-clip-player';
  let activePlayer: ReturnType<typeof createAudioPlayer> | null = null;
  const clipMeta = document.createElement('div');
  clipMeta.className = 'audio-clip-meta';
  const clipName = document.createElement('span');
  clipName.className = 'audio-clip-name';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-button';
  remove.textContent = 'Remove';
  clipMeta.append(clipName, remove);
  clip.append(playerHost, clipMeta);

  const tearDownPlayer = (): void => {
    activePlayer?.destroy();
    activePlayer = null;
    playerHost.replaceChildren();
  };

  function showInputMode(): void {
    dropzone.hidden = false;
    divider.hidden = false;
    recordArea.hidden = false;
    clip.hidden = true;
  }

  let objectUrl: string | null = null;

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  function clearError(): void {
    error.hidden = true;
  }

  function handleFile(f: File): void {
    clipFrom = null; // a freshly picked/dropped file has no provenance
    clipJob = null;
    clipSrcId = null;
    if (isAudioFile(f)) {
      setClip(f, f.name);
    } else {
      showError('That looks like a video or unsupported file. Pick an audio file (MP3, OGG, WAV, M4A, AAC, FLAC).');
    }
  }

  function setClip(newBlob: Blob, name: string): void {
    clearError();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    blob = newBlob;
    filename = name;
    objectUrl = URL.createObjectURL(newBlob);
    tearDownPlayer();
    activePlayer = createAudioPlayer(objectUrl);
    playerHost.append(activePlayer.el);
    clipName.textContent = newBlob.size ? `${name} · ${formatSize(newBlob.size)}` : name;
    dropzone.hidden = true;
    divider.hidden = true;
    recordArea.hidden = true;
    clip.hidden = false;
    el.dispatchEvent(new CustomEvent('change'));
  }

  function reset(): void {
    // Stop any playback before clearing the clip.
    tearDownPlayer();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    blob = null;
    clipFrom = null;
    clipJob = null;
    clipSrcId = null;
    clearError();
    showInputMode();
    el.dispatchEvent(new CustomEvent('change'));
  }

  // Upload
  dropzone.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) handleFile(f);
    file.value = ''; // allow re-picking the same file after an error
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  // Record
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let recStreams: MediaStream[] = []; // every MediaStream we must stop afterwards (mic, display)
  let audioCtx: AudioContext | null = null; // mixer, used only for system + mic
  let starting = false; // a start is in flight (awaiting permission) — don't start a second
  let destroyed = false; // the control was torn down; never touch the DOM or the mic again

  // The switches stay live through a take — they mute and unmute instead of picking
  // (see `seg`), so a source can be dropped mid-recording without ending it.
  const setRecordingUI = (on: boolean): void => {
    timer.hidden = !on;
    recordBtn.classList.toggle('is-recording', on);
    const span = recordBtn.querySelector('span');
    if (span) span.textContent = on ? 'Stop recording' : 'Record a voice note';
    if (on) {
      timer.textContent = '0:00';
    } else {
      if (ticker) clearInterval(ticker);
      ticker = null;
      micLive = systemLive = false;
      micEnabled = systemEnabled = true; // a mute lasts for the take, not for the next one
    }
    updateToggle();
  };

  // A capture we are recording FROM, plus what to tell the user if it dies.
  interface RecSource {
    track: MediaStreamTrack;
    reason: string;
  }

  const MIC_ENDED = 'Recording stopped — the microphone became unavailable.';
  const SHARE_ENDED = 'Recording stopped — screen sharing ended, so there was nothing left to capture.';

  let watched: RecSource[] = []; // sources currently watched for `ended`
  let stopReason: string | null = null; // why we stopped, shown once the clip is in

  const unwatchSources = (): void => {
    watched.forEach((s) => (s.track.onended = null));
    watched = [];
  };

  // The tracks behind each switch, so a leg can be muted mid-take. `enabled` is the
  // right lever: the track stays in the mix and keeps its place, it just delivers
  // silence, so unmuting is instant and needs no re-acquire (the same thing vidrec
  // does for its mic).
  const legTracks: { mic: MediaStreamTrack[]; system: MediaStreamTrack[] } = { mic: [], system: [] };

  function setLegEnabled(leg: 'mic' | 'system', on: boolean): void {
    legTracks[leg].forEach((t) => {
      t.enabled = on;
    });
  }

  const stopStreams = (): void => {
    unwatchSources();
    recStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    recStreams = [];
    legTracks.mic = [];
    legTracks.system = [];
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  // Build the stream to record from the chosen sources — either, or both.
  //
  // System audio comes from getDisplayMedia (the user ticks "Share audio" in Chrome's
  // picker) and the microphone from getUserMedia; only when BOTH are wanted is an
  // AudioContext used to mix them. System-only therefore never touches getUserMedia,
  // which is the whole point: capturing a meeting playing in another window needs no
  // microphone, and used to fail outright when the mic was blocked or absent (#1327).
  //
  // Returns the stream to record AND the source tracks to watch. When mixing, those
  // differ: the recorded stream is the mixer's output, which never ends, while the
  // captures that can die under us are the display/mic tracks feeding it.
  async function buildStream(
    useMic: boolean,
    useSystem: boolean,
  ): Promise<{
    stream: MediaStream;
    sources: RecSource[];
  }> {
    const sources: RecSource[] = [];
    let sysTracks: MediaStreamTrack[] = [];
    let micTracks: MediaStreamTrack[] = [];

    // The screen picker first: it needs the transient activation from the Record
    // click, which a permission prompt in front of it could outlive.
    if (useSystem) {
      // video:true is required to be offered audio at all; systemAudio:'include'
      // nudges Chrome to prefer capturing the audio. The user still ticks
      // "Share tab audio" / "Share system audio" in the picker. (Extra hints are
      // ignored by browsers that don't support them.)
      const display = await acquireScreen({
        video: true,
        audio: true,
        systemAudio: 'include',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions);
      recStreams.push(display);
      display.getVideoTracks().forEach((t) => t.stop()); // we only want the audio
      sysTracks = display.getAudioTracks();
      if (!sysTracks.length) throw new Error('no-system-audio');
      sources.push(...sysTracks.map((track) => ({ track, reason: SHARE_ENDED })));
    }
    if (useMic) {
      const mic = await acquireMic();
      recStreams.push(mic);
      micTracks = mic.getAudioTracks();
      sources.push(...micTracks.map((track) => ({ track, reason: MIC_ENDED })));
    }
    legTracks.system = sysTracks;
    legTracks.mic = micTracks;

    if (sysTracks.length && micTracks.length) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(new MediaStream(sysTracks)).connect(dest);
      audioCtx.createMediaStreamSource(new MediaStream(micTracks)).connect(dest);
      return { stream: dest.stream, sources };
    }
    // One leg: record it as it is — a mixer with a single input would only add an
    // AudioContext to keep alive for nothing.
    return { stream: new MediaStream(sysTracks.length ? sysTracks : micTracks), sources };
  }

  // A capture track can die while we are still recording: the user presses
  // Chrome's "Stop sharing" bar, another app grabs the microphone, the device is
  // unplugged. The MediaRecorder does not care — it keeps writing, and what lands
  // is a perfectly valid audio file with no sound in it (#805). Watch the sources
  // and end the recording ourselves, keeping whatever was captured before the
  // source went away and saying why it stopped. `stopReason` (not showError) is
  // how the message survives: setClip clears the error line as it renders the clip.
  function watchSources(sources: RecSource[]): void {
    unwatchSources();
    watched = sources;
    for (const s of sources) {
      s.track.onended = (): void => {
        if (!recorder || recorder.state !== 'recording') return;
        stopReason = s.reason;
        recorder.stop(); // onstop keeps the audio captured up to this point
      };
    }
  }

  async function startRecording(useMic: boolean, useSystem: boolean): Promise<void> {
    if (starting || isRecording() || (!useMic && !useSystem)) return;
    starting = true;
    stopReason = null;
    clearError();
    try {
      const { stream, sources } = await buildStream(useMic, useSystem);
      // Torn down while we waited on the permission prompt: release the capture
      // we were just granted instead of recording into a detached control.
      if (destroyed) {
        stopStreams();
        return;
      }
      // A source that is already dead never fires `ended`, so it would slip past
      // the watchdog below and we would record silence anyway. Refuse to start.
      if (sources.some((s) => s.track.readyState === 'ended')) throw new Error('source-ended');
      const rec = new MediaRecorder(stream);
      recorder = rec;
      chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stopStreams();
        setRecordingUI(false);
        if (recorder === rec) recorder = null;
        clipFrom = null; // a freshly recorded clip has no provenance
        clipJob = null;
        clipSrcId = null;
        const recorded = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        chunks = [];
        // An empty capture is not a clip: offering a 0-byte "recording.webm" only
        // lets the user run it and hit a decode error further down.
        if (recorded.size) setClip(recorded, 'recording.webm');
        else reset();
        // setClip/reset both clear the error line, so the reason goes back up after.
        if (stopReason) {
          showError(stopReason);
          stopReason = null;
        } else if (!recorded.size) {
          showError('Nothing was recorded — the audio source sent no data.');
        }
      };
      rec.start();
      watchSources(sources);
      startedAt = Date.now();
      micLive = legTracks.mic.length > 0;
      systemLive = legTracks.system.length > 0;
      if (micLive) micBlocked = false; // the pre-flight's warning is out of date
      micEnabled = systemEnabled = true;
      setRecordingUI(true);
      ticker = setInterval(() => {
        timer.textContent = formatTime(Date.now() - startedAt);
      }, 250);
    } catch (err) {
      stopStreams();
      recorder = null;
      setRecordingUI(false);
      if (destroyed) return;
      // The error line, not the timer: a refusal now carries the setting to change,
      // which is a sentence, and the timer is a slot for "0:07".
      if (err instanceof DeviceError) {
        showError(problemLine(err.problem));
        // A block is the one failure the user cannot act on from here — it needs a
        // settings path they can copy, so it gets the sheet rather than one line.
        if (err.problem.kind === 'blocked') {
          micBlocked = err.device === 'microphone';
          updateToggle();
          void explainDeviceProblem(err.device, err.problem, el);
        }
        return;
      }
      const msg = err instanceof Error ? err.message : '';
      showError(
        msg === 'no-system-audio'
          ? 'No system audio was shared — pick a tab or screen and tick “Share audio”.'
          : msg === 'source-ended'
            ? 'That audio source has already stopped.'
            : 'Recording could not start.',
      );
    } finally {
      starting = false;
    }
  }

  recordBtn.addEventListener('click', () => {
    if (isRecording()) {
      recorder?.stop();
      return;
    }
    void startRecording(micOn, systemOn); // remembered sources — no popup
  });

  remove.addEventListener('click', reset);

  el.append(dropzone, file, error, divider, recordArea, clip);
  updateToggle();

  // Pre-flight (#1327): a microphone denied at the browser or OS level is visible
  // BEFORE the user presses Record, not after. It only ever WARNS — a stale or wrong
  // permission state must never be the reason an attempt cannot be made — so Record
  // stays live and the real diagnosis still comes from the attempt itself.
  void (async () => {
    const state = await permissionState('microphone');
    if (destroyed || state !== 'denied') return;
    micBlocked = true;
    updateToggle();
  })();

  // Release everything this control holds. MUST be called by the owner whenever
  // the pane is replaced or the app window closes: without it a swapped-out
  // control keeps a live microphone, an open AudioContext, a running
  // MediaRecorder and a ticking interval, and every recording leaves another one
  // behind (#805). `blob` survives, so a caller that already read the clip can
  // still hand it on.
  const destroy = (): void => {
    destroyed = true;
    stopReason = null;
    if (recorder) {
      recorder.onstop = null; // the DOM is going away — nothing to render into
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = null;
    }
    chunks = [];
    if (ticker) clearInterval(ticker);
    ticker = null;
    stopStreams();
    tearDownPlayer();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  return {
    el,
    getBlob: (): Blob | null => blob,
    getFilename: () => filename,
    onChange: (fn: () => void) => el.addEventListener('change', fn),
    reset,
    stop: () => activePlayer?.audio.pause(),
    destroy,
    // Pre-fill with a clip handed over from another app; `from` is that app's id,
    // `jobId` lets the source app be told when processing finishes, and `srcId` is
    // the source record's id (so results can be traced back to it).
    loadBlob: (
      b: Blob,
      name?: string,
      { from, jobId, srcId }: { from?: string; jobId?: string; srcId?: string } = {},
    ) => {
      clipFrom = from || null;
      clipJob = jobId || null;
      clipSrcId = srcId || null;
      setClip(b, name || 'audio.webm');
    },
    getFrom: () => clipFrom,
    getJob: () => clipJob,
    getSrcId: () => clipSrcId,
  };
}
