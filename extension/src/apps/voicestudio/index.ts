// Voice Studio — an on-device text-to-speech workstation. Pick from a palette of
// Kokoro-82M voices, audition any of them as a card you can play, then turn a phrase
// or a whole article into natural speech: the text is split at sentence boundaries and
// synthesised chunk by chunk in a Web Worker (so the tab never freezes), then
// stitched into one seamless clip you can play, save, and export as a WAV.
// Everything runs locally — the text and the audio never leave the browser. Heavy
// lifting lives in lib/engines/voice.js.
//
// The studio is built around the text, not the palette: a compact voice bar, a voice
// picker that opens on demand into a grid of cards, then the composer. Previewing a
// voice is a background job with its own abort — it never disables Speak, never
// changes which voice is selected, and is cached per voice so the second listen is
// instant (#1146). Voice, speed and auto-save are real, persisted app settings, so
// they survive closing the window and are editable from the window's settings control
// or Settings > Apps.

import './voicestudio.css';
import { el } from '../../lib/dom.js';
import { historyKey } from '@kimtos/config/ui';
import { dataStore as db } from '../../lib/dataStore.js';
import { createBlobHistory } from '../../lib/blobHistory.js';
import { createEntrySession, createHistorySidebar, type HistorySidebarEntry } from '../../components/historySidebar.js';
import { createSidebarShell } from '../../components/sidebarShell.js';
import { createAudioPlayer } from '../../components/audioPlayer.js';
import { createProgressBar, type ProgressInfo } from '../../components/progressBar.js';
import { downloadBlob, safeFilename } from '../../lib/download.js';
import { DOWNLOAD, OPEN, SEARCH, WAVE } from '../../components/icons.js';
import { getAppConfig, setAppConfig } from '../../lib/appConfig.js';
import { store } from '../../models/store.js';
import {
  VOICES,
  voiceById,
  voiceGroup,
  DEFAULT_VOICE,
  TOP_VOICES,
  type Voice,
} from '../../lib/engines/voiceCatalog.js';
import {
  synthesizeSpeech,
  synthesizeToWav,
  disposeVoiceEngine,
  isVoiceModelCached,
  PREVIEW_BLOB_PREFIX,
} from '../../lib/engines/voice.js';
import { encodeWav } from '../../lib/audioAssembly.js';
import { kimtManager, type Job } from '../../lib/kimtManager.js';
import { followQueue } from '../../lib/queuedProgress.js';
import appMeta from './meta.js';

const APP_ID = 'voicestudio';
const HISTORY = historyKey(APP_ID);
const HISTORY_LIMIT = 40;
const ACCENT = appMeta.accent;
// Stated up front so a paying user knows what installing costs.
const DOWNLOAD_NOTE = 'The voice model downloads once (~90 MB) and is then cached for offline use.';

// Rendered previews are cached as blobs under the app's own prefix (storage
// convention 6), so AnubisDB attributes them and both uninstall paths can drop them.
// The prefix itself is declared beside the code that frees it on uninstall. The version
// segment invalidates every cached sample if the line below ever changes.
const PREVIEW_VERSION = 'v1';
const previewKey = (voiceId: string): string => `${PREVIEW_BLOB_PREFIX}${PREVIEW_VERSION}-${voiceId}`;

// Two sentences: one short line is not enough audio to judge a voice by.
const previewLine = (v: Voice): string =>
  `Hi, I'm ${v.name}, one of the voices in Voice Studio on Kimt OS. ` +
  `This is a short preview, so you can hear how I sound before you press Speak.`;

const STOP_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';

const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

const accentLabel = (v: Voice): string => (v.lang === 'en-gb' ? 'UK English' : 'US English');
const clampSpeed = (n: number): number => Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));

let sidebarWidth = 220; // drag-resizable; persists across opens within the session.

interface ClipEntry {
  id: string;
  name?: string;
  at?: number;
  audioKey?: string;
  voice?: string;
  text?: string;
  [key: string]: unknown;
}

const hist = createBlobHistory(HISTORY, { limit: HISTORY_LIMIT, blobKeys: ['audioKey'] });

async function saveClip(name: string, wav: Blob, voice: string, text: string): Promise<ClipEntry> {
  const audioKey = `${HISTORY}/${db.uid()}`;
  await db.putBlob(audioKey, wav);
  const entry = (await db.put(HISTORY, {
    name,
    at: Date.now(),
    audioKey,
    voice,
    text: text.slice(0, 400),
  })) as ClipEntry;
  await hist.prune();
  return entry;
}

// A short label from the text (for the saved-clip name).
const clipName = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ');
  return (t.length > 48 ? `${t.slice(0, 48)}…` : t) || 'Clip';
};

/** The stored settings, normalised — an unknown voice or a wild speed falls back. */
function config(): { voice: string; speed: number; autosave: boolean } {
  const cfg = getAppConfig(app);
  const voice = typeof cfg.voice === 'string' && voiceById(cfg.voice) ? cfg.voice : DEFAULT_VOICE;
  const raw = Number(cfg.speed);
  return {
    voice,
    speed: Number.isFinite(raw) ? clampSpeed(raw) : 1,
    autosave: cfg.autosave === true,
  };
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  accent: ACCENT,
  order: appMeta.order,
  description: 'Turn text into natural speech with a palette of on-device voices',
  tip: 'Open the voice picker to browse the voices as cards and play any of them before you commit. Then type your text and press Speak — long text is narrated as one seamless clip.',

  // Rendered in Settings > Apps AND behind the settings control in this app's window
  // header — both from this one schema (components/appSettingsFields.ts).
  settings: [
    {
      key: 'voice',
      label: 'Voice',
      hint: 'The voice the studio starts with',
      type: 'select',
      default: DEFAULT_VOICE,
      options: VOICES.map((v) => ({ value: v.id, label: `${v.name} — ${voiceGroup(v)} · ${v.grade}` })),
    },
    {
      key: 'speed',
      label: 'Speaking speed',
      hint: 'The voice’s natural pace is 1.0×',
      type: 'range',
      default: 1,
      min: SPEED_MIN,
      max: SPEED_MAX,
      step: 0.1,
      suffix: '×',
    },
    {
      key: 'autosave',
      label: 'Save every clip',
      hint: 'Add each clip to Saved clips as soon as it is generated',
      type: 'toggle',
      default: false,
    },
  ],

  // KimtAI agent tools — DECLARED but DORMANT (convention 5): no shipped model can
  // drive them today. They route through the same engine + storage the UI uses.
  tools: [
    {
      name: 'list_voices',
      description: 'List the available text-to-speech voices (id, name, accent, gender).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => ({
        ok: true,
        result: VOICES.map((v) => `${v.id} — ${v.name} (${v.lang}, ${v.gender})`).join('\n'),
        summary: `${VOICES.length} voices`,
      }),
    },
    {
      name: 'speak_text',
      description: 'Synthesise speech from text in a chosen voice and save it as a clip. Returns the clip id.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to speak.' },
          voice: { type: 'string', description: "A voice id (defaults to the app's configured voice)." },
          speed: { type: 'number', description: 'Speaking speed, 0.5–2 (defaults to the configured speed).' },
        },
        required: ['text'],
      },
      run: async (args: Record<string, unknown>) => {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return { ok: false, result: 'No text was provided.', summary: 'no text' };
        const cfg = config();
        const voice = typeof args.voice === 'string' && voiceById(args.voice) ? args.voice : cfg.voice;
        const speed = typeof args.speed === 'number' ? clampSpeed(args.speed) : cfg.speed;
        try {
          const wav = await synthesizeToWav(text, { voice, speed });
          const entry = await saveClip(clipName(text), wav, voice, text);
          return { ok: true, result: `Saved clip ${entry.id} in ${voice}.`, summary: 'spoken' };
        } catch (err) {
          return { ok: false, result: err instanceof Error ? err.message : 'Synthesis failed.', summary: 'failed' };
        }
      },
    },
    {
      name: 'list_clips',
      description: 'List saved Voice Studio clips (id, name, voice).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const clips = (await hist.load()) as ClipEntry[];
        if (!clips.length) return { ok: true, result: 'No saved clips.', summary: '0 clips' };
        return {
          ok: true,
          result: clips.map((c) => `${c.id} — ${c.name || 'Clip'} (${c.voice || '?'})`).join('\n'),
          summary: `${clips.length} clips`,
        };
      },
    },
    {
      name: 'delete_clip',
      description: 'Delete a saved clip by id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const id = typeof args.id === 'string' ? args.id : '';
        const clips = (await hist.load()) as ClipEntry[];
        const found = clips.find((c) => c.id === id);
        if (!found) return { ok: false, result: `No clip with id ${id}.`, summary: 'not found' };
        await hist.remove(found as unknown as HistorySidebarEntry);
        return { ok: true, result: `Deleted clip ${id}.`, summary: 'deleted' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall, if present).
  dataLabel: 'saved voice clips',
  hasData: () => db.hasAny(HISTORY),
  async clearData() {
    await db.clearCollection(HISTORY);
    await db.clearBlobsByPrefix(`${HISTORY}/`);
    await db.clearBlobsByPrefix(PREVIEW_BLOB_PREFIX); // the cached voice samples too
  },

  render(body: HTMLElement, ctx: { session?: unknown; saveSession?: (s: unknown) => void } = {}) {
    // Come back to the saved clip the user was on (#1172).
    const entrySession = createEntrySession(ctx);
    let players: ReturnType<typeof createAudioPlayer>[] = [];
    let controller: AbortController | null = null;
    let voice = config().voice;
    let speed = config().speed;
    let busy = false;

    // --- Preview playback (its own job, deliberately independent of `busy`) ----
    // Previewing must never disable Speak or freeze the picker: auditioning voices is
    // the thing you do repeatedly, and the old palette locked the whole app for each
    // one (#1146).
    // MANY fetches, ONE playback.
    //
    // Asking for a second voice used to cancel the first, so a shortlist could not be
    // fetched in one go (#1163). Each voice now owns a job — its own abort, its own
    // progress — and they run together: the network part really is concurrent, while the
    // engine serialises the inference (one WASM session; see the worker).
    // Orchestrator handles, keyed by voice — NOT a registry of our own. It used to be one: a map
    // of AbortControllers with its own labels and ratios, which is the shape #1275 deleted from
    // KimtAI, and it meant the first preview pulled 90 MB with no row, no progress and no Stop
    // anywhere outside this pane (#1304). The cancellation now lives in the job; this map only
    // says which card each job belongs to.
    const previews = new Map<string, Job>();
    let wantPlay: string | null = null; // the voice asked for LAST — the one that plays
    let playingId: string | null = null; // the voice actually sounding, if any
    let previewUrl: string | null = null;

    // Set by the teardown. A preview outlives the pane that started it — the render settles, the
    // job resolves, and the continuation carries on into a UI that has already been taken down —
    // so anything that repaints has to ask whether there is still a window to repaint.
    let torn = false;

    // Which voices are already held on this device (their sample is cached), and whether
    // the shared speech model is. Hearing a voice for the first time is a DOWNLOAD, and
    // the picker says so per card rather than letting the user press play and wait at a
    // silent screen (#1152).
    const ready = new Set<string>();
    let modelReady = false;

    // ONE audio element, in the document, reused for every sample. In the document
    // because its own `playing` / `ended` / `error` events are what drive the button
    // state — a detached `new Audio()` that fails is invisible, which is exactly how a
    // preview came to play nothing with nothing to read (#1152).
    const previewAudio = el('audio', 'vs-preview-audio') as HTMLAudioElement;
    previewAudio.hidden = true;
    previewAudio.preload = 'auto';
    previewAudio.addEventListener('playing', () => syncPreviewButtons());
    previewAudio.addEventListener('ended', () => stopPlayback());

    const stopPlayers = (): void => {
      players.forEach((p) => p.destroy());
      players = [];
    };

    /** Stop whatever is sounding. Downloads in flight are NOT touched (#1163). */
    const stopPlayback = (): void => {
      previewAudio.pause();
      previewAudio.removeAttribute('src');
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      playingId = null;
      syncPreviewButtons();
    };

    /** Cancel one voice's job; every other one carries on. */
    const cancelJob = (id: string): void => {
      const job = previews.get(id);
      if (!job) return;
      job.cancel();
      previews.delete(id);
      if (wantPlay === id) wantPlay = null;
      syncPreviewButtons();
    };

    /** Stop everything — playback and every preview (teardown, or leaving the studio). */
    const stopPreview = (): void => {
      stopPlayback();
      for (const id of [...previews.keys()]) cancelJob(id);
    };

    /** Fetch + render a voice's sample and cache it. One job per voice; `report` is that job's
     *  own progress, so several cards each tell the truth about themselves. */
    const renderSample = async (
      v: Voice,
      signal: AbortSignal,
      report: (label: string, ratio: number | null) => void,
    ): Promise<Blob> => {
      const { pcm, sampleRate } = await synthesizeSpeech(previewLine(v), {
        voice: v.id,
        signal,
        // Per JOB, not one shared bar: with several voices in flight, one bar could only
        // ever tell the truth about one of them.
        onProgress: (p: ProgressInfo) => {
          report(p.label || 'Working', p.ratio ?? null);
          syncPreviewButtons();
        },
      });
      const wav = encodeWav(pcm, sampleRate);
      await db.putBlob(previewKey(v.id), wav);
      ready.add(v.id); // held on this device now — the card becomes a play control
      return wav;
    };

    /**
     * Start playback, and REPORT it when the browser refuses.
     *
     * `play()` is a promise that rejects — most often `NotAllowedError`, because this
     * call happens seconds after the click that asked for it (the sample has to render
     * first), and an autoplay policy counts that as unprompted. Swallowing that
     * rejection is what made a broken preview indistinguishable from a working one
     * (#1152), so a refusal offers the user a control that plays inside a fresh click,
     * which is always allowed.
     */
    const playSample = async (v: Voice, wav: Blob): Promise<void> => {
      stopPlayback();
      previewUrl = URL.createObjectURL(wav);
      previewAudio.src = previewUrl;
      playingId = v.id;
      syncPreviewButtons();
      try {
        await previewAudio.play();
      } catch (err) {
        playingId = null;
        syncPreviewButtons();
        const denied = err instanceof DOMException && err.name === 'NotAllowedError';
        showPreviewError(
          denied
            ? `Your browser blocked ${v.name}'s sample from starting on its own.`
            : `Couldn't play ${v.name}'s sample: ${err instanceof Error ? err.message : String(err)}`,
          v,
        );
      }
    };

    /** Fetch this voice as a registered job, then play it. */
    const startJob = async (v: Voice): Promise<void> => {
      // The first preview pays for the ~90 MB model, and that is a DOWNLOAD — it belongs in the
      // network lane and counts as one. Once the model is on the device a preview is inference
      // over a small voice file, which is compute.
      const cold = !modelReady;
      let wav: Blob | undefined;
      const job = kimtManager.register({
        appId: APP_ID,
        title: cold ? `Downloading the voice model for ${v.name}` : `Preparing ${v.name}'s sample`,
        kind: cold ? 'download' : 'compute',
        // A Stop is offered only when it would really stop. The engine's cancel reaches the
        // inference, but the model load is transformers.js' own fetch inside a worker shared with
        // every other voice — it cannot be aborted, and terminating the worker would kill the
        // other previews with it. So a cold preview shows no Stop rather than one that reports
        // success while 90 MB keeps arriving (#1302's rule, #1304's instance).
        cancellable: !cold,
        run: async (ctx) => {
          wav = await renderSample(v, ctx.signal, (label, ratio) => {
            ctx.note(label);
            ctx.progress(ratio);
          });
        },
      });
      previews.set(v.id, job);
      wantPlay = v.id; // the last one asked for is the one that plays when it lands
      previewError.hidden = true;
      syncPreviewButtons();
      try {
        await job.run();
        // Everything below belongs to a window that may no longer be there. Nothing after this
        // point is worth doing for a closed pane — not the repaint, not the error, and certainly
        // not playing the sample — and `showPreviewError` builds elements, which is a document
        // this pane no longer has any claim on.
        if (torn) return;
        previews.delete(v.id);
        syncPreviewButtons();
        if (job.status() === 'cancelled') return; // stopped from the card or from KimtManager
        if (job.status() === 'failed') throw new Error(job.error() || 'that sample could not be made');
        void refreshModelState();
        // Only the voice the user asked for LAST plays. The others were "get me this
        // too", and three samples talking over each other is nobody's idea of a preview.
        if (wantPlay === v.id && wav) await playSample(v, wav);
      } catch (err) {
        previews.delete(v.id);
        if (wantPlay === v.id) wantPlay = null;
        syncPreviewButtons();
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          showPreviewError(`Couldn't get ${v.name}'s sample: ${err instanceof Error ? err.message : String(err)}`, v);
        }
      }
    };

    /**
     * One control, four meanings — and pressing it never disturbs another voice.
     *
     * Downloading  -> cancel THIS download (the others keep going)
     * Playing      -> stop the audio
     * Held         -> play it
     * Not held     -> start its download, alongside any already running
     */
    const togglePreview = async (v: Voice): Promise<void> => {
      if (previews.has(v.id)) {
        cancelJob(v.id);
        return;
      }
      if (playingId === v.id) {
        stopPlayback();
        return;
      }
      if (ready.has(v.id)) {
        previewError.hidden = true;
        wantPlay = v.id;
        const wav = await db.getBlob(previewKey(v.id));
        if (wav) {
          await playSample(v, wav);
          return;
        }
        ready.delete(v.id); // the cache lied (cleared elsewhere) — fetch it again
      }
      await startJob(v);
    };

    /** The error line, with a retry that plays inside the user's own click. */
    function showPreviewError(message: string, v: Voice): void {
      previewError.replaceChildren(el('span', '', message));
      // The sample itself is rendered and cached by now in the blocked-playback case,
      // so this is instant — and being a real click, nothing can refuse it.
      const retry = el('button', 'link-button vs-preview-retry', `Play ${v.name}'s sample`) as HTMLButtonElement;
      retry.type = 'button';
      retry.addEventListener('click', () => void togglePreview(v));
      previewError.append(retry);
      previewError.hidden = false;
    }

    // --- Voice bar -----------------------------------------------------------
    const barAvatar = el('span', 'vs-avatar');
    const barName = el('strong', 'vs-bar-name', '');
    const barMeta = el('span', 'vs-bar-meta', '');
    const barText = el('span', 'vs-bar-text');
    barText.append(barName, barMeta);

    const barPreview = el('button', 'vs-bar-btn vs-bar-preview') as HTMLButtonElement;
    barPreview.type = 'button';
    barPreview.addEventListener('click', () => {
      const v = voiceById(voice);
      if (v) void togglePreview(v);
    });

    const barChange = el('button', 'vs-bar-btn is-change', 'Change voice') as HTMLButtonElement;
    barChange.type = 'button';
    barChange.addEventListener('click', () => setPickerOpen(!pickerOpen));

    const voiceBar = el('div', 'vs-bar');
    const barActions = el('div', 'vs-bar-actions');
    barActions.append(barPreview, barChange);
    voiceBar.append(barAvatar, barText, barActions);

    const previewError = el('p', 'app-error vs-preview-error');
    previewError.hidden = true;

    // There is no single shared progress bar here on purpose: with several voices in
    // flight (#1163) one bar could only ever tell the truth about one of them, so progress
    // lives on each card (and on the voice bar's own control).

    // Said up front, not after the wait: what hearing a voice will cost the first time.
    const previewNote = el('p', 'app-note vs-preview-note');
    previewNote.hidden = true;

    /** Re-read what is held on this device and repaint the cards that depend on it. */
    async function refreshModelState(): Promise<void> {
      const [keys, cached] = await Promise.all([db.blobKeysByPrefix(PREVIEW_BLOB_PREFIX), isVoiceModelCached()]);
      ready.clear();
      for (const key of keys) {
        const id = key.slice(`${PREVIEW_BLOB_PREFIX}${PREVIEW_VERSION}-`.length);
        if (key.startsWith(`${PREVIEW_BLOB_PREFIX}${PREVIEW_VERSION}-`) && voiceById(id)) ready.add(id);
      }
      modelReady = cached;
      previewNote.textContent = modelReady
        ? 'A voice you have not heard yet downloads its own voice file (about 0.5 MB) the first time. It is then kept for offline use.'
        : `Hearing any voice needs the speech model first — a one-time ~90 MB download, kept for offline use. Each new voice then adds about 0.5 MB.`;
      previewNote.hidden = false;
      syncPreviewButtons();
    }

    // --- Voice picker --------------------------------------------------------
    // The search box and the filter chips are built ONCE; only the grid repaints, so
    // typing never destroys the focused input (the #217 rule).
    let pickerOpen = false;
    let query = '';
    let accentFilter: 'all' | 'en-us' | 'en-gb' = 'all';
    let genderFilter: 'all' | 'Female' | 'Male' = 'all';
    let topOnly = false;

    const picker = el('div', 'vs-picker');
    picker.hidden = true;

    const searchWrap = el('label', 'vs-search');
    searchWrap.innerHTML = SEARCH;
    const search = el('input', 'vs-search-input') as HTMLInputElement;
    search.type = 'search';
    search.placeholder = 'Search voices';
    search.setAttribute('aria-label', 'Search voices');
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      paintGrid();
    });
    searchWrap.append(search);

    const chips: { el: HTMLButtonElement; active: () => boolean }[] = [];
    const chip = (label: string, active: () => boolean, onPick: () => void): HTMLButtonElement => {
      const b = el('button', 'vs-chip', label) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => {
        onPick();
        syncChips();
        paintGrid();
      });
      chips.push({ el: b, active });
      return b;
    };
    const syncChips = (): void => {
      for (const c of chips) {
        const on = c.active();
        c.el.classList.toggle('is-on', on);
        c.el.setAttribute('aria-pressed', String(on));
      }
    };

    const filterRow = el('div', 'vs-filters');
    const accentGroup = el('div', 'vs-chip-group');
    accentGroup.append(
      chip(
        'All accents',
        () => accentFilter === 'all',
        () => (accentFilter = 'all'),
      ),
      chip(
        'US',
        () => accentFilter === 'en-us',
        () => (accentFilter = 'en-us'),
      ),
      chip(
        'UK',
        () => accentFilter === 'en-gb',
        () => (accentFilter = 'en-gb'),
      ),
    );
    const genderGroup = el('div', 'vs-chip-group');
    genderGroup.append(
      chip(
        'All voices',
        () => genderFilter === 'all',
        () => (genderFilter = 'all'),
      ),
      chip(
        'Female',
        () => genderFilter === 'Female',
        () => (genderFilter = 'Female'),
      ),
      chip(
        'Male',
        () => genderFilter === 'Male',
        () => (genderFilter = 'Male'),
      ),
    );
    const topGroup = el('div', 'vs-chip-group');
    topGroup.append(
      chip(
        'Top picks',
        () => topOnly,
        () => (topOnly = !topOnly),
      ),
    );
    filterRow.append(accentGroup, genderGroup, topGroup);

    const pickerCount = el('p', 'vs-picker-count', '');
    const grid = el('div', 'vs-grid');
    picker.append(searchWrap, filterRow, previewNote, pickerCount, grid);

    const matches = (v: Voice): boolean => {
      if (accentFilter !== 'all' && v.lang !== accentFilter) return false;
      if (genderFilter !== 'all' && v.gender !== genderFilter) return false;
      if (topOnly && !TOP_VOICES.includes(v.id)) return false;
      if (!query) return true;
      return `${v.name} ${accentLabel(v)} ${v.gender} ${v.grade}`.toLowerCase().includes(query);
    };

    // Per-card preview buttons, rebuilt with the grid and re-synced after.
    const previewButtons = new Map<string, HTMLButtonElement>();

    // Four states. `download` is the one whose absence made the app look broken: a voice
    // you have never heard has to be fetched before it can speak, so its control says
    // DOWNLOAD, not play (#1152). `working` is per voice — several can be working at once
    // (#1163) — and shows the SHARED button spinner, the same one the App Store's download
    // button uses; the app has no spinner of its own.
    type PreviewState = 'download' | 'play' | 'working' | 'playing';
    const previewState = (id: string): PreviewState => {
      if (previews.has(id)) return 'working';
      if (playingId === id) return 'playing';
      return ready.has(id) ? 'play' : 'download';
    };

    const stateTitle = (state: PreviewState, name: string, size: string): string =>
      ({
        download: `Download ${name} (${size}) and hear a sample`,
        play: `Play ${name}'s sample`,
        working: `Cancel ${name}'s download`,
        playing: `Stop ${name}`,
      })[state];

    /** What a working card says: the job's own words, plus a percentage when there is one. A job
     *  waiting for its turn says so rather than looking like one that has stalled (#1306). */
    const jobLabel = (id: string): string => {
      const job = previews.get(id);
      if (!job) return '';
      if (job.status() === 'queued') return 'Waiting its turn…';
      const label = job.label() || 'Working';
      const ratio = job.progress();
      return ratio != null ? `${label} ${Math.round(ratio * 100)}%` : `${label}…`;
    };

    const stateTag = (id: string, state: PreviewState, size: string): string =>
      state === 'working' ? jobLabel(id) : state === 'download' ? `Not downloaded · ${size}` : '';

    function syncPreviewButtons(): void {
      // Nothing to repaint once the window is gone, and the work that asks for it is exactly the
      // work that outlives the window: a preview's continuation resumes after teardown and paints
      // a pane nobody is looking at. It was unreachable while a render resolved within a
      // microtask of the click; registering the preview as a job (#1304) put real hops in
      // between, and the repaint now lands on the far side of teardown. Reported in #1324.
      if (torn) return;
      // The first voice pays for the shared model; every later one is just its own file.
      const size = modelReady ? 'about 0.5 MB' : 'about 90 MB, once';
      for (const [id, btn] of previewButtons) {
        const state = previewState(id);
        const name = voiceById(id)?.name ?? id;
        btn.classList.toggle('is-playing', state === 'playing');
        btn.classList.toggle('is-loading', state === 'working');
        btn.classList.toggle('is-download', state === 'download');
        btn.innerHTML =
          state === 'playing'
            ? STOP_ICON
            : state === 'working'
              ? '<span class="btn-spinner"></span>' // the shared spinner (components.css)
              : state === 'download'
                ? DOWNLOAD
                : WAVE;
        btn.title = stateTitle(state, name, size);
        btn.setAttribute('aria-label', btn.title);
        // The card says it in words too — an icon alone tells you neither that a voice has
        // to be fetched first nor how far along it is.
        const tag = btn.closest('.vs-card')?.querySelector('.vs-card-state') as HTMLElement | null;
        if (tag) {
          tag.textContent = stateTag(id, state, size);
          tag.hidden = !tag.textContent;
          tag.classList.toggle('is-working', state === 'working');
        }
      }
      const current = voiceById(voice);
      const state = previewState(voice);
      barPreview.classList.toggle('is-playing', state === 'playing');
      barPreview.classList.toggle('is-loading', state === 'working');
      barPreview.innerHTML =
        state === 'playing'
          ? STOP_ICON
          : state === 'working'
            ? '<span class="btn-spinner"></span>'
            : state === 'download'
              ? DOWNLOAD
              : WAVE;
      const label =
        state === 'working' ? jobLabel(voice) : { playing: 'Stop', download: 'Download', play: 'Preview' }[state];
      barPreview.append(el('span', 'vs-bar-btn-label', label));
      barPreview.title = stateTitle(state, current?.name ?? 'this voice', size);
    }

    const markSelectedCard = (): void => {
      for (const card of grid.querySelectorAll('.vs-card')) card.classList.remove('is-selected');
      previewButtons.get(voice)?.closest('.vs-card')?.classList.add('is-selected');
    };

    const voiceCard = (v: Voice): HTMLElement => {
      const card = el('div', 'vs-card');
      if (v.id === voice) card.classList.add('is-selected');

      const pick = el('button', 'vs-card-pick') as HTMLButtonElement;
      pick.type = 'button';
      pick.title = `Use ${v.name}`;
      const avatar = el('span', 'vs-avatar vs-card-avatar', v.name.slice(0, 1).toUpperCase());
      const info = el('span', 'vs-card-info');
      const state = el('span', 'vs-card-meta vs-card-state');
      state.hidden = true;
      info.append(
        el('span', 'vs-card-name', v.name),
        el('span', 'vs-card-meta', accentLabel(v)),
        el('span', 'vs-card-meta', `${v.gender} · Quality ${v.grade}`),
        state,
      );
      pick.append(avatar, info);
      pick.addEventListener('click', () => selectVoice(v.id));

      const play = el('button', 'vs-card-play') as HTMLButtonElement;
      play.type = 'button';
      play.addEventListener('click', () => void togglePreview(v));
      previewButtons.set(v.id, play);

      card.append(pick, play);
      return card;
    };

    function paintGrid(): void {
      previewButtons.clear();
      const list = VOICES.filter(matches);
      // A sample PLAYING on a card the filter just removed would keep sounding with no
      // stop control anywhere (the voice bar's button only governs the SELECTED voice),
      // so filtering a playing voice away stops it. Downloads are deliberately left
      // alone: filtering the grid must not throw away a fetch the user asked for (#1163).
      if (playingId && playingId !== voice && !list.some((v) => v.id === playingId)) stopPlayback();
      pickerCount.textContent = list.length
        ? `${list.length} of ${VOICES.length} voices`
        : 'No voice matches those filters';
      grid.replaceChildren(...list.map(voiceCard));
      syncPreviewButtons();
    }

    function setPickerOpen(open: boolean): void {
      pickerOpen = open;
      picker.hidden = !open;
      barChange.textContent = open ? 'Done' : 'Change voice';
      barChange.setAttribute('aria-expanded', String(open));
      if (open) {
        paintGrid();
        search.focus();
      }
    }

    // Selecting writes the setting: the studio and Settings hold the same value, so the
    // voice you picked is still the voice tomorrow (#1146).
    const selectVoice = (id: string): void => {
      voice = id;
      void setAppConfig(APP_ID, 'voice', id);
      syncVoiceBar();
      markSelectedCard();
      setPickerOpen(false);
    };

    function syncVoiceBar(): void {
      const v = voiceById(voice);
      barAvatar.textContent = (v?.name ?? '?').slice(0, 1).toUpperCase();
      barName.textContent = v?.name ?? voice;
      barMeta.textContent = v ? `${accentLabel(v)} · ${v.gender} · Quality ${v.grade}` : '';
      syncPreviewButtons();
    }

    // --- Studio composer ---------------------------------------------------
    const textarea = el('textarea', 'vs-text');
    textarea.placeholder = 'Type or paste text — a word to check its pronunciation, or a whole article to narrate.';
    textarea.rows = 8;

    const charCount = el('span', 'vs-count', '0 characters');
    textarea.addEventListener('input', () => {
      const n = textarea.value.length;
      charCount.textContent = `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
      speakBtn.disabled = busy || textarea.value.trim().length === 0;
    });

    // Speed control (the one control Kokoro honestly exposes). Persisted when the drag
    // ends, so it is the same value the settings dialog shows.
    const speedInput = el('input', 'vs-speed') as HTMLInputElement;
    speedInput.type = 'range';
    speedInput.min = String(SPEED_MIN);
    speedInput.max = String(SPEED_MAX);
    speedInput.step = '0.1';
    speedInput.value = String(speed);
    speedInput.setAttribute('aria-label', 'Speaking speed');
    const speedVal = el('span', 'vs-speed-val', `${speed.toFixed(1)}×`);
    speedInput.addEventListener('input', () => {
      speed = clampSpeed(Number(speedInput.value) || 1);
      speedVal.textContent = `${speed.toFixed(1)}×`;
    });
    speedInput.addEventListener('change', () => void setAppConfig(APP_ID, 'speed', speed));

    const speakBtn = el('button', 'button-primary vs-speak', 'Speak') as HTMLButtonElement;
    speakBtn.type = 'button';
    speakBtn.disabled = true;
    speakBtn.addEventListener('click', () => void speak());

    const cancelBtn = el('button', 'button-secondary vs-cancel', 'Cancel') as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.hidden = true;
    cancelBtn.addEventListener('click', () => controller?.abort());

    const output = el('div', 'vs-output');
    const progressHost = el('div', 'vs-progress');

    const setBusy = (on: boolean): void => {
      busy = on;
      speakBtn.disabled = on || textarea.value.trim().length === 0;
      speedInput.disabled = on;
      cancelBtn.hidden = !on;
      if (!on) progressHost.replaceChildren();
    };

    const showError = (err: unknown): void => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        progressHost.replaceChildren();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      output.replaceChildren(el('p', 'app-error', `Couldn't generate speech: ${msg}`));
    };

    /**
     * Render the text as speech — THROUGH THE ORCHESTRATOR (#1270).
     *
     * A long passage is synthesised chunk by chunk and the voice model is a ~90 MB download the
     * first time, so this is minutes of work behind one button. None of it was registered: no row in
     * KimtManager, no Stop anywhere but this pane, and a window torn down under it — another tab
     * taking the session over, most of all — left the worker generating for nobody. App convention
     * 11.
     *
     * `savesOnStop` stays false, and that is the honest answer: a clip is only saved once the whole
     * render finishes, so stopping half way genuinely loses the run. The Cancel button beside the
     * pane goes through the orchestrator too, so stopping here and stopping from KimtManager are one
     * path rather than two that can disagree.
     */
    const speak = async (): Promise<void> => {
      const text = textarea.value.trim();
      if (!text || busy) return;
      stopPlayers();
      // Stop the sample that is sounding; downloads in flight keep going. The engine
      // serialises the inference itself, so a render does not need the queue emptied.
      stopPlayback();
      output.replaceChildren();
      controller = new AbortController();
      const progress = createProgressBar({ hint: DOWNLOAD_NOTE });
      progress.update({ phase: 'run', label: 'Preparing…', ratio: null });
      progressHost.replaceChildren(progress.el);
      setBusy(true);
      const abort = controller;
      const job = kimtManager.start({
        appId: APP_ID,
        title: 'Generating speech',
        kind: 'compute',
        run: async (ctx) => {
          // One stop, two owners: the pane's Cancel aborts `controller` directly, KimtManager's
          // aborts `ctx.signal`. Chaining them means either route really stops the worker.
          ctx.signal.addEventListener('abort', () => abort.abort());
          const wav = await synthesizeToWav(text, {
            voice,
            speed,
            signal: abort.signal,
            onProgress: (p: ProgressInfo) => {
              progress.update(p);
              ctx.progress(typeof p?.ratio === 'number' ? p.ratio : null);
            },
          });
          if (ctx.signal.aborted) return; // stopped from KimtManager — do not show or save a partial run
          progressHost.replaceChildren();
          await showResult(wav, text);
        },
      });
      // Queued behind this app's own voice download, the bar says so instead of sitting on
      // "Preparing…" for the length of the transfer (#1306).
      const offQueue = followQueue(job, progress);
      try {
        await job.run();
        // The orchestrator never rejects; it records the outcome. Rethrow so the message reads
        // exactly as it always did — including an abort, which `showError` swallows on purpose.
        if (job.status() === 'failed') throw new Error(job.error() || 'that could not be generated');
      } catch (err) {
        showError(err);
      } finally {
        offQueue();
        setBusy(false);
        controller = null;
      }
    };

    const showResult = async (wav: Blob, text: string): Promise<void> => {
      stopPlayers();
      const url = URL.createObjectURL(wav);
      const player = createAudioPlayer(url);
      players.push(player);

      const actions = el('div', 'app-actions');
      const dl = el('button', 'button-primary', 'Download WAV') as HTMLButtonElement;
      dl.type = 'button';
      dl.addEventListener('click', () => downloadBlob(wav, `${safeFilename(clipName(text), 'voice')}.wav`));
      actions.append(dl);

      const wrap = el('div', 'vs-result');
      wrap.append(
        el('div', 'vs-result-head', `${voiceById(voice)?.name ?? voice} · ${(wav.size / 1024).toFixed(0)} KB`),
        player.el,
        actions,
      );
      output.replaceChildren(wrap);

      // "Save every clip" does the saving for you — offering Save as well would let the
      // same clip be stored twice.
      if (config().autosave) {
        actions.append(el('span', 'vs-saved', 'Saved to clips'));
        await saveClip(clipName(text), wav, voice, text);
        history.refresh();
        return;
      }
      const save = el('button', 'button-secondary', 'Save to clips') as HTMLButtonElement;
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        const entry = await saveClip(clipName(text), wav, voice, text);
        history.refresh();
        history.open(entry);
      });
      actions.append(save);
    };

    // --- Saved clips (shared history + bulk delete/undo) -------------------
    const showSavedClip = async (raw: HistorySidebarEntry): Promise<void> => {
      const entry = raw as ClipEntry;
      stopPlayers();
      stopPlayback(); // opening a saved clip must not throw away voices being fetched
      const url = entry.audioKey ? await db.blobUrl(entry.audioKey) : null;
      const wrap = el('div', 'vs-result');
      wrap.append(el('div', 'vs-result-head', `${voiceById(entry.voice || '')?.name ?? entry.voice ?? 'Clip'}`));
      if (url) {
        const player = createAudioPlayer(url);
        players.push(player);
        wrap.append(player.el);
        const actions = el('div', 'app-actions');
        const dl = el('button', 'button-primary', 'Download WAV') as HTMLButtonElement;
        dl.type = 'button';
        dl.addEventListener('click', async () => {
          const blob = entry.audioKey ? await db.getBlob(entry.audioKey) : null;
          if (blob) downloadBlob(blob, `${safeFilename(entry.name || 'voice', 'voice')}.wav`);
        });
        actions.append(dl);
        wrap.append(actions);
      }
      if (entry.text) wrap.append(el('p', 'vs-clip-text', entry.text));
      composer.replaceChildren(wrap);
    };

    const history = createHistorySidebar({
      emptyText: 'Saved clips will appear here.',
      load: () => hist.load(),
      remove: (entry) => hist.remove(entry),
      itemOf: (entry) => ({ snippet: ((entry as ClipEntry).name as string) || 'Clip' }),
      menu: (entry) => [
        { label: 'Open', icon: OPEN, onClick: () => history.open(entry) },
        {
          label: 'Download WAV',
          icon: DOWNLOAD,
          onClick: async () => {
            const e = entry as ClipEntry;
            const blob = e.audioKey ? await db.getBlob(e.audioKey) : null;
            if (blob) downloadBlob(blob, `${safeFilename(e.name || 'voice', 'voice')}.wav`);
          },
        },
      ],
      onOpen: (entry) => {
        showSavedClip(entry);
        entrySession.remember(entry.id);
      },
      onNew: () => {
        showStudio();
        entrySession.remember(null);
      },
      initialActiveId: entrySession.initialActiveId,
      confirmMessage: 'Delete this clip?',
      undoMessage: 'Clip deleted',
      selectable: true,
      bulkConfirm: (n) => `Delete ${n} clip${n === 1 ? '' : 's'}?`,
      bulkUndo: (n) => `${n} clip${n === 1 ? '' : 's'} deleted`,
    });

    // The composer pane (rebuilt when returning from a saved clip).
    const composer = el('div', 'vs-composer');
    const toolbar = el('div', 'vs-toolbar');
    const speedWrap = el('label', 'vs-speed-wrap');
    speedWrap.append(el('span', 'vs-speed-label', 'Speed'), speedInput, speedVal);
    const speakActions = el('div', 'vs-actions');
    speakActions.append(speakBtn, cancelBtn);
    toolbar.append(charCount, speedWrap, speakActions);

    const showStudio = (): void => {
      stopPlayers();
      stopPlayback(); // likewise: coming back to the studio keeps the downloads running
      composer.replaceChildren(
        voiceBar,
        // `previewNote` belongs to the picker and is appended THERE — mounting it here
        // too would silently move it out of the picker (a node has one parent).
        previewError,
        previewAudio, // in the document so its own events drive the button state (#1152)
        picker,
        textarea,
        toolbar,
        progressHost,
        output,
      );
    };

    const shell = createSidebarShell({
      history,
      reserve: 360,
      width: sidebarWidth,
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    shell.main.append(composer);
    body.replaceChildren(shell.layout);

    syncChips();
    syncVoiceBar();
    paintGrid();
    showStudio();
    history.showNew();
    entrySession.start();
    // What is actually held on this device — which voices can speak now, and whether the
    // model still has to come down. Async, so the cards paint immediately and settle into
    // their real state a moment later.
    void refreshModelState();

    // Settings can change under the app — from its own settings control, or from
    // Settings > Apps while the window is open. Adopt them rather than showing a value
    // the store no longer holds.
    const unsubscribe = store.subscribe(() => {
      const cfg = config();
      if (cfg.voice !== voice) {
        voice = cfg.voice;
        syncVoiceBar();
        markSelectedCard();
      }
      if (cfg.speed !== speed) {
        speed = cfg.speed;
        speedInput.value = String(speed);
        speedVal.textContent = `${speed.toFixed(1)}×`;
      }
    });

    return () => {
      // Both flags go up before anything is stopped: stopping is itself what triggers a repaint.
      // This one is the app's own previews (#1328); the sidebar owns the other (#1329).
      torn = true;
      history.destroy();
      unsubscribe();
      controller?.abort();
      stopPreview();
      stopPlayers();
      shell.responsive.destroy?.();
      disposeVoiceEngine();
    };
  },
};

export default app;
