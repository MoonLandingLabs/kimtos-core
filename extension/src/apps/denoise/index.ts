// Denoise — remove background noise from a recording, on-device. Decodes the
// audio, runs DeepFilterNet3 (ONNX/WASM) over it, and gives back a clean WAV with
// an A/B player. Every run is kept in a local history sidebar (original + cleaned
// audio), so you can revisit past clips. Heavy lifting lives in engines/denoise.js.

import './denoise.css';
import { createAudioInput, REC_SOURCE_SETTINGS, appRecSource } from '../../components/audioInput.js';
import { historyKey } from '@kimtos/config/ui';
import { createProgressBar, type ProgressInfo } from '../../components/progressBar.js';
import { beginJob, endJob } from '../../lib/jobStore.js';
import { kimtManager } from '../../lib/kimtManager.js';
import { followQueue } from '../../lib/queuedProgress.js';
import { mountResumeBanner } from '../../lib/jobRecovery.js';

// The app id, for the job record (kv `denoise:job`, blob `denoise:job-input`) — prefixed so
// AnubisDB attributes it to this app without a registry edit (convention 6).
const APP_ID = 'denoise';
import { createAudioPlayer } from '../../components/audioPlayer.js';
import { createEntrySession, createHistorySidebar, type HistorySidebarEntry } from '../../components/historySidebar.js';
import { createSidebarShell } from '../../components/sidebarShell.js';
import { dataStore as db } from '../../lib/dataStore.js';
import { createBlobHistory } from '../../lib/blobHistory.js';
import { createHandoffLinks } from '../../lib/handoffLinks.js';
import { takeHandoff, reportHandoff } from '../../lib/appHandoff.js';
import { el } from '../../lib/dom.js';
import { downloadUrl } from '../../lib/download.js';
import { DOWNLOAD, OPEN, TEXT } from '../../components/icons.js';
import appMeta from './meta.js';

interface ToolCtx {
  attachment?: (kind: string) => { blob: Blob } | null | undefined;
  addAttachment?: (att: { kind: string; blob: Blob; filename: string }) => void;
  onProgress?: (p: unknown) => void;
  [key: string]: unknown;
}
interface DenoiseEntry {
  id: string;
  name?: string;
  at?: number;
  origKey?: string;
  cleanKey?: string;
  from?: string | null;
  srcId?: string | null;
  [key: string]: unknown;
}
interface Clip {
  blob?: Blob;
  filename?: string;
  from?: string | null;
  jobId?: string;
  srcId?: string;
  fromLabel?: string;
}

const ACCENT = appMeta.accent;
const HISTORY = historyKey('denoise');
const HISTORY_LIMIT = 30;
let sidebarWidth = 220; // drag-resizable; persists across opens within the session.

const baseName = (name: string | undefined): string => (name || 'denoised').replace(/\.[^.]+$/, '') || 'denoised';

const hist = createBlobHistory(HISTORY, { limit: HISTORY_LIMIT, blobKeys: ['origKey', 'cleanKey'] });
const loadHistory = hist.load;
const removeEntry = hist.remove;

const saveEntry = async (
  name: string,
  orig: Blob,
  clean: Blob,
  from?: string | null,
  srcId?: string | null,
): Promise<DenoiseEntry> => {
  const origKey = `${HISTORY}/${db.uid()}`;
  const cleanKey = `${HISTORY}/${db.uid()}`;
  await db.putBlob(origKey, orig);
  await db.putBlob(cleanKey, clean);
  const entry = await db.put(HISTORY, {
    name,
    at: Date.now(),
    origKey,
    cleanKey,
    from: from || null,
    srcId: srcId || null,
  });
  await hist.prune();
  return entry as DenoiseEntry;
};

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Remove background noise from audio',
  tip: 'Drag across your cleaned clips in the sidebar (or tap Select) to delete several at once.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tool — clean the attached audio; the result is re-attached so it
  // can then be transcribed.
  tools: [
    {
      name: 'remove_noise',
      description: 'Remove background noise from the attached audio. The cleaned clip is re-attached.',
      parameters: { type: 'object', properties: {}, required: [] },
      needs: { attachment: 'audio' },
      run: async (_args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = ctx.attachment?.('audio');
        if (!att)
          return { ok: false, result: 'No audio is attached — ask the user to attach one.', summary: 'no audio' };
        const { denoiseAudio } = await import('../../lib/engines/denoise.js');
        const opts = { onProgress: ctx.onProgress };
        const wav = await denoiseAudio(att.blob, opts);
        ctx.addAttachment?.({ kind: 'audio', blob: wav, filename: 'denoised.wav' });
        return {
          ok: true,
          result: 'Removed background noise. The cleaned audio is now attached — you can transcribe it.',
          summary: 'noise removed',
        };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall, if present).
  dataLabel: 'cleaned-audio history',
  hasData: () => db.hasAny(HISTORY),
  async clearData() {
    await db.clearCollection(HISTORY);
    await db.clearBlobsByPrefix(`${HISTORY}/`);
  },

  // Rendered automatically in Settings → Apps.
  settings: [...REC_SOURCE_SETTINGS],

  render(
    body: HTMLElement,
    ctx: { openApp?: (id: string) => void; session?: unknown; saveSession?: (s: unknown) => void } = {},
  ) {
    // Come back to the clip the user was listening to (#1172).
    const entrySession = createEntrySession(ctx);
    const openApp = ctx.openApp;
    let players: ReturnType<typeof createAudioPlayer>[] = []; // players shown, so we can stop them
    let activeInput: ReturnType<typeof createAudioInput> | null = null; // the live recorder, if any
    let pendingJob: string | null = null; // a handed-over job opened here but not yet run

    // Everything that holds a device or a timer dies with the pane it lives in.
    // An input left behind by a pane swap keeps a live microphone and a running
    // MediaRecorder, and each new recording piled another one on top (#805).
    const stopPlayers = (): void => {
      players.forEach((p) => p.destroy());
      players = [];
      activeInput?.destroy();
      activeInput = null;
    };

    // Cross-app handoff: offer to send a cleaned clip to Voice to Text (or forward
    // the input clip as-is, without denoising).
    const handoff = createHandoffLinks({
      self: { id: 'denoise', name: 'Denoise' },
      openApp,
      links: [
        {
          appId: 'televoica',
          label: 'Extract transcript with Voice to Text',
          icon: TEXT,
          working: 'Transcribing…',
          blobKey: (entry) => entry.cleanKey as string | undefined,
          filename: (entry) => `${baseName(entry.name)}-clean.wav`,
          againMessage: 'This recording was already transcribed. Transcribe it again?',
          againConfirm: 'Transcribe again',
        },
      ],
    });

    const downloadClean = async (entry: DenoiseEntry): Promise<void> => {
      const url = entry.cleanKey ? await db.blobUrl(entry.cleanKey) : null;
      if (url) downloadUrl(url, `${baseName(entry.name)}.wav`);
    };

    const showInput = (initialClip?: Clip): void => {
      stopPlayers();
      const intro = el(
        'p',
        'placeholder-lead',
        'Upload or record audio and get a clean version with the background noise removed.',
      );
      const note = el(
        'p',
        'app-note',
        'Runs entirely in your browser — your audio never leaves your device. The model ' +
          'downloads once (~16 MB) and is then cached for offline use.',
      );
      const input = createAudioInput(appRecSource('denoise'));
      activeInput = input;
      // A clip handed over from another app pre-fills it, carrying provenance + job id.
      if (initialClip?.blob)
        input.loadBlob(initialClip.blob, initialClip.filename, {
          from: initialClip.from ?? undefined,
          jobId: initialClip.jobId,
          srcId: initialClip.srcId,
        });
      const actions = el('div', 'app-actions');
      const runBtn = el('button', 'button-primary', 'Remove noise');
      runBtn.type = 'button';
      runBtn.addEventListener('click', () => execute(input));
      actions.append(runBtn);

      // Secondary action: forward the clip to Voice to Text as-is (without denoising).
      let toText: ReturnType<typeof handoff.forwardButton> | null = null;
      const [forwardLink] = handoff.forwardLinks();
      if (forwardLink) {
        toText = handoff.forwardButton(forwardLink, () => {
          const blob = input.getBlob();
          return blob
            ? {
                blob,
                filename: input.getFilename() || 'recording.webm',
                from: input.getFrom() || null,
                srcId: input.getSrcId() ?? undefined,
              }
            : null;
        });
        actions.append(toText.el);
      }

      const syncActions = (): void => {
        const has = !!input.getBlob();
        runBtn.disabled = !has;
        if (toText) toText.sync(has ? { from: input.getFrom() || null } : null);
      };
      input.onChange(syncActions);
      syncActions();

      const nodes: Node[] = [intro, note];
      if (initialClip?.fromLabel) nodes.push(el('p', 'mt-from', `From ${initialClip.fromLabel}`));
      nodes.push(input.el, actions);
      main.replaceChildren(...nodes);

      // The resume offer lives in lib/jobRecovery.ts — the media-text apps need exactly the same
      // thing (#338), and a second copy of it here would have been the third hand-maintained
      // version of one behaviour.
      void mountResumeBanner(APP_ID, main, {
        verb: 'being cleaned up',
        onResume: (blob, name) => {
          input.loadBlob(blob, name);
          void execute(input);
        },
      });
    };

    const execute = async (input: ReturnType<typeof createAudioInput>): Promise<void> => {
      // Read the clip BEFORE tearing the input down — stopPlayers() releases the
      // microphone and the player, and there is no input screen from here on.
      const blob = input.getBlob();
      if (!blob) return;
      const job = input.getJob();
      const name = input.getFilename() || 'recording.webm';
      const from = input.getFrom();
      const srcId = input.getSrcId();
      stopPlayers();

      const bar = createProgressBar({ hint: 'One-time model download — cached and offline afterwards.' });
      bar.update({ phase: 'run', label: 'Preparing…', ratio: null });
      main.replaceChildren(el('p', 'progress-heading', 'Removing noise…'), bar.el);

      // Tell the source app (if handed over) that we're working; we own reporting now.
      if (job) {
        if (job === pendingJob) pendingJob = null;
        reportHandoff(job, 'processing');
      }
      try {
        // WRITE THE JOB DOWN BEFORE RUNNING IT. Until now nothing touched disk until the engine
        // resolved, so closing the tab mid-run destroyed the work — and the INPUT with it. This
        // recording exists nowhere else; that is what made it the worst case (#314). The input and
        // a record of what we were doing to it land first, so a dead tab leaves something to come
        // back to.
        await beginJob(APP_ID, { kind: 'denoise', name }, blob);

        // Run it THROUGH the orchestrator, not beside it (#1172). That is what puts this run in
        // KimtManager with a live label while it works, and what gives the user somewhere to stop
        // it from. `jobStore` above is the durable half — it survives the page dying, which no
        // in-memory registry can — and the two are complementary rather than duplicates.
        const task = kimtManager.start({
          appId: APP_ID,
          title: `Cleaning ${name}`,
          kind: 'compute',
          run: async (ctx) => {
            const { denoiseAudio } = await import('../../lib/engines/denoise.js');
            const opts = {
              onProgress: (p: ProgressInfo) => {
                bar.update(p);
                ctx.progress(typeof p?.ratio === 'number' ? p.ratio : null);
              },
            };
            const cleaned = await denoiseAudio(blob, opts);
            if (ctx.signal.aborted) return; // stopped from KimtManager — do not save a partial result
            if (job) reportHandoff(job, 'done');
            history.open(await saveEntry(name, blob, cleaned, from, srcId));
          },
        });
        // Queued behind this app's own model download, the bar says so instead of sitting on
        // "Preparing…" for the length of the transfer (#1306).
        const offQueue = followQueue(task, bar);
        try {
          await task.run();
        } finally {
          offQueue();
        }
        // The orchestrator never rejects; it records the outcome. Rethrow so the catch below shows
        // the message exactly as it always did.
        if (task.status() === 'failed') throw new Error(task.error() || 'the audio could not be processed');
        await endJob(APP_ID); // the result is saved; there is nothing to recover
      } catch (err) {
        if (job) reportHandoff(job, 'error');
        // Clear on the FAILURE path too. A job that has already told the user it failed must not
        // greet them with an offer to resume it the next time they open the app.
        await endJob(APP_ID);
        const msg = err instanceof Error ? err.message : String(err);
        main.replaceChildren(el('p', 'app-error', `Couldn't process the audio: ${msg}`));
      }
    };

    const showResult = async (raw: HistorySidebarEntry): Promise<void> => {
      const entry = raw as DenoiseEntry;
      stopPlayers();
      const cleanUrl = entry.cleanKey ? await db.blobUrl(entry.cleanKey) : null;
      const origUrl = entry.origKey ? await db.blobUrl(entry.origKey) : null;

      const track = (title: string, url: string | null): HTMLElement => {
        const wrap = el('div', 'denoise-track');
        wrap.append(el('span', 'denoise-track-label', title));
        if (url) {
          const player = createAudioPlayer(url);
          players.push(player);
          wrap.append(player.el);
        }
        return wrap;
      };

      const result = el('div', 'denoise-result');
      const dl = el('a', 'button-primary', 'Download cleaned WAV');
      if (cleanUrl) {
        dl.href = cleanUrl;
        dl.download = `${baseName(entry.name)}.wav`;
      }
      const actions = el('div', 'app-actions');
      actions.append(dl);
      // Offer transcription — unless this clip came from Voice to Text already.
      for (const l of handoff.linksFor(entry)) actions.append(handoff.resultButton(l, entry).el);
      result.append(track('Cleaned', cleanUrl), track('Original', origUrl), actions);
      main.replaceChildren(result);
    };

    const history = createHistorySidebar({
      emptyText: 'Cleaned clips will appear here.',
      load: loadHistory,
      remove: removeEntry,
      itemOf: (entry) => ({ snippet: ((entry as DenoiseEntry).name as string) || 'Audio' }),
      menu: (entry) => [
        { label: 'Open', icon: OPEN, onClick: () => history.open(entry) },
        { label: 'Download cleaned', icon: DOWNLOAD, onClick: () => downloadClean(entry as DenoiseEntry) },
        ...handoff.menuItems(entry),
      ],
      onOpen: (entry) => {
        showResult(entry);
        entrySession.remember(entry.id);
      },
      onNew: () => {
        showInput();
        entrySession.remember(null);
      },
      initialActiveId: entrySession.initialActiveId,
      confirmMessage: 'Delete this clip?',
      undoMessage: 'Clip deleted',
      selectable: true,
      bulkConfirm: (n) => `Delete ${n} clip${n === 1 ? '' : 's'}?`,
      bulkUndo: (n) => `${n} clip${n === 1 ? '' : 's'} deleted`,
    });
    const shell = createSidebarShell({
      history,
      reserve: 320,
      width: sidebarWidth,
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    const main = shell.main;
    const responsive = shell.responsive;
    body.replaceChildren(shell.layout);
    history.showNew();
    entrySession.start();

    // A clip handed over from another app: start on the input screen pre-loaded.
    const job = takeHandoff('denoise');
    if (job) {
      pendingJob = job.jobId;
      showInput(job as Clip);
    }

    // Stop playback + observers on close; report an unrun handed-over job as error.
    return () => {
      history.destroy(); // first: stopping things below is itself what asks the sidebar to repaint
      stopPlayers();
      responsive.destroy?.();
      if (pendingJob) reportHandoff(pendingJob, 'error');
    };
  },
};

export default app;
