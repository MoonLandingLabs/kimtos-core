// Video Recorder — record your camera and/or screen (with mic) entirely on-device.
// One live "studio" screen: the preview is always live, with an action bar docked
// beneath it (only the status pill and the countdown overlay the stage — see
// vidrec.css). Camera / screen / mic can be toggled any time, incl. mid-recording,
// because we always record a fixed pair of tracks from a persistent mixer and swap
// the real inputs underneath. See the original notes for the full design.

import './vidrec.css';
import { dataStore as db } from '../../lib/dataStore.js';
import { historyKey } from '@kimtos/config/ui';
import { createBlobHistory } from '../../lib/blobHistory.js';
import { getAppValue, setAppConfig } from '../../lib/appConfig.js';
import { createProgressBar, type ProgressInfo } from '../../components/progressBar.js';
import { toggleControl } from '../../components/appSettingsFields.js';
import { createEntrySession, createHistorySidebar, type HistorySidebarEntry } from '../../components/historySidebar.js';
import { createSidebarShell } from '../../components/sidebarShell.js';
import { createVideoPlayer } from '../../components/videoPlayer.js';
import { explainDeviceProblem } from '../../components/deviceProblem.js';
import { acquireCamera, acquireMic, acquireScreen, DeviceError, problemLine } from '../../lib/devicePermission.js';
import { el } from '../../lib/dom.js';
import { downloadUrl } from '../../lib/download.js';
import { kimtManager, type JobContext } from '../../lib/kimtManager.js';
import { formatTime } from '../../lib/format.js';
import { DOWNLOAD, OPEN, CAMERA, SCREEN, MIC, WAVE } from '../../components/icons.js';
import devAvatar from '../../assets/images/avatars/dev-avatar.svg';
import {
  FPS,
  pickVideoType,
  createMixer,
  remuxWithAudio,
  BUBBLE_DEFAULTS,
  CAM_CORNERS,
  CAM_SHAPES,
  CAM_SIZES,
  type BubbleState,
  type CamCorner,
  type CamShape,
  type CamSize,
} from './mixer.js';
import { store } from '../../models/store.js';
import appMeta from './meta.js';

const MIRROR = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"></path><path d="M7 7 3 12l4 5"></path><path d="m17 7 4 5-4 5"></path></svg>`;
// The camera bubble: a frame with a small pane sitting in one corner of it.
const BUBBLE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"></rect></svg>`;
// Four corner brackets — "which corner does it sit in".
const CORNER = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3"></path><path d="M15 4h3a2 2 0 0 1 2 2v3"></path><path d="M20 15v3a2 2 0 0 1-2 2h-3"></path><path d="M9 20H6a2 2 0 0 1-2-2v-3"></path></svg>`;
// A rounded square and a circle, side by side — the two bubble outlines.
const SHAPE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"></rect><circle cx="15.5" cy="15.5" r="6"></circle></svg>`;
// A diagonal double-headed arrow — resize.
const RESIZE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"></path><path d="M20 4 13 11"></path><path d="M10 20H4v-6"></path><path d="M4 20l7-7"></path></svg>`;
const SPEAKER = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"></path></svg>`;

// Human labels for the bubble's stored values. The value SETS live in mixer.ts, so
// the bar's bubble controls, the Settings select and the draw loop cannot drift apart.
const CORNER_LABELS: Record<CamCorner, string> = {
  br: 'Bottom-right',
  bl: 'Bottom-left',
  tr: 'Top-right',
  tl: 'Top-left',
};
const SHAPE_LABELS: Record<CamShape, string> = { square: 'Square', circle: 'Circle' };
const SIZE_LABELS: Record<CamSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

/** The next value in a cycling control. An unrecognised stored value lands on the first. */
const cycle = <T extends string>(values: readonly T[], current: T): T =>
  values[(values.indexOf(current) + 1) % values.length];

interface Entry {
  id: string;
  name?: string;
  at?: number;
  videoKey?: string;
  dur?: number;
  mime?: string;
  [key: string]: unknown;
}
interface RecController {
  stop: () => Promise<Blob>;
  pause?: () => void;
  resume?: () => void;
}

const ACCENT = appMeta.accent;
/** The three sources, named once: the bar's groups and the status pill both read this. */
const SOURCE_NAMES = { camera: 'Camera', mic: 'Mic', screen: 'Screen' } as const;
type SourceKey = keyof typeof SOURCE_NAMES;
const SOURCE_KEYS = Object.keys(SOURCE_NAMES) as SourceKey[];
/** Every segmented pill in the action bar: the three sources, plus the camera bubble. */
const GROUP_LABELS = { ...SOURCE_NAMES, bubble: 'Camera bubble' } as const;
type GroupKey = keyof typeof GROUP_LABELS;
const HISTORY = historyKey('vidrec');
const HISTORY_LIMIT = 20;
let sidebarWidth = 220; // drag-resizable; persists across opens within the session.

const QUALITY: Record<string, { w: number; h: number; bps: number }> = {
  '720p': { w: 1280, h: 720, bps: 6_000_000 },
  '1080p': { w: 1920, h: 1080, bps: 12_000_000 },
};
const DEFAULT_QUALITY = '720p';
const qualityOf = (id: string) => QUALITY[id] || QUALITY[DEFAULT_QUALITY];

const hist = createBlobHistory(HISTORY, { limit: HISTORY_LIMIT, blobKeys: ['videoKey'] });
const loadHistory = hist.load;
const removeEntry = hist.remove;

const saveEntry = async (name: string, blob: Blob, dur: number): Promise<Entry> => {
  const videoKey = `${HISTORY}/${db.uid()}`;
  await db.putBlob(videoKey, blob);
  const entry = await db.put(HISTORY, { name, at: Date.now(), videoKey, dur: dur || 0, mime: blob.type || '' });
  await hist.prune();
  return entry as Entry;
};

const stopStreams = (streams: (MediaStream | null)[]): void =>
  streams.forEach((s) => s && s.getTracks().forEach((t) => t.stop()));

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Record your screen and camera',
  tip: 'Drag across your recordings in the sidebar (or tap Select) to choose several and delete them at once.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tools (recording needs a live gesture; these cover history).
  tools: [
    {
      name: 'list_recordings',
      description: 'List saved screen/camera recordings (with their id, name and length).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const entries = (await loadHistory()) as unknown as Entry[];
        const list =
          entries.map((e) => `${e.id} · ${e.name || 'Recording'} (${formatTime(e.dur || 0)})`).join('\n') || '(none)';
        return { ok: true, result: list, summary: `${entries.length} recording(s)` };
      },
    },
    {
      name: 'get_recording',
      description: 'Get one recording by id: its name and length (id from list_recordings).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const entry = (await db.get(HISTORY, String(args.id))) as Entry | null;
        if (!entry) return { ok: false, result: 'No recording with that id.', summary: 'not found' };
        return {
          ok: true,
          result: `"${entry.name || 'Recording'}" — ${formatTime(entry.dur || 0)}.`,
          summary: `"${entry.name || 'Recording'}"`,
        };
      },
    },
    {
      name: 'rename_recording',
      description: 'Rename a saved recording (id from list_recordings).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      run: async (args: Record<string, unknown>) => {
        const name = String(args.name || '').trim();
        if (!name) return { ok: false, result: 'A name is required.', summary: 'no name' };
        const entry = (await db.patch(HISTORY, String(args.id), { name })) as Entry | null;
        if (!entry) return { ok: false, result: 'No recording with that id.', summary: 'not found' };
        return { ok: true, result: `Renamed to "${entry.name}".`, summary: `renamed to "${entry.name}"` };
      },
    },
    {
      name: 'delete_recording',
      description: 'Delete a saved recording and its video (id from list_recordings).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const entry = (await db.get(HISTORY, String(args.id))) as Entry | null;
        if (!entry) return { ok: false, result: 'No recording with that id.', summary: 'not found' };
        await removeEntry(entry);
        return { ok: true, result: 'Recording deleted.', summary: 'deleted a recording' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall, if present).
  dataLabel: 'recordings',
  hasData: () => db.hasAny(HISTORY),
  async clearData() {
    await db.clearCollection(HISTORY);
    await db.clearBlobsByPrefix(`${HISTORY}/`);
  },

  // Rendered automatically in Settings → Apps.
  settings: [
    {
      key: 'quality',
      label: 'Recording quality',
      hint: 'Higher is sharper (better for screen text) but uses more CPU and bigger files. Frame rate is 30 fps.',
      type: 'select',
      default: '720p',
      options: [
        { value: '720p', label: '720p (smoother)' },
        { value: '1080p', label: '1080p (sharper)' },
      ],
    },
    {
      key: 'denoise',
      label: 'Reduce noise',
      hint: 'Clean background noise from the audio after recording, using the on-device Denoise model (downloads ~16 MB on first use). It re-encodes the clip, which takes about as long as the recording. Choose this before recording — it can’t be changed mid-recording.',
      type: 'select',
      default: 'on',
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
    },
    {
      key: 'camCorner',
      label: 'Camera bubble position',
      hint: 'Where your camera sits when you record screen + camera together. The studio’s action bar has a Camera bubble strip for this, plus the bubble’s shape and size — all of them apply straight away, even mid-recording.',
      type: 'select',
      default: BUBBLE_DEFAULTS.corner,
      options: CAM_CORNERS.map((value) => ({ value, label: CORNER_LABELS[value] })),
    },
    {
      key: 'countdown',
      label: 'Countdown before recording',
      hint: 'Show a 3-2-1 countdown after you press Record, so you have a moment to get ready.',
      type: 'select',
      default: '3',
      options: [
        { value: 'off', label: 'Off' },
        { value: '3', label: '3 seconds' },
        { value: '5', label: '5 seconds' },
      ],
    },
  ],

  render(body: HTMLElement, ctx: { session?: unknown; saveSession?: (s: unknown) => void } = {}) {
    // Come back to the recording the user was watching (#1172).
    const entrySession = createEntrySession(ctx);
    const sources = {
      camera: getAppValue('vidrec', 'srcCamera', true) as boolean,
      mic: getAppValue('vidrec', 'srcMic', true) as boolean,
      // Never restored from storage: screen sharing is only ever started by the user picking
      // Screen in this session. A saved "on" made every open of the recorder raise Chrome's
      // share picker unprompted, which a camera-only user then had to refuse.
      screen: false,
    };
    let mirrorOn = getAppValue('vidrec', 'mirror', true) as boolean;
    let sysAudioOn = getAppValue('vidrec', 'sysAudio', true) as boolean;
    let mixer: ReturnType<typeof createMixer> | null = null;
    let liveScreen: MediaStream | null = null;
    let liveCam: MediaStream | null = null;
    let liveMic: MediaStream | null = null;
    let rec: RecController | null = null; // active recorder controller
    // The recording's row in KimtManager (convention 11). A recording is the clearest case of work
    // that outlives the user's attention — you start it and then go and do the thing you are
    // recording — and it was registered nowhere, so nothing in the app could know one was live
    // before tearing the app down (#1244).
    let recJob: ReturnType<typeof kimtManager.register> | null = null;
    let recJobCtx: JobContext | null = null;
    let recJobDone: (() => void) | null = null;
    let recJobNote = '';
    let recording = false;
    let paused = false;
    let pausedAccum = 0; // total paused wall-time (ms), excluded from timer + duration
    let pauseStart = 0;
    let counting = false;
    let cancelCountdown: (() => void) | null = null;
    let busy = false;
    let dirty = false;
    let ticker: ReturnType<typeof setInterval> | null = null;
    let startedAt = 0;
    let resultPlayer: ReturnType<typeof createVideoPlayer> | null = null;

    let preview!: HTMLCanvasElement;
    let placeholder!: HTMLElement;
    let recBtn!: HTMLButtonElement;
    let recLabel!: HTMLSpanElement;
    let pauseBtn: HTMLButtonElement | undefined;
    let timerEl!: HTMLSpanElement;
    let countdownEl!: HTMLElement;
    let errEl: HTMLElement | undefined;
    // The status pill over the stage, the pre-flight strip and the camera-bubble
    // strip in the bar. Grouped (and optional) because updateControls can fire
    // before the studio is built.
    let status: { root: HTMLElement; state: HTMLSpanElement; src: HTMLSpanElement } | undefined;
    let preflight: { root: HTMLElement; input: HTMLInputElement; note: HTMLSpanElement } | undefined;
    let bubbleStrip: { root: HTMLElement; note: HTMLSpanElement } | undefined;
    const toggles: Record<string, HTMLButtonElement> = {};
    // A cycling control relabels itself on every change, so its text is kept as a
    // node rather than re-written through the button's innerHTML.
    const toggleLabels: Record<string, HTMLSpanElement> = {};

    const q = () => qualityOf(getAppValue('vidrec', 'quality', DEFAULT_QUALITY) as string);
    const cap = (k: string): string => `src${k[0].toUpperCase()}${k.slice(1)}`;
    const denoiseOn = (): boolean => getAppValue('vidrec', 'denoise', 'on') === 'on';
    const countdownSecs = (): number => {
      const v = getAppValue('vidrec', 'countdown', '3');
      return v === 'off' ? 0 : Number(v) || 0;
    };
    const elapsedMs = (): number => Date.now() - startedAt - pausedAccum - (paused ? Date.now() - pauseStart : 0);

    // The camera bubble's state. The stored config is the single source of truth —
    // the bar's bubble controls and the Settings select both write it, and applyBubble()
    // pushes it into the RUNNING mixer. That is what makes a change land on the
    // studio you already have open, mid-recording included (#1246); the corner used
    // to be read once, when the mixer was built, so Settings appeared to do nothing.
    const bubbleState = (): BubbleState => ({
      corner: getAppValue('vidrec', 'camCorner', BUBBLE_DEFAULTS.corner) as CamCorner,
      shape: getAppValue('vidrec', 'camShape', BUBBLE_DEFAULTS.shape) as CamShape,
      size: getAppValue('vidrec', 'camSize', BUBBLE_DEFAULTS.size) as CamSize,
      visible: getAppValue('vidrec', 'camBubble', BUBBLE_DEFAULTS.visible) as boolean,
    });
    const bubbleKey = (b: BubbleState): string => `${b.corner}/${b.shape}/${b.size}/${b.visible}`;
    let appliedBubble = '';
    const applyBubble = (): void => {
      if (!mixer) return; // no studio on screen — nothing to repaint
      const next = bubbleState();
      const key = bubbleKey(next);
      // The store fires on EVERY settings write, most of which are not ours. Compare
      // before touching the mixer or the DOM, the way Voice Studio's watcher does.
      if (key === appliedBubble) return;
      appliedBubble = key;
      mixer.setBubble(next);
      updateControls();
    };

    /**
     * Take the live capture out of the app's hands and hand back its release, to be called once
     * nothing is reading from it any more.
     *
     * The two halves are separable because a salvaged recording still needs the sources for a
     * moment after the app has stopped wanting them: `mixer.stop()` closes the audio context behind
     * the very track the encoder is still draining, so releasing before the flush finishes costs the
     * clip its tail. Detaching first also means a studio rebuilt on the next line acquires its own
     * sources rather than having these pulled out from under it.
     */
    const detachLive = (): (() => void) => {
      const m = mixer;
      const streams = [liveScreen, liveCam, liveMic];
      mixer = null;
      liveScreen = liveCam = liveMic = null;
      m?.setOnDraw(() => {}); // stop feeding the encoder at once; its flush drains what it has
      return () => {
        m?.stop();
        stopStreams(streams);
      };
    };

    const teardownLive = (): void => detachLive()();
    const recordingName = (): string => `Recording ${new Date().toLocaleString()}`;

    /** The KimtManager line: what the user sees on the row while this runs. */
    const jobLabel = (): string => `${paused ? 'Paused' : 'Recording'} — ${formatTime(elapsedMs())}`;

    /** Only when it actually changed — the timer ticks four times a second, and every note()
     *  repaints both surfaces that render the task list. */
    const syncJobNote = (): void => {
      const text = jobLabel();
      if (text === recJobNote) return;
      recJobNote = text;
      recJobCtx?.note(text);
    };

    const startRecJob = (): void => {
      recJobNote = '';
      recJob = kimtManager.register({
        appId: appMeta.id,
        title: 'Recording',
        kind: 'compute',
        savesOnStop: true, // stopping a recording finishes it; nothing captured is thrown away
        immediate: true, // the camera is already rolling — this must never sit in a queue
        run: (job) =>
          new Promise<void>((resolve) => {
            recJobCtx = job;
            recJobDone = resolve;
            job.progress(null); // it runs until the user stops it; there is no ratio to invent
            // Stop, from KimtManager or the switcher, takes the SAVING path. Stopping a recording
            // is finishing it, not throwing it away.
            job.signal.addEventListener('abort', () => void stopRecording());
          }),
      });
      void recJob.run();
    };

    /** Let the row go, however the recording ended. */
    const endRecJob = (): void => {
      const job = recJob;
      const done = recJobDone;
      recJob = null;
      recJobCtx = null;
      recJobDone = null;
      done?.();
      // Registered but never run: there is no promise to resolve, so drop the record instead, or
      // the row would outlive the recording it stands for.
      if (job && !done) kimtManager.cancel(job);
    };

    /**
     * Stop everything — and SAVE an in-progress recording rather than discarding it.
     *
     * This is the forced-teardown path: the window closing and the user opening another recording. It
     * used to call `r.stop()` and drop the blob on the floor, so a screen recording — often
     * unrepeatable, a live call or a bug that just happened — was destroyed by an unrelated click
     * (#1244). What has been captured up to this moment is a usable recording, so it is written to
     * the history like any other.
     *
     * The optional noise reduction is deliberately skipped here: it is a long re-encode driven by a
     * progress bar in a window that is being destroyed. Keeping the audio as recorded is the
     * guarantee; cleaning it never was.
     */
    const fullStop = (): void => {
      const dur = recording ? Math.round(elapsedMs() / 1000) : 0;
      recording = false;
      paused = false;
      cancelCountdown?.(); // abort an in-flight countdown
      if (ticker) clearInterval(ticker);
      const r = rec;
      rec = null;
      endRecJob();
      if (!r) {
        teardownLive();
        return;
      }
      // Detached now, released only once the encoder has finished flushing — see `detachLive`.
      const release = detachLive();
      void r
        .stop()
        .then(async (blob) => {
          if (!blob.size) return; // a recorder with nothing in it has nothing to save
          await saveEntry(recordingName(), blob, dur);
          history.refresh();
        })
        .catch(() => {}) // a recorder that cannot produce a blob leaves nothing to rescue
        .finally(release);
    };
    const stopResult = (): void => {
      resultPlayer?.destroy();
      resultPlayer = null;
    };

    const downloadEntry = async (entry: Entry): Promise<void> => {
      const url = entry.videoKey ? await db.blobUrl(entry.videoKey) : null;
      if (url) downloadUrl(url, `${(entry.name || 'recording').replace(/[^\w.-]+/g, '_')}.webm`);
    };

    const showErr = (msg: string): void => {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.classList.remove('is-calm');
      errEl.hidden = false;
    };

    const onScreenEnded = (): void => {
      if (!liveScreen) return;
      stopStreams([liveScreen]);
      liveScreen = null;
      mixer?.setScreen(null);
      sources.screen = false;
      updateControls();
    };

    // What is being captured, in the order the bar shows it ("Camera + Mic").
    const sourceSummary = (): string =>
      SOURCE_KEYS.filter((k) => sources[k])
        .map((k) => SOURCE_NAMES[k])
        .join(' + ');

    // Every control in the bar, declared once: the three sources, the modifiers that
    // only make sense alongside one, and the camera-bubble controls. updateControls
    // iterates this instead of carrying a hand-written line per control, which is what
    // let the old row drift into seven identical chips with no stated hierarchy (#1245).
    // Adding a control is one entry — nothing else in the builder or the updater moves.
    //
    // NOTHING here is gated on `recording`. Toggling sources and reshaping the bubble
    // mid-clip is what the app is sold on; only Reduce noise locks, and it says so.
    interface ToggleSpec {
      key: string;
      /** Which pill it lives in; `src` is that pill's primary button. */
      group: GroupKey;
      /** `src` icon + name, `mod` icon only, `cycle` icon + the value it is showing. */
      role: 'src' | 'mod' | 'cycle';
      icon: string;
      label: string;
      title: string;
      /** A two-state toggle. Absent for a cycling control, which has no on/off. */
      on?: () => boolean;
      /** A cycling control's current value, repainted on every change. */
      value?: () => string;
      /** A control is dead without what it modifies; `needs` says so in the tooltip. */
      enabled?: () => boolean;
      needs?: string;
    }
    // The bubble is drawn only where the camera sits OVER the screen, so its controls
    // mean nothing without both, and its look controls mean nothing while it is hidden.
    const bubbleApplies = (): boolean => sources.camera && sources.screen;
    const bubbleLook = (): boolean => bubbleApplies() && bubbleState().visible;
    const NEEDS_BOTH = 'turn Camera and Screen on first';
    const TOGGLES: ToggleSpec[] = [
      {
        key: 'camera',
        group: 'camera',
        role: 'src',
        icon: CAMERA,
        label: 'Camera',
        title: 'Turn your camera on or off',
        on: () => sources.camera,
      },
      {
        key: 'mirror',
        group: 'camera',
        role: 'mod',
        icon: MIRROR,
        label: 'Mirror',
        title: 'Mirror your camera (off shows text the right way round)',
        on: () => mirrorOn,
        enabled: () => sources.camera,
        needs: 'turn Camera on first',
      },
      {
        key: 'mic',
        group: 'mic',
        role: 'src',
        icon: MIC,
        label: 'Mic',
        title: 'Turn your microphone on or off',
        on: () => sources.mic,
      },
      {
        key: 'screen',
        group: 'screen',
        role: 'src',
        icon: SCREEN,
        label: 'Screen',
        title: 'Share your screen or a tab',
        on: () => sources.screen,
      },
      {
        key: 'sysaudio',
        group: 'screen',
        role: 'mod',
        icon: SPEAKER,
        label: 'System audio',
        title: "Include the shared screen's own sound",
        on: () => sysAudioOn,
        enabled: () => sources.screen,
        needs: 'turn Screen on first',
      },
      {
        key: 'bubble',
        group: 'bubble',
        role: 'mod',
        icon: BUBBLE,
        label: 'Show the bubble',
        title: 'Show your camera over the shared screen (your camera stays on either way)',
        on: () => bubbleState().visible,
        enabled: bubbleApplies,
        needs: NEEDS_BOTH,
      },
      {
        key: 'bubblepos',
        group: 'bubble',
        role: 'cycle',
        icon: CORNER,
        label: 'Bubble corner',
        title: 'Move the camera bubble to the next corner',
        value: () => CORNER_LABELS[bubbleState().corner] ?? CORNER_LABELS.br,
        enabled: bubbleLook,
        needs: NEEDS_BOTH,
      },
      {
        key: 'bubbleshape',
        group: 'bubble',
        role: 'cycle',
        icon: SHAPE,
        label: 'Bubble shape',
        title: 'Switch the camera bubble between square and circle',
        value: () => SHAPE_LABELS[bubbleState().shape] ?? SHAPE_LABELS.square,
        enabled: bubbleLook,
        needs: NEEDS_BOTH,
      },
      {
        key: 'bubblesize',
        group: 'bubble',
        role: 'cycle',
        icon: RESIZE,
        label: 'Bubble size',
        title: 'Resize the camera bubble',
        value: () => SIZE_LABELS[bubbleState().size] ?? SIZE_LABELS.md,
        enabled: bubbleLook,
        needs: NEEDS_BOTH,
      },
    ];

    const updateControls = (): void => {
      for (const t of TOGGLES) {
        const b = toggles[t.key];
        if (!b) continue;
        const enabled = t.enabled ? t.enabled() : true;
        b.disabled = !enabled;
        // A control the user cannot use says why, rather than being discovered dead.
        b.title = enabled ? t.title : `${t.label} — ${t.needs ?? 'unavailable right now'}`;
        if (t.on) {
          const on = t.on();
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        }
        // A cycling control is not a two-state toggle: it carries no aria-pressed, and
        // its label IS its state.
        const text = toggleLabels[t.key];
        if (t.value && text) text.textContent = t.value();
      }
      // The bubble strip is inert without both sources; like the pre-flight strip it
      // stays visible and says why rather than going quietly dead.
      if (bubbleStrip) {
        const live = bubbleApplies();
        bubbleStrip.root.classList.toggle('is-locked', !live);
        bubbleStrip.note.textContent = live ? '' : 'Needs Camera and Screen together';
        bubbleStrip.note.hidden = live;
      }
      const hasVideo = !!(liveScreen || liveCam);
      recBtn.classList.toggle('is-recording', recording);
      recBtn.disabled = !recording && !hasVideo;
      recLabel.textContent = recording ? 'Stop' : 'Record';
      // No tooltip on an enabled Record button: its label already says it, and a
      // click during the 3-2-1 countdown cancels rather than starts.
      recBtn.title = recording ? 'Stop recording and save the clip' : hasVideo ? '' : 'Turn on Camera or Screen first';
      timerEl.hidden = !recording;
      if (pauseBtn) {
        pauseBtn.hidden = !recording;
        pauseBtn.textContent = paused ? 'Resume' : 'Pause';
        pauseBtn.classList.toggle('is-paused', paused);
      }
      if (status) {
        // With no video the placeholder owns the stage and already says what to turn
        // on, and the pill's --panel ground would sit on the placeholder's own
        // --panel with nothing but a hairline between them. So it shows up exactly
        // when it has something to report.
        status.root.hidden = !hasVideo && !recording;
        status.root.classList.toggle('is-recording', recording && !paused);
        status.root.classList.toggle('is-paused', recording && paused);
        status.state.textContent = recording ? (paused ? 'PAUSED' : 'REC') : 'READY';
        const summary = sourceSummary();
        status.src.textContent = summary;
        status.src.hidden = !summary;
      }
      // Reduce noise is a pre-flight choice: it stays visible and legible while
      // recording, but says in words that it is locked (#1245).
      if (preflight) {
        preflight.input.checked = denoiseOn();
        preflight.input.disabled = recording;
        preflight.root.classList.toggle('is-locked', recording);
        preflight.note.textContent = recording ? 'Locked while recording' : 'Cleans the audio after you stop.';
      }
      placeholder.hidden = hasVideo;
    };

    // Acquire/release sources to match `sources` and feed them to the mixer.
    const sync = async (): Promise<void> => {
      if (!mixer) return;
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      try {
        do {
          dirty = false;
          if (errEl) errEl.hidden = true;

          if (sources.screen && !liveScreen) {
            try {
              liveScreen = await acquireScreen({
                video: { frameRate: { ideal: FPS, max: FPS }, width: { max: q().w }, height: { max: q().h } },
                audio: true,
              });
              liveScreen.getVideoTracks()[0].addEventListener('ended', onScreenEnded);
              mixer.setScreen(liveScreen);
            } catch (err) {
              // Off in this session, because there is no screen in the mix — but not
              // SAVED as the user's choice, and never without saying why (#1327).
              sources.screen = false;
              if (err instanceof DeviceError && err.problem.kind === 'dismissed') {
                // Declining the picker is a normal choice, not a failure: go back to what was on.
                showErr('Screen sharing was not started, so you are back to your camera.');
                errEl?.classList.add('is-calm');
              } else {
                showErr(err instanceof DeviceError ? problemLine(err.problem) : 'Screen capture is unavailable.');
              }
            }
          } else if (!sources.screen && liveScreen) {
            stopStreams([liveScreen]);
            liveScreen = null;
            mixer.setScreen(null);
          }

          if (sources.camera && !liveCam) {
            try {
              liveCam = await acquireCamera({
                width: { ideal: q().w },
                height: { ideal: q().h },
                frameRate: { max: FPS },
                facingMode: 'user',
              });
              mixer.setCamera(liveCam);
            } catch (err) {
              sources.camera = false;
              showErr(err instanceof DeviceError ? problemLine(err.problem) : 'Could not use your camera.');
              if (err instanceof DeviceError && err.problem.kind === 'blocked') {
                void explainDeviceProblem('camera', err.problem, body);
              }
            }
          } else if (!sources.camera && liveCam) {
            stopStreams([liveCam]);
            liveCam = null;
            mixer.setCamera(null);
          }
        } while (dirty);
      } finally {
        busy = false;
        updateControls();
      }
    };

    // Mic is a cheap, instant mute: keep the stream connected, flip `enabled`.
    const applyMic = async (): Promise<void> => {
      if (!mixer) return;
      if (sources.mic && !liveMic) {
        try {
          liveMic = await acquireMic();
          mixer.setMic(liveMic);
        } catch (err) {
          // Turning the mic off here is honest — there is no mic in the mix — but
          // it must not be SAVED as the user's choice, and it must not be silent.
          // Persisting it meant the toggle un-ticked itself for good, with no
          // message, which is indistinguishable from the app being broken (#1327).
          sources.mic = false;
          showErr(err instanceof DeviceError ? problemLine(err.problem) : 'Could not use your microphone.');
          if (err instanceof DeviceError && err.problem.kind === 'blocked') {
            void explainDeviceProblem('microphone', err.problem, body);
          }
        }
      }
      if (liveMic) {
        liveMic.getAudioTracks().forEach((t) => {
          t.enabled = sources.mic;
        });
      }
      updateControls();
    };

    // Reduce noise — the one pre-flight choice, set from the bar's own strip.
    const setDenoise = (on: boolean): void => {
      if (recording) return; // locked once recording starts; the strip says so
      setAppConfig('vidrec', 'denoise', on ? 'on' : 'off');
      updateControls();
    };

    const onToggle = (key: string): void => {
      if (key === 'mirror') {
        mirrorOn = !mirrorOn;
        setAppConfig('vidrec', 'mirror', mirrorOn);
        mixer?.setMirror(mirrorOn); // live, no re-acquire
        updateControls();
        return;
      }
      // The bubble controls: write the stored value, then push the whole state into the
      // running mixer. Live, no re-acquire, so they work mid-recording too.
      if (key === 'bubble') {
        setAppConfig('vidrec', 'camBubble', !bubbleState().visible);
        applyBubble();
        return;
      }
      if (key === 'bubblepos') {
        setAppConfig('vidrec', 'camCorner', cycle(CAM_CORNERS, bubbleState().corner));
        applyBubble();
        return;
      }
      if (key === 'bubbleshape') {
        setAppConfig('vidrec', 'camShape', cycle(CAM_SHAPES, bubbleState().shape));
        applyBubble();
        return;
      }
      if (key === 'bubblesize') {
        setAppConfig('vidrec', 'camSize', cycle(CAM_SIZES, bubbleState().size));
        applyBubble();
        return;
      }
      if (key === 'sysaudio') {
        sysAudioOn = !sysAudioOn;
        setAppConfig('vidrec', 'sysAudio', sysAudioOn);
        mixer?.setScreenAudio(sysAudioOn); // live (dis)connect, no re-acquire
        updateControls();
        return;
      }
      const sk = key as 'camera' | 'mic' | 'screen';
      sources[sk] = !sources[sk];
      // Screen is a per-session choice and is never saved (see `sources`).
      if (key !== 'screen') setAppConfig('vidrec', cap(key), sources[sk]);
      if (key === 'mic') applyMic();
      else sync(); // camera / screen acquire/release; togglable any time
    };

    // Pause/resume the in-progress recording (both recorder paths support it).
    const togglePause = (): void => {
      if (!recording || !rec) return;
      if (paused) {
        pausedAccum += Date.now() - pauseStart;
        paused = false;
        rec.resume?.();
      } else {
        pauseStart = Date.now();
        paused = true;
        rec.pause?.();
      }
      syncJobNote(); // the row says Paused straight away, not on the next tick
      updateControls();
    };

    // Start recording — WebCodecs when available, else MediaRecorder.
    const startRecording = async (): Promise<void> => {
      if (recording || !mixer || !(liveScreen || liveCam)) return;
      mixer.resume();
      const { webcodecsSupported, createRecorder } = await import('../../lib/videoEncoderRecorder.js');
      try {
        if (webcodecsSupported()) {
          const r = await createRecorder({
            canvas: mixer.canvas,
            audioStream: mixer.audioStream,
            fps: FPS,
            bitrate: q().bps,
          });
          mixer.setOnDraw(() => r.addFrame()); // grab a frame each composited draw
          rec = {
            stop: () => {
              mixer?.setOnDraw(() => {});
              return r.stop();
            },
            pause: () => r.pause(),
            resume: () => r.resume(),
          };
        } else {
          const stream = mixer.fallbackStream();
          const mr = new MediaRecorder(stream, { mimeType: pickVideoType(), videoBitsPerSecond: q().bps });
          const chunks: Blob[] = [];
          mr.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          const done = new Promise<Blob>((res) => {
            mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || 'video/webm' }));
          });
          mr.start(1000);
          rec = {
            stop: () => {
              try {
                if (mr.state !== 'inactive') mr.stop();
              } catch {
                /* ignore */
              }
              return done;
            },
            pause: () => void (mr.state === 'recording' && mr.pause()),
            resume: () => void (mr.state === 'paused' && mr.resume()),
          };
        }
      } catch (e) {
        showErr(`Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      recording = true;
      paused = false;
      pausedAccum = 0;
      startedAt = Date.now();
      timerEl.textContent = '0:00';
      startRecJob();
      ticker = setInterval(() => {
        timerEl.textContent = formatTime(elapsedMs());
        syncJobNote();
      }, 250);
      updateControls();
    };

    const stopRecording = async (): Promise<void> => {
      if (!recording || !rec) return;
      const dur = Math.round(elapsedMs() / 1000); // excludes paused spans
      recording = false;
      paused = false;
      if (ticker) clearInterval(ticker);
      const r = rec;
      rec = null;
      endRecJob(); // the capture is over; the row must not outlive it
      updateControls();
      let blob: Blob;
      try {
        blob = await r.stop();
      } catch (e) {
        showErr(`Recording failed: ${e instanceof Error ? e.message : String(e)}`);
        teardownLive();
        showStudio();
        return;
      }
      teardownLive();
      try {
        await finalize(blob, dur);
      } catch (e) {
        showStudio();
        showErr(`Couldn't save the recording: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // 3-2-1 overlay before recording.
    const runCountdown = (secs: number): Promise<boolean> =>
      new Promise((resolve) => {
        counting = true;
        let n = secs;
        countdownEl.textContent = String(n);
        countdownEl.hidden = false;
        const finish = (ok: boolean): void => {
          clearInterval(tick);
          countdownEl.hidden = true;
          counting = false;
          cancelCountdown = null;
          resolve(ok);
        };
        const tick = setInterval(() => {
          n -= 1;
          if (n <= 0) finish(true);
          else countdownEl.textContent = String(n);
        }, 1000);
        cancelCountdown = () => finish(false);
      });

    const onRecord = async (): Promise<void> => {
      if (recording) return void stopRecording();
      if (counting) return cancelCountdown?.(); // second click cancels the countdown
      const secs = countdownSecs();
      if (secs > 0) {
        const started = await runCountdown(secs);
        if (!started || !(liveScreen || liveCam)) return; // cancelled or sources gone
      }
      startRecording();
    };

    // --- the live studio screen ---
    const showStudio = (): void => {
      fullStop();
      stopResult();

      const bubble = bubbleState();
      mixer = createMixer({
        w: q().w,
        h: q().h,
        bubble,
        mirror: mirrorOn,
        screenAudio: sysAudioOn,
      });
      appliedBubble = bubbleKey(bubble); // the fresh mixer already holds this state

      // --- the stage: live preview, its empty state, the status pill, the countdown ---
      const stage = el('div', 'vid-stage');
      preview = mixer.canvas;
      preview.className = 'vid-preview';
      placeholder = el('div', 'vid-placeholder');
      const avatar = el('img', 'vid-placeholder-img');
      avatar.src = devAvatar;
      avatar.alt = '';
      placeholder.append(avatar, el('p', 'vid-placeholder-note', 'Turn on Camera or Screen to start'));

      // One pill that answers "what is happening": state, elapsed time, and which
      // sources are being captured. Only the state is announced — the timer ticks
      // four times a second and would flood a screen reader.
      const statusRoot = el('div', 'vid-status');
      const statusState = el('span', 'vid-status-state', 'READY');
      statusState.setAttribute('aria-live', 'polite');
      timerEl = el('span', 'vid-timer', '0:00');
      timerEl.hidden = true;
      const statusSrc = el('span', 'vid-status-src');
      statusRoot.append(el('span', 'vid-status-dot'), statusState, timerEl, statusSrc);
      status = { root: statusRoot, state: statusState, src: statusSrc };

      countdownEl = el('div', 'vid-countdown');
      countdownEl.hidden = true;

      // --- the action bar, docked under the stage ---
      const bar = el('div', 'vid-bar');
      const mainRow = el('div', 'vid-bar-row');

      // One segmented pill per group, built straight from the table: the primary
      // control, then whatever only makes sense with it (Mirror on Camera, System
      // audio on Screen, the bubble's look on the bubble). The containment is what
      // says which controls are situational — nothing is hidden behind a menu, so
      // every one of them is still one click away mid-recording.
      const groups = new Map<GroupKey, HTMLElement>();
      for (const t of TOGGLES) {
        let group = groups.get(t.group);
        if (!group) {
          group = el('div', 'vid-group');
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', GROUP_LABELS[t.group]);
          groups.set(t.group, group);
        }
        const b = el('button', `vid-${t.role}`);
        b.type = 'button';
        b.innerHTML = t.icon;
        if (t.role === 'mod') {
          b.setAttribute('aria-label', t.label); // icon-only: keep it named
        } else {
          // Kept as a node, never re-written through the button's innerHTML: a
          // cycling control relabels itself on every change.
          const text = el('span', undefined, t.role === 'cycle' ? (t.value?.() ?? '') : t.label);
          b.append(text);
          toggleLabels[t.key] = text;
          if (t.role === 'cycle') b.setAttribute('aria-label', t.label);
        }
        b.addEventListener('click', () => onToggle(t.key));
        toggles[t.key] = b;
        group.append(b);
      }
      const cluster = el('div', 'vid-sources');
      for (const k of SOURCE_KEYS) {
        const g = groups.get(k);
        if (g) cluster.append(g);
      }

      const actions = el('div', 'vid-actions');
      pauseBtn = el('button', 'vid-pause', 'Pause');
      pauseBtn.type = 'button';
      pauseBtn.hidden = true;
      pauseBtn.addEventListener('click', togglePause);
      recBtn = el('button', 'vid-record');
      recBtn.type = 'button';
      recLabel = el('span', undefined, 'Record');
      recBtn.append(el('span', 'vid-record-dot'), recLabel);
      recBtn.addEventListener('click', onRecord);
      actions.append(pauseBtn, recBtn);
      mainRow.append(cluster, actions);

      // The camera bubble is a live look control, not a source and not a pre-flight
      // choice, so it gets a strip of its own between the two — and every control in
      // it keeps working mid-recording, which is the whole point of #1246.
      const bubbleRoot = el('div', 'vid-preflight');
      const bubbleNote = el('span', 'vid-preflight-note');
      bubbleRoot.append(el('span', 'vid-preflight-title', 'Camera bubble'));
      const bubbleGroup = groups.get('bubble');
      if (bubbleGroup) bubbleRoot.append(bubbleGroup);
      bubbleRoot.append(bubbleNote);
      bubbleStrip = { root: bubbleRoot, note: bubbleNote };

      // Reduce noise is not a source — it is the one decision that has to be made
      // BEFORE you press Record, so it gets its own labelled strip rather than an
      // eighth identical button that silently dies on Record.
      const preflightRoot = el('div', 'vid-preflight');
      const preflightTitle = el('span', 'vid-preflight-title', 'Before recording');
      const noiseLabel = el('label', 'vid-preflight-item');
      const noiseSwitch = toggleControl(denoiseOn(), setDenoise); // the shared Settings switch
      const noiseText = el('span', 'vid-preflight-name');
      noiseText.innerHTML = `${WAVE}<span>Reduce noise</span>`;
      noiseLabel.append(noiseSwitch, noiseText);
      const preflightNote = el('span', 'vid-preflight-note');
      preflightRoot.append(preflightTitle, noiseLabel, preflightNote);
      // toggleControl always builds the checkbox; this narrows its type, it is not a fallback.
      const noiseInput = noiseSwitch.querySelector('input');
      if (noiseInput) preflight = { root: preflightRoot, input: noiseInput, note: preflightNote };

      bar.append(mainRow, bubbleRoot, preflightRoot);

      errEl = el('p', 'app-error');
      errEl.hidden = true;
      stage.append(preview, placeholder, statusRoot, countdownEl);
      const studio = el('div', 'vid-studio');
      studio.append(stage, bar);
      main.replaceChildren(studio, errEl);

      updateControls();
      sync();
      applyMic();
    };

    // --- after stop: SAVE, then optionally denoise in place ---
    //
    // The capture is written to the library BEFORE the noise reduction runs, and that ordering is
    // the whole point of this function.
    //
    // It used to denoise first and save once, at the end. So for the length of the clean-up — which
    // takes about as long as the recording did — the only copy of an unrepeatable capture was a
    // local variable in this page. Denoise decodes the entire audio track into memory and the
    // re-mux plays the video back in real time while re-recording it: a large, sustained
    // allocation. Background the tab during that and the browser is entitled to discard it, and
    // does. The user comes back to a white page, reloads, and the recording never existed anywhere
    // else. Reported after exactly that, on a long video.
    //
    // `lib/jobStore.ts` was written for this class of loss (#314) and says it plainly: "no result,
    // and — the part that matters — no input either." Only the standalone Denoise app ever adopted
    // it; the recorder runs the same engine on much bigger inputs and did not.
    //
    // Saving first is stronger here than a job record, because the input IS the deliverable. The
    // worst case stops being "you have nothing" and becomes "you have your recording, without the
    // noise reduction" — and the entry is in the sidebar, visible, from the moment it exists.
    //
    // The clean-up itself then RUNS THROUGH THE ORCHESTRATOR (#1270), like the recording before it.
    // It was a bare promise with a progress bar drawn into the app pane, and the pane is not an
    // owner: anything that tore the window down — another tab taking the session over, most of all —
    // left this running with no row, no Stop and no surface. Saving first bounded what that could
    // cost; it did not make the work visible, and app convention 11 asks for both.
    //
    // Registering it does NOT move the save. The order above is the fix for a reported data loss and
    // is asserted by `finalizeOrder.test.ts`; the job wraps only what comes after it.
    const finalize = async (blob: Blob, dur: number): Promise<void> => {
      const entry = await saveEntry(recordingName(), blob, dur);
      // On screen before the long part starts, so a tab that dies mid-clean-up leaves something the
      // user can see and play rather than an absence they have to trust us about.
      history.refresh();
      if (!denoiseOn()) {
        history.open(entry);
        return;
      }

      const bar = createProgressBar({ hint: 'One-time model download — cached and offline afterwards.' });
      main.replaceChildren(el('p', 'progress-heading', 'Cleaning audio…'), bar.el);
      // `savesOnStop: true` is a statement about the recording, and it is already true before this
      // line runs: the entry is on disk and in the sidebar. Stopping costs the noise reduction, not
      // the capture — which is what the takeover notice tells the user, so it had better be so.
      const job = kimtManager.start({
        appId: appMeta.id,
        title: 'Cleaning audio',
        kind: 'compute',
        savesOnStop: true,
        run: async (ctx: JobContext) => {
          const report = (p: ProgressInfo): void => {
            bar.update(p);
            ctx.progress(typeof p?.ratio === 'number' ? p.ratio : null);
          };
          try {
            const { denoiseAudio } = await import('../../lib/engines/denoise.js');
            const wav = await denoiseAudio(blob, { onProgress: report });
            // Neither the denoiser nor the re-mux takes a signal, so a stop lands between the two
            // stages rather than inside one. Checking here keeps the longer half — the re-mux plays
            // the whole clip back in real time — from starting on work nobody is waiting for.
            if (ctx.signal.aborted) return;
            const out = await remuxWithAudio(blob, wav, Math.min(q().bps * 3, 20_000_000), report);
            // Replace the blob UNDER the entry the user already has, rather than adding a second
            // one: the same key, so the sidebar row, its id and its place in history all stay put,
            // and a failure between here and the patch leaves the original playable rather than
            // orphaned. Skipped on a stop, which leaves exactly that original in place.
            if (ctx.signal.aborted) return;
            if (entry.videoKey) await db.putBlob(entry.videoKey, out);
            if (out.type) await db.patch(HISTORY, entry.id, { mime: out.type });
          } catch (e) {
            // The recording is already saved, so there is nothing to rescue and nothing to warn
            // about beyond the missing clean-up. Swallowed here rather than surfaced as a failed
            // job for the same reason: the deliverable is intact, so a red row would misreport it.
            console.warn('Video denoise failed, keeping the original recording:', e);
          }
        },
      });
      await job.run();
      // Not on a stop: the pane is being torn down or is already gone, and opening a window into it
      // is the one thing a stopped job must not do. The entry stays in the sidebar regardless.
      if (job.status() !== 'cancelled') history.open(entry);
    };

    // --- result screen (our own player, not native controls) ---
    const showResult = async (raw: HistorySidebarEntry): Promise<void> => {
      const entry = raw as Entry;
      fullStop();
      stopResult();
      const url = entry.videoKey ? await db.blobUrl(entry.videoKey) : null;
      resultPlayer = createVideoPlayer(url || '');
      const wrap = el('div', 'vid-result');
      const actions = el('div', 'app-actions');
      const dl = el('button', 'button-primary', 'Download');
      dl.type = 'button';
      dl.addEventListener('click', () => downloadEntry(entry));
      const again = el('button', 'button-secondary', 'Record another');
      again.type = 'button';
      again.addEventListener('click', () => showStudio());
      actions.append(dl, again);
      wrap.append(resultPlayer.el, actions);
      main.replaceChildren(wrap);
    };

    // --- layout ---
    const history = createHistorySidebar({
      title: 'Recordings',
      emptyText: 'Your recordings will appear here.',
      load: loadHistory,
      remove: removeEntry,
      itemOf: (entry) => ({ snippet: ((entry as Entry).name as string) || 'Recording' }),
      menu: (entry) => [
        { label: 'Open', icon: OPEN, onClick: () => history.open(entry) },
        { label: 'Download', icon: DOWNLOAD, onClick: () => downloadEntry(entry as Entry) },
      ],
      onOpen: (entry) => {
        showResult(entry);
        entrySession.remember(entry.id);
      },
      onNew: () => {
        showStudio();
        entrySession.remember(null);
      },
      initialActiveId: entrySession.initialActiveId,
      confirmMessage: 'Delete this recording?',
      undoMessage: 'Recording deleted',
      selectable: true,
      bulkConfirm: (n) => `Delete ${n} recording${n === 1 ? '' : 's'}?`,
      bulkUndo: (n) => `${n} recording${n === 1 ? '' : 's'} deleted`,
    });
    const shell = createSidebarShell({
      history,
      reserve: 360,
      width: sidebarWidth,
      label: 'Recordings',
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    const main = shell.main;
    const responsive = shell.responsive;
    body.replaceChildren(shell.layout);
    history.showNew();
    entrySession.start();

    // Settings → Apps → Video Recorder writes the same stored values the bar's controls do,
    // so watching the store is what makes the bubble position apply to the studio
    // already on screen instead of only to the next one (#1246).
    const unwatch = store.subscribe(() => applyBubble());

    // Stop capture + playback + observers when the window closes.
    return () => {
      history.destroy(); // first: stopping things below is itself what asks the sidebar to repaint
      unwatch();
      fullStop();
      stopResult();
      responsive.destroy?.();
    };
  },
};

export default app;
