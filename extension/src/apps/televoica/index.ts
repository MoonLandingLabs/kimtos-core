import { createMediaTextApp } from '../../lib/createMediaTextApp.js';
import { createAudioInput, REC_SOURCE_SETTINGS, appRecSource } from '../../components/audioInput.js';
import { WAVE } from '../../components/icons.js';
import { loadAsJob } from '../../lib/modelJob.js';
import { currentModelId } from '../../lib/modelHosts.js';
import appMeta from './meta.js';

interface ToolCtx {
  attachment?: (kind: string) => { blob: Blob } | null | undefined;
  onProgress?: (p: unknown) => void;
  [key: string]: unknown;
}

const MODELS = ['Xenova/whisper-tiny', 'Xenova/whisper-base', 'Xenova/whisper-small'];
const DEFAULT_MODEL = 'Xenova/whisper-tiny';

/** The configured model, guarded against a stale stored pick (e.g. an old "small") that would
 *  trigger a download of something no longer offered. */
const pickModel = (cfg: Record<string, unknown>): string => {
  const picked = typeof cfg.model === 'string' ? currentModelId(cfg.model) : '';
  return MODELS.includes(picked) ? picked : DEFAULT_MODEL;
};

export default createMediaTextApp({
  id: appMeta.id,
  name: appMeta.name,
  description: 'Extract text from voice notes',
  tip: 'Drag across your transcripts in the sidebar (or tap Select) to delete several at once.',
  accent: appMeta.accent,
  order: appMeta.order,

  // KimtAI agent tool — transcribe the audio the user attached.
  tools: [
    {
      name: 'transcribe_audio',
      description: 'Transcribe the attached audio to text. Optional language code (e.g. "en", "ar").',
      parameters: {
        type: 'object',
        properties: { language: { type: 'string', description: 'ISO code; blank = auto-detect' } },
        required: [],
      },
      needs: { attachment: 'audio' },
      run: async (args: { language?: string }, ctx: ToolCtx) => {
        const att = ctx.attachment?.('audio');
        if (!att)
          return { ok: false, result: 'No audio is attached — ask the user to attach one.', summary: 'no audio' };
        const { transcribeAudio } = await import('../../lib/engines/transcribe.js');
        const opts = {
          model: 'Xenova/whisper-tiny',
          language: args.language || undefined,
          onProgress: ctx.onProgress,
        };
        const text = await transcribeAudio(att.blob, opts);
        return {
          ok: true,
          result: text || 'No speech detected — the audio was silent.',
          summary: `${text.split(/\s+/).filter(Boolean).length} words`,
        };
      },
    },
  ],

  dataLabel: 'transcripts & recordings',

  intro: 'Upload or record a voice note and get the text back.',
  note:
    'Runs entirely in your browser — your audio never leaves your device. The ' +
    'model downloads once (~145 MB for Tiny) and is then cached for offline use; ' +
    'it only uses memory while transcribing. English is most accurate.',
  actionLabel: 'Extract text',
  processingHeading: 'Transcribing your voice note…',
  resultLabel: 'Transcript',
  // Shown instead of a transcript when the recording held no speech. The engine
  // returns an empty string for silence rather than letting Whisper invent a
  // word for it (#805).
  emptyText: 'No speech detected',
  downloadName: 'transcript.txt',

  // Rendered automatically in Settings → Apps.
  settings: [
    {
      key: 'model',
      label: 'Model',
      hint: 'Larger = more accurate, but a bigger download and more memory',
      type: 'select',
      default: DEFAULT_MODEL,
      affectsDownload: true, // switching pre-fetches the new model so use stays offline
      options: [
        { value: 'Xenova/whisper-tiny', label: 'Tiny (fast, ~145 MB)' },
        { value: 'Xenova/whisper-base', label: 'Base (accurate, ~280 MB)' },
        { value: 'Xenova/whisper-small', label: 'Small (most accurate, ~250 MB)' },
      ],
    },
    { key: 'language', label: 'Language', hint: 'Blank = auto-detect (e.g. en, ar)', type: 'text', default: '' },
    ...REC_SOURCE_SETTINGS,
  ],

  // Hand a transcript's audio to Denoise (shown in the result + right-click menu).
  entryLinks: [
    {
      label: 'Remove noise with Denoise',
      icon: WAVE,
      appId: 'denoise',
      againMessage: 'This recording was already denoised. Denoise it again?',
      againConfirm: 'Denoise again',
    },
  ],

  createInput() {
    const audio = createAudioInput(appRecSource('televoica'));
    return {
      el: audio.el,
      onChange: audio.onChange,
      stop: audio.stop,
      load: (clip) =>
        audio.loadBlob(clip.blob!, clip.filename, {
          from: clip.from ?? undefined,
          jobId: clip.jobId,
          srcId: clip.srcId,
        }),
      getData: () => {
        const blob = audio.getBlob();
        return blob
          ? {
              blob,
              filename: audio.getFilename(),
              from: audio.getFrom(),
              jobId: audio.getJob() ?? undefined,
              srcId: audio.getSrcId() ?? undefined,
            }
          : null;
      },
    };
  },

  // A cold run has to fetch the model first, and that is a DOWNLOAD: it belongs in the network
  // lane, counts as one, and is stoppable on its own. Buried inside the transcription job it was
  // none of those things (#1304).
  //
  // It runs HERE, before that job exists, because the orchestrator allows one job per app: a
  // download registered from inside the run would queue behind the run that is awaiting it, and
  // the app would hang on every first use. Skipped when the model is already on the device —
  // without that check every run would pay a second model instantiation for nothing.
  prepare: async (cfg, { onProgress }) => {
    const { prefetchModel, isWhisperCached } = await import('../../lib/engines/transcribe.js');
    const model = pickModel(cfg);
    if (await isWhisperCached(model)) return;
    await loadAsJob({ appId: appMeta.id, title: 'Downloading the speech model', cancellable: true }, (report, sig) =>
      // The engine's progress goes to BOTH: `report` is the job's row in KimtManager, `onProgress`
      // is the bar on the screen the user is actually looking at.
      prefetchModel(
        model,
        (p) => {
          report(p);
          onProgress(p);
        },
        sig,
      ),
    );
  },

  run: async (data, cfg, { onProgress, signal }) => {
    const { transcribeAudio } = await import('../../lib/engines/transcribe.js');
    const language = typeof cfg.language === 'string' && cfg.language ? cfg.language : undefined;
    if (!data?.blob) return '';
    return transcribeAudio(data.blob, { model: pickModel(cfg), language, onProgress, signal });
  },
});
