// Browser-safe runtime constants for the extension (and reusable by the site for
// visual consistency). Pure values — no DOM, no process/fs — importable anywhere
// via `@kimtos/config/ui`.

/** Cache Storage bucket names. Engines MUST agree on these or the model cache fragments. */
export const CACHE_NAMES = {
  /** Transformers.js model weights (Whisper, FLAN-T5, embeddings, the chat LLMs). */
  transformers: 'transformers-cache',
  /** The DeepFilterNet denoiser's ONNX weights, fetched once from Hugging Face. */
  models: 'kimtos-models',
} as const;

/** IndexedDB kv / persistence keys, namespaced by app. */
export const STORAGE_KEYS = {
  kimtaiDownloaded: 'kimtai:downloaded',
  kimtaiSpeed: 'kimtai:speed',
  notesMigrated: 'notes:migrated',
  thothHashes: 'thoth:hashes',
} as const;

/** The blob-history collection key for an app (denoise / vidrec / …). */
export const historyKey = (appId: string): string => `history:${appId}`;

/** Stacking order — the single source of truth for the layering system. Low→high:
 *  home rail / corner docks < app dock < app windows < utility dialogs (Settings /
 *  App Store) < confirm & cropper. dialog.ts allocates rising z-indexes from
 *  `appWindow` / `utilityDialog`; the extension injects matching `--z-*` custom
 *  properties at startup so CSS (`var(--z-*)`) and TS never drift apart. */
export const Z_INDEX = {
  rail: 5,
  dock: 40,
  appWindow: 100,
  utilityDialog: 100000,
  confirm: 1000000,
} as const;
