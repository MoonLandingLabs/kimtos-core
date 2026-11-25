// Factory for "media in → text out" apps: the user provides input (audio,
// image, …), we run it through an on-device engine with live progress steps,
// then render the text. The Voice to Text app (televoica) uses this.
//
// The caller supplies:
//   createInput()                 -> { el, onChange(fn), getData() | null, stop?() }
//   run(data, cfg, { onProgress, signal })-> string | { text }   (engine progress; abort)
//   plus copy: intro, note, actionLabel, processingHeading, resultLabel, …
//
// Every successful result is saved to a local, per-app history (kept on-device):
// the text plus the original media (audio/image), so the user can revisit a past
// run, replay the audio, and copy the text. History lives in a left sidebar.
// Pass `history: false` to opt out (plain single-pane flow).
//
// Everything else (id/name/accent/dialog/settings/order) is spread onto the
// returned descriptor.

import { createProgressBar, type ProgressInfo } from '../components/progressBar.js';
import { createResultView } from '../components/resultView.js';
import { createAudioPlayer } from '../components/audioPlayer.js';
import { createEntrySession, createHistorySidebar } from '../components/historySidebar.js';
import { createSidebarShell } from '../components/sidebarShell.js';
import { getAppConfig } from './appConfig.js';
import { beginJob, endJob } from './jobStore.js';
import { kimtManager } from './kimtManager.js';
import { followQueue } from './queuedProgress.js';
import { mountResumeBanner } from './jobRecovery.js';
import { downloadText } from './download.js';
import { dataStore as db } from './dataStore.js';
import { createBlobHistory } from './blobHistory.js';
import { createHandoffLinks, type HandoffLink } from './handoffLinks.js';
import { takeHandoff, reportHandoff } from './appHandoff.js';
import { el } from './dom.js';
import { DOWNLOAD, OPEN, COPY } from '../components/icons.js';

const MODEL_HINT = 'The model downloads once and is cached — after that it runs offline.';
const HISTORY_LIMIT = 50;
let sidebarWidth = 220; // drag-resizable; persists across opens within the session.

function leadText(text: string, className = 'placeholder-lead'): HTMLParagraphElement {
  return el('p', className, text);
}

const snippet = (text: string): string => {
  const oneLine = (text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine || '(empty)';
};

/** The clip/data the caller's input control produces. */
export interface InputData {
  blob?: Blob;
  filename?: string;
  from?: string | null;
  srcId?: string;
  jobId?: string;
  text?: string;
  fromLabel?: string;
  [key: string]: unknown;
}

/** The controller a caller's `createInput()` returns. */
export interface InputController {
  el: HTMLElement;
  getData: () => InputData | null;
  onChange?: (fn: () => void) => void;
  stop?: () => void;
  /** Release capture hardware and timers. Called whenever the pane is replaced. */
  destroy?: () => void;
  load?: (clip: InputData) => void;
}

type RunResult = string | ({ text?: string } & Record<string, unknown>);

/** The media control shown alongside a result — an image preview or an audio player. */
interface ActiveMedia {
  el: HTMLElement;
  destroy?: () => void;
  kind: 'image' | 'audio';
}

export interface MediaTextConfig {
  id: string;
  name: string;
  intro: string;
  note?: string;
  actionLabel?: string;
  processingHeading?: string;
  resultLabel?: string;
  emptyText?: string;
  downloadName?: string;
  createInput: () => InputController;
  /**
   * Fetch whatever the run will need, BEFORE the run's job exists.
   *
   * A model download is a job of its own (convention 11), and it cannot be started from inside
   * the run: the orchestrator allows one job per app, so a download registered by a running
   * compute job queues behind the very job that is awaiting it — a deadlock, and the app hangs
   * on its first cold run. Anything that registers a job belongs here.
   */
  prepare?: (cfg: Record<string, unknown>, opts: { onProgress: (p: ProgressInfo) => void }) => Promise<void> | void;
  run: (
    data: InputData | null,
    cfg: Record<string, unknown>,
    /** `signal` is the job's own abort. An engine that can honour it MUST take it: without one
     *  the run was structurally unstoppable, so KimtManager's Stop deleted the row and left the
     *  work going (#1304). */
    opts: { onProgress: (p: ProgressInfo) => void; signal: AbortSignal },
  ) => Promise<RunResult> | RunResult;
  pickText?: (data: { text?: string }) => string | undefined;
  history?: boolean;
  itemNoun?: string;
  mediaFirst?: boolean;
  entryLinks?: HandoffLink[];
  dataLabel?: string;
  // dialog / settings / order / accent / … are spread onto the descriptor.
  [key: string]: unknown;
}

/** A saved history entry (text + optional source blob). */
interface HistoryEntry {
  id: string;
  text?: string;
  at?: number;
  blobKey?: string;
  mime?: string;
  name?: string;
  from?: string | null;
  srcId?: string | null;
  [key: string]: unknown;
}

export function createMediaTextApp(config: MediaTextConfig) {
  const {
    id: appId, // the job record is keyed by app id (kv `<id>:job`) — convention 6
    intro,
    note,
    actionLabel = 'Run',
    processingHeading = 'Working…',
    resultLabel = 'Result',
    emptyText = '',
    downloadName = 'result.txt',
    createInput,
    prepare,
    run,
    pickText = (data) => data.text,
    history: historyEnabled = true,
    itemNoun = 'transcript', // singular noun for delete confirmations
    mediaFirst = true, // result order: media then text (false → text then media)
    // Cross-app links: each { label, icon, appId } sends a result's source media
    // to another app (e.g. Voice to Text → Denoise). Shown in the result actions
    // and the history right-click menu.
    entryLinks = [],
  } = config;

  const HISTORY = `history:${config.id}`;
  const hist = createBlobHistory(HISTORY, { limit: HISTORY_LIMIT, blobKeys: ['blobKey'] });
  const loadHistory = hist.load;
  const removeEntry = hist.remove;

  const saveHistory = async (
    text: string,
    blob?: Blob,
    name?: string,
    from?: string | null,
    srcId?: string | null,
  ): Promise<HistoryEntry> => {
    let blobKey: string | undefined;
    if (blob) {
      blobKey = `${HISTORY}/${db.uid()}`;
      await db.putBlob(blobKey, blob);
    }
    const entry = await db.put(HISTORY, {
      text,
      at: Date.now(),
      blobKey,
      mime: blob?.type || '',
      name: name || (blob as File | undefined)?.name || '',
      from: from || null, // the app this clip came from (hide the link back to it)
      srcId: srcId || null, // the source record's id (detect re-processing the same one)
    });
    await hist.prune(); // keep newest N
    return entry as HistoryEntry;
  };

  // A player for the saved media: a themed audio player, or an image preview.
  // `kind` is what tells the result box whether to share the pane's height with
  // the text (an image) or keep its natural one (the audio player, a fixed-height
  // control).
  async function mediaEl(entry: HistoryEntry): Promise<ActiveMedia | null> {
    if (!entry?.blobKey) return null;
    const url = await db.blobUrl(entry.blobKey);
    if (!url) return null;
    if ((entry.mime || '').startsWith('image/')) {
      const img = el('img', 'mt-media-img');
      img.src = url;
      img.alt = entry.name || 'Input image';
      return { el: img, destroy: () => {}, kind: 'image' };
    }
    return { ...createAudioPlayer(url), kind: 'audio' };
  }

  return {
    ...config,

    // History-backed apps own a `history:<id>` collection plus its media blobs.
    // Expose it so the App Store can offer to erase it on uninstall. A `dataLabel`
    // on the config gives the prompt a friendlier name than the default.
    ...(historyEnabled
      ? {
          dataLabel: config.dataLabel || 'history',
          hasData: () => db.hasAny(HISTORY),
          async clearData() {
            await db.clearCollection(HISTORY);
            await db.clearBlobsByPrefix(`${HISTORY}/`);
          },
        }
      : {}),

    render(
      body: HTMLElement,
      ctx: { openApp?: (id: string) => void; session?: unknown; saveSession?: (s: unknown) => void } = {},
    ) {
      const openApp = ctx.openApp;
      // Which transcript the user was reading when they minimized (#1172). Saved from the
      // sidebar's own open/new callbacks, so there is no third place tracking "where am I".
      const entrySession = createEntrySession(ctx);
      let mainEl!: HTMLElement;
      let history: ReturnType<typeof createHistorySidebar> | null = null;
      let responsive: { destroy?: () => void } | null = null;
      let activeMedia: ActiveMedia | null = null;
      let activeInput: InputController | null = null;
      let pendingJob: string | null = null;

      // Cross-app handoff links (e.g. "Remove noise with Denoise"): send a result's
      // source media to another app, tracking each send so buttons/menu-items reflect
      // its progress. `linksFor` drops the entry's own origin; the factory's links
      // hand off the source blob (entry.blobKey — the default), keyed by config.id.
      const handoff = createHandoffLinks({
        self: { id: config.id, name: config.name },
        openApp,
        links: entryLinks,
      });

      // Everything that holds a device or a timer dies with the pane it lives in.
      // The input matters as much as the player: an input left behind by a pane
      // swap keeps recording from a live microphone, and each new recording piled
      // another one on top (#805).
      const stopMedia = () => {
        activeMedia?.destroy?.();
        activeMedia = null;
        activeInput?.destroy?.();
        activeInput = null;
      };
      const restart = () => (history ? history.showNew() : showInput());

      const saveText = (entry: HistoryEntry) => downloadText(entry.text || '', downloadName);

      const showInput = (error?: string | null, handoffClip?: InputData) => {
        stopMedia();
        const input = createInput();
        activeInput = input;
        // A clip handed over from another app pre-fills the input.
        if (handoffClip && input.load) input.load(handoffClip);

        const action = el('button', 'button-primary', actionLabel);
        action.addEventListener('click', () => execute(input));

        // Secondary actions: hand the current clip to another app instead (e.g.
        // "Remove noise with Denoise" before/without transcribing here).
        const actions = el('div', 'app-actions');
        actions.append(action);
        const forwards: ReturnType<typeof handoff.forwardButton>[] = [];
        for (const l of handoff.forwardLinks()) {
          const fb = handoff.forwardButton(l, () => input.getData());
          forwards.push(fb);
          actions.append(fb.el);
        }

        const syncActions = () => {
          const data = input.getData();
          action.disabled = !data;
          for (const f of forwards) f.sync(data); // enable when there's a clip; hide if from its origin
        };
        input.onChange?.(syncActions);
        syncActions();

        const nodes: Node[] = [];
        // Show where a handed-over clip came from.
        if (handoffClip?.fromLabel) nodes.push(el('p', 'mt-from', `From ${String(handoffClip.fromLabel)}`));
        nodes.push(leadText(intro), input.el, actions);
        if (note) nodes.push(leadText(note, 'app-note'));
        if (error) nodes.push(el('p', 'app-error', error));
        mainEl.replaceChildren(...nodes);

        // A job that never finished means the tab died mid-run. The file it was working on is on
        // disk (written before the engine started), so offer it back rather than let it rot: for
        // Voice to Text a clip recorded in the app exists nowhere else (#338).
        void mountResumeBanner(appId, mainEl, {
          verb: processingHeading.replace(/[….]+$/, '').toLowerCase(),
          onResume: (blob, name) => void execute(input, { blob, filename: name }),
        });
      };

      const showResult = async (entry: HistoryEntry) => {
        stopMedia();
        const view = createResultView({
          label: resultLabel,
          text: entry.text,
          emptyText,
          downloadName,
          onRestart: restart,
        });
        // Cross-app links (e.g. "Remove noise with Denoise"), if this result still
        // has its source media. Each button follows the job: Opening… → Working… →
        // Done ✓ (or re-enables on error).
        const links = handoff.linksFor(entry);
        const linkRow = links.length ? el('div', 'mt-links') : null;
        for (const l of links) linkRow?.append(handoff.resultButton(l, entry).el);

        const media = await mediaEl(entry);
        if (media) {
          activeMedia = media;
          const wrap = el('div', 'mt-result');
          // `is-image` makes the box share the pane's height with the text card, so a
          // tall image scales down instead of pushing the text out of view (#619) and
          // grows with a maximized window (#626). Audio keeps its natural height.
          const box = el('div', media.kind === 'image' ? 'mt-media is-image' : 'mt-media');
          box.append(media.el);
          // mediaFirst (default): media on top, then the text. Image to Text flips
          // it so the extracted text reads first and the preview sits below.
          wrap.append(...(mediaFirst ? [box, view.el] : [view.el, box]));
          if (linkRow) wrap.append(linkRow);
          mainEl.replaceChildren(wrap);
        } else if (linkRow) {
          const wrap = el('div', 'mt-result');
          wrap.append(view.el, linkRow);
          mainEl.replaceChildren(wrap);
        } else {
          mainEl.replaceChildren(view.el);
        }
      };

      // `recovered` re-runs a job whose tab died: the blob comes off disk (jobStore), not out of
      // the input component, which no longer holds it. Everything downstream is identical.
      const execute = async (input: InputController, recovered?: InputData) => {
        // Read the clip BEFORE tearing the input down — stopMedia() releases the
        // microphone and the player, and there is no input screen from here on.
        const data = recovered ?? input.getData();
        stopMedia();
        const cfg = getAppConfig(config);

        const bar = createProgressBar({ hint: MODEL_HINT });
        mainEl.replaceChildren(el('p', 'progress-heading', processingHeading), bar.el);

        // Tell the source app (if this clip was handed over) that we're working;
        // we now own reporting for this job, so teardown won't cancel it.
        if (data?.jobId) {
          if (data.jobId === pendingJob) pendingJob = null;
          reportHandoff(data.jobId, 'processing');
        }
        const name = data?.filename || 'recording';
        try {
          // WRITE THE JOB DOWN BEFORE RUNNING IT. Nothing touched disk until the engine resolved,
          // so closing the tab mid-run destroyed the work AND the input — and for Voice to Text a
          // clip recorded in the app exists nowhere else, exactly as with Denoise (#314, #338).
          if (data?.blob) await beginJob(appId, { kind: appId, name }, data.blob);

          // Outside the run's job, deliberately — see `prepare`. Its own work registers its own
          // jobs, which is what puts a model download in the network lane with a Stop of its own.
          await prepare?.(cfg, { onProgress: (p) => bar.update(p) });

          // Run it THROUGH the orchestrator, not beside it (#1172): that is what puts this run in
          // KimtManager with a live label while it works, and gives the user somewhere to stop it
          // from. `jobStore` above is the durable half — it survives the page dying, which no
          // in-memory registry can — so the two are complementary rather than duplicates.
          const task = kimtManager.start({
            appId,
            title: `Working on ${name}`,
            kind: 'compute',
            run: async (ctx) => {
              const result = await run(data, cfg, {
                onProgress: (p) => {
                  bar.update(p);
                  ctx.progress(typeof p?.ratio === 'number' ? p.ratio : null);
                },
                signal: ctx.signal,
              });
              if (ctx.signal.aborted) return; // stopped from KimtManager — do not save a partial run
              const text = typeof result === 'string' ? result : pickText(result);
              if (data?.jobId) reportHandoff(data.jobId, 'done');
              if (historyEnabled && (text || '').trim()) {
                history?.open(await saveHistory(text || '', data?.blob, data?.filename, data?.from, data?.srcId));
              } else {
                showResult({ id: '', text: text || '' });
              }
            },
          });
          // While it waits for a slot, the bar reports the wait rather than pretending to work.
          const offQueue = followQueue(task, bar);
          try {
            await task.run();
          } finally {
            offQueue();
          }
          // The orchestrator never rejects; it records the outcome. Rethrow so the catch below
          // shows the message exactly as it always did.
          if (task.status() === 'failed') throw new Error(task.error() || 'that could not be processed');
          await endJob(appId); // saved — nothing to recover
        } catch (err) {
          if (data?.jobId) reportHandoff(data.jobId, 'error');
          // Clear on failure too: a job that has told the user it failed must not come back
          // tomorrow as an offer to resume it.
          await endJob(appId);
          showInput(err instanceof Error ? err.message : String(err));
        }
      };

      if (historyEnabled) {
        history = createHistorySidebar({
          emptyText: 'Nothing yet — your transcripts will appear here.',
          load: loadHistory,
          remove: removeEntry,
          itemOf: (entry) => ({ snippet: snippet((entry.text as string) || '') }),
          menu: (entry) => [
            { label: 'Open', icon: OPEN, onClick: () => history?.open(entry) },
            {
              label: 'Copy text',
              icon: COPY,
              onClick: () => navigator.clipboard?.writeText((entry.text as string) || '').catch(() => {}),
            },
            { label: 'Download .txt', icon: DOWNLOAD, onClick: () => saveText(entry) },
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
          confirmMessage: `Delete this ${itemNoun}?`,
          undoMessage: `${itemNoun[0].toUpperCase()}${itemNoun.slice(1)} deleted`,
          selectable: true,
          bulkConfirm: (n) => `Delete ${n} ${itemNoun}${n === 1 ? '' : 's'}?`,
          bulkUndo: (n) => `${n} ${itemNoun}${n === 1 ? '' : 's'} deleted`,
        });
        const shell = createSidebarShell({
          history,
          reserve: 300,
          width: sidebarWidth,
          onResize: (w) => {
            sidebarWidth = w;
          },
        });
        mainEl = shell.main;
        responsive = shell.responsive;
        body.replaceChildren(shell.layout);
        // Something on screen straight away; the sidebar swaps in the restored entry when its
        // (async) list resolves, or leaves this input screen if that entry is gone.
        history.showNew();
        entrySession.start();
      } else {
        mainEl = el('div', 'app-flow');
        body.replaceChildren(mainEl);
        showInput();
      }

      // A clip handed over from another app (e.g. Denoise → here): start on the
      // input screen with it pre-loaded, ready to run.
      const job = takeHandoff(config.id);
      if (job) {
        pendingJob = job.jobId;
        showInput(null, job);
      }

      // Stop audio + observers on close; if a handed-over job was never run, tell
      // the source app so its button doesn't stay stuck and the listener is freed.
      return () => {
        history?.destroy(); // first: stopping things below is itself what asks the sidebar to repaint
        stopMedia();
        responsive?.destroy?.();
        if (pendingJob) reportHandoff(pendingJob, 'error');
      };
    },
  };
}
