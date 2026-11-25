// Per-app downloadable assets: installing an app fetches everything it needs for
// its CURRENT configuration, so that USING the app only does realtime work (no
// downloads). When a download-affecting setting changes, the App Store / settings
// re-fetch via `ensureModel` (see installManager). Uninstalling frees the asset,
// unless another installed app shares it.
//
// `key` identifies the underlying asset so uninstall can tell when two apps share
// one cache (and must not free it while the other app is still installed). The
// `download`/`remove` functions read the app's config so they always act on what
// the app will actually use.

import { getAppValue } from './appConfig.js';
import { currentModelId } from './modelHosts.js';
// KimtAI's engine module is light (the heavy model runs inside a Web Worker, its
// own chunk) and the app already bundles it, so import it statically — a dynamic
// import here can't split it out and only triggers a Vite mixed-import warning.
import { byId, downloadModel, recommendedModelId, removeAllModels } from './engines/kimtai.js';

type ProgressFn = (progress: unknown) => void;

export interface ModelEntry {
  key: string;
  size: string;
  // `signal` (optional) aborts an in-flight download. Only engines that own their fetch can
  // honour it (Denoise, via fetchModelFile; KimtAI, by terminating its worker); the other
  // Transformers.js engines manage their own network and ignore it — the install manager still
  // guards against re-install on cancel.
  download: (onProgress?: ProgressFn, signal?: AbortSignal) => Promise<void> | void;
  /**
   * Whether `download` really stops when its signal is aborted.
   *
   * DECLARED, because the alternative is guessing — and the guess that was here was "everything
   * can stop", so six installs rendered an enabled Stop, deleted their row when it was pressed,
   * and went on downloading up to 300 MB (#1302). A Stop that reports success while the transfer
   * continues is worse than no Stop: the user believes they stopped it.
   *
   * The rule is `JobSpec.cancellable`'s (#1172) — work that cannot be interrupted offers no
   * button rather than one that silently does nothing. Set it true only once the engine honours
   * the signal end to end; #1304 tracks the ones still to convert.
   */
  cancellable: boolean;
  remove: () => Promise<void> | void;
}

const WHISPER_MODELS = ['Xenova/whisper-tiny', 'Xenova/whisper-base', 'Xenova/whisper-small'];
const GRAMMAR_MODELS = ['Xenova/flan-t5-base', 'Xenova/flan-t5-small'];
// A saved id from before the models moved to Hugging Face is mapped to its current repo first.
const pick = (v: unknown, allowed: string[], fallback: string): string => {
  const id = typeof v === 'string' ? currentModelId(v) : v;
  return typeof id === 'string' && allowed.includes(id) ? id : fallback;
};

const APP_MODELS: Record<string, ModelEntry> = {
  // Voice to Text — the configured Whisper model (Tiny or Base).
  televoica: {
    key: 'whisper',
    // Reflects the configured model so the App Store label isn't misleading.
    get size() {
      const id = pick(getAppValue('televoica', 'model'), WHISPER_MODELS, 'Xenova/whisper-tiny');
      return id === 'Xenova/whisper-small' ? '~250 MB' : id === 'Xenova/whisper-base' ? '~280 MB' : '~145 MB';
    },
    download: async (onProgress) => {
      const model = pick(getAppValue('televoica', 'model'), WHISPER_MODELS, 'Xenova/whisper-tiny');
      const { prefetchModel } = await import('./engines/transcribe.js');
      await prefetchModel(model, onProgress);
    },
    // The engine owns its own network and takes no signal, so a Stop here would report
    // success while the download continued. No button until it can (#1304).
    cancellable: false,
    remove: async () => {
      const { removeWhisperCache } = await import('./engines/transcribe.js');
      await removeWhisperCache();
    },
  },

  // Denoise — the DeepFilterNet model.
  denoise: {
    key: 'deepfilternet',
    size: '~16 MB',
    download: async (onProgress, signal) => {
      const { prefetchDenoiseModel } = await import('./engines/denoise.js');
      await prefetchDenoiseModel(onProgress, signal);
    },
    // fetchModelFile takes the signal all the way to the fetch, so this really stops.
    cancellable: true,
    remove: async () => {
      const { removeDenoiseModel } = await import('./engines/denoise.js');
      await removeDenoiseModel();
    },
  },

  // Video Recorder — its "Reduce noise" option uses the SAME DeepFilterNet model
  // as Denoise. Share the cache key so it's fetched at install (so recording
  // never downloads mid-use) and freed only when neither app needs it.
  vidrec: {
    key: 'deepfilternet',
    size: '~16 MB',
    download: async (onProgress, signal) => {
      const { prefetchDenoiseModel } = await import('./engines/denoise.js');
      await prefetchDenoiseModel(onProgress, signal);
    },
    // fetchModelFile takes the signal all the way to the fetch, so this really stops.
    cancellable: true,
    remove: async () => {
      const { removeDenoiseModel } = await import('./engines/denoise.js');
      await removeDenoiseModel();
    },
  },

  // Image to Text — the engine and English data are bundled in the extension: this only warms
  // the engine up, from local files, so nothing is downloaded.
  snaptext: {
    key: 'ocr',
    size: 'bundled',
    download: async (onProgress) => {
      const { prefetchOcr } = await import('./engines/ocr.js');
      await prefetchOcr(onProgress);
    },
    // The warm-up takes no signal, so a Stop here would report success while it continued.
    // No button until it can (#1304).
    cancellable: false,
    remove: async () => {
      const { removeOcrCache } = await import('./engines/ocr.js');
      await removeOcrCache();
    },
  },

  // Grammit — installs with NO download (its rule + spell checks are bundled). The
  // optional AI "deep grammar" model is fetched only when that setting is turned
  // on; the settings hook prefetches it the moment it's enabled, so corrections
  // never trigger a download.
  grammit: {
    key: 'flan-grammar',
    size: '~250 MB (only when AI deep grammar is on)',
    download: async (onProgress) => {
      if (getAppValue('grammit', 'deep') !== 'on') return; // off by default → nothing to fetch
      const model = pick(getAppValue('grammit', 'model'), GRAMMAR_MODELS, 'Xenova/flan-t5-base');
      const { prefetchGrammarModel } = await import('./engines/grammar.js');
      await prefetchGrammarModel(model, onProgress);
    },
    // The engine owns its own network and takes no signal, so a Stop here would report
    // success while the download continued. No button until it can (#1304).
    cancellable: false,
    remove: async () => {
      const { removeGrammarModel } = await import('./engines/grammar.js');
      await removeGrammarModel();
    },
  },

  // Voice Studio — the Kokoro-82M text-to-speech model (q8, ~90 MB). Prefetched at
  // install so the first render doesn't stall on a download; voice style files are
  // small (~0.5 MB each) and fetched on demand. Freed on uninstall (unique cache key).
  voicestudio: {
    key: 'kokoro',
    size: '~90 MB',
    download: async (onProgress) => {
      const { prefetchVoiceModel } = await import('./engines/voice.js');
      await prefetchVoiceModel(onProgress);
    },
    // The engine owns its own network and takes no signal, so a Stop here would report
    // success while the download continued. No button until it can (#1304).
    cancellable: false,
    remove: async () => {
      const { removeVoiceModel } = await import('./engines/voice.js');
      await removeVoiceModel();
    },
  },

  // Thoth — the on-device knowledge base. Indexing and search embed text with all-MiniLM
  // (~23 MB). Prefetched at install so the first index doesn't stall on a download, and freed
  // on uninstall (which nothing did before — the bytes leaked in the shared cache, #321).
  thoth: {
    key: 'minilm-embed',
    size: '~23 MB',
    download: async (onProgress) => {
      const { prefetchEmbedModel } = await import('./engines/embed.js');
      await prefetchEmbedModel(onProgress);
    },
    // The engine owns its own network and takes no signal, so a Stop here would report
    // success while the download continued. No button until it can (#1304).
    cancellable: false,
    remove: async () => {
      const { removeEmbedModel } = await import('./engines/embed.js');
      await removeEmbedModel();
    },
  },

  // KimtAI — a library of small on-device chat models. Installing fetches the
  // recommended starter; the user can download the others from the in-app Model
  // Library. Uninstalling frees every model it downloaded (its cache key is unique).
  //
  // The size is DERIVED from the catalog, not restated: download size is the one
  // number a user weighs before installing an on-device AI app, and this card used to
  // quote "~0.5 GB (Qwen2.5 0.5B)" — a model that was tried and reverted, and never
  // shipped.
  kimtai: {
    key: 'kimtai-models',
    size: `${byId(recommendedModelId())?.size ?? '~300 MB'} starter (more in-app)`,
    // downloadModel terminates its worker on abort, so this one genuinely stops — it was only
    // ever missing the signal.
    download: (onProgress, signal) => downloadModel(recommendedModelId(), onProgress, signal),
    cancellable: true,
    remove: () => removeAllModels(),
  },
};

export const appModel = (id: string): ModelEntry | null => APP_MODELS[id] || null;
// The shared cache key for an app's asset (null if the app has none).
export const appModelKey = (id: string): string | null => APP_MODELS[id]?.key || null;
