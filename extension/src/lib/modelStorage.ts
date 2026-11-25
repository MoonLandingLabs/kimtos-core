// Model storage — a read-only accounting of the on-device AI model weights.
//
// Model files DON'T live in the shared kimtos IndexedDB: they're 100s of MB of
// binaries, so Transformers.js caches them in **Cache Storage** (`transformers-cache`
// for the HF models, `kimtos-models` for the denoiser) and Tesseract caches OCR
// language data in its own IndexedDB. That's the right home for big immutable
// blobs — but it means they wouldn't otherwise show up in AnubisDB. This module
// gives AnubisDB the numbers (per owning app) and a per-app clear, so the console
// reflects everything on disk. It never re-downloads — it only measures + frees.
//
// Attribution mirrors the per-app delete filters the engines already use
// (transcribe → /whisper/, grammar → /flan-t5/, …), kept here as the single
// accounting view without importing the (heavy) engine modules.

import { CACHE_NAMES } from '@kimtos/config/ui';

export interface ModelUsage {
  app: string; // owning app id — AnubisDB's registry supplies its label + accent
  label: string; // model family, human-readable
  bytes: number; // total cached size
  files: number; // number of cached files (or OCR language packs)
  where: string; // storage location note, shown in the UI
  clear: () => Promise<void>; // free just this group's files
}

interface CacheGroup {
  app: string;
  label: string;
  cache: string;
  match: (url: string) => boolean;
}

// Which cached files belong to which app. `transformers-cache` is shared by every
// Transformers.js model, so each group matches by its repo id; `kimtos-models`
// holds only the denoiser.
const CACHE_GROUPS: CacheGroup[] = [
  {
    app: 'televoica',
    label: 'Whisper · speech-to-text',
    cache: CACHE_NAMES.transformers,
    match: (u) => /whisper/i.test(u),
  },
  {
    app: 'grammit',
    label: 'FLAN-T5 · deep grammar',
    cache: CACHE_NAMES.transformers,
    match: (u) => /flan-t5/i.test(u),
  },
  { app: 'thoth', label: 'MiniLM · semantic search', cache: CACHE_NAMES.transformers, match: (u) => /minilm/i.test(u) },
  {
    app: 'kimtai',
    label: 'Chat models',
    cache: CACHE_NAMES.transformers,
    match: (u) => /smollm|qwen|tinyllama/i.test(u),
  },
  {
    app: 'voicestudio',
    label: 'Kokoro · text-to-speech',
    cache: CACHE_NAMES.transformers,
    match: (u) => /kokoro/i.test(u),
  },
  {
    app: 'denoise',
    label: 'DeepFilterNet · denoiser',
    cache: CACHE_NAMES.models,
    match: (u) => /denoiser|deepfilter/i.test(u),
  },
];

const TRANSFORMERS_MATCHERS = CACHE_GROUPS.filter((g) => g.cache === CACHE_NAMES.transformers).map((g) => g.match);
// Anything in the transformers cache not claimed by a known group (future model,
// stray files) so nothing is silently uncounted.
const isOtherTransformers = (url: string): boolean => !TRANSFORMERS_MATCHERS.some((m) => m(url));

/** Size of one cached response — prefer the Content-Length header (no memory hit
 *  for a multi-hundred-MB weight); fall back to reading the blob for the few that
 *  were stored without it (e.g. the denoiser, ~16 MB). */
async function responseSize(res: Response): Promise<number> {
  const len = res.headers.get('content-length');
  if (len && Number(len) > 0) return Number(len);
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
}

async function cacheExists(name: string): Promise<boolean> {
  try {
    return await caches.has(name);
  } catch {
    return false;
  }
}

async function measureCache(name: string, match: (url: string) => boolean): Promise<{ bytes: number; files: number }> {
  if (!(await cacheExists(name))) return { bytes: 0, files: 0 };
  const cache = await caches.open(name);
  const reqs = (await cache.keys()).filter((r) => match(r.url));
  let bytes = 0;
  for (const req of reqs) {
    const res = await cache.match(req);
    if (res) bytes += await responseSize(res);
  }
  return { bytes, files: reqs.length };
}

async function deleteFromCache(name: string, match: (url: string) => boolean): Promise<void> {
  if (!(await cacheExists(name))) return;
  const cache = await caches.open(name);
  const reqs = (await cache.keys()).filter((r) => match(r.url));
  await Promise.all(reqs.map((r) => cache.delete(r)));
}

// --- Tesseract OCR language data (its own IndexedDB, not Cache Storage) --------

const isTesseractDb = (name: string | undefined): boolean => /tesseract|tessdata/i.test(name || '');

function valueSize(v: unknown): number {
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof Blob) return v.size;
  if (typeof v === 'string') return v.length;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

// Best-effort size of one IndexedDB by walking its stores and summing value sizes.
function sizeIndexedDb(name: string): Promise<{ bytes: number; items: number }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { bytes: number; items: number }): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    let bytes = 0;
    let items = 0;
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(name);
    } catch {
      return finish({ bytes: 0, items: 0 });
    }
    open.onerror = () => finish({ bytes, items });
    open.onblocked = () => finish({ bytes, items });
    open.onsuccess = () => {
      const db = open.result;
      const stores = Array.from(db.objectStoreNames);
      if (!stores.length) {
        db.close();
        return finish({ bytes, items });
      }
      let pending = stores.length;
      const settle = (): void => {
        if (--pending === 0) {
          db.close();
          finish({ bytes, items });
        }
      };
      try {
        const tx = db.transaction(stores, 'readonly');
        for (const s of stores) {
          const req = tx.objectStore(s).getAll();
          req.onsuccess = () => {
            for (const v of req.result as unknown[]) {
              bytes += valueSize(v);
              items += 1;
            }
            settle();
          };
          req.onerror = settle;
        }
      } catch {
        db.close();
        finish({ bytes, items });
      }
    };
  });
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function measureTesseract(): Promise<{ bytes: number; files: number; names: string[] }> {
  let dbs: IDBDatabaseInfo[];
  try {
    dbs = (await indexedDB.databases?.()) || [];
  } catch {
    return { bytes: 0, files: 0, names: [] };
  }
  const names = dbs.map((d) => d.name).filter((n): n is string => isTesseractDb(n));
  let bytes = 0;
  let files = 0;
  for (const n of names) {
    const r = await sizeIndexedDb(n);
    bytes += r.bytes;
    files += r.items;
  }
  return { bytes, files, names };
}

/** Scan every model cache, grouped by owning app. Read-only. */
export async function scanModelStorage(): Promise<{ groups: ModelUsage[]; totalBytes: number }> {
  const groups: ModelUsage[] = [];

  if (typeof caches !== 'undefined') {
    for (const g of CACHE_GROUPS) {
      const r = await measureCache(g.cache, g.match);
      if (r.files > 0) {
        groups.push({
          app: g.app,
          label: g.label,
          bytes: r.bytes,
          files: r.files,
          where: 'Cache Storage',
          clear: () => deleteFromCache(g.cache, g.match),
        });
      }
    }
    const other = await measureCache(CACHE_NAMES.transformers, isOtherTransformers);
    if (other.files > 0) {
      groups.push({
        app: 'system',
        label: 'Other models',
        bytes: other.bytes,
        files: other.files,
        where: 'Cache Storage',
        clear: () => deleteFromCache(CACHE_NAMES.transformers, isOtherTransformers),
      });
    }
  }

  if (typeof indexedDB !== 'undefined') {
    const ocr = await measureTesseract();
    if (ocr.files > 0) {
      groups.push({
        app: 'snaptext',
        label: 'Tesseract · OCR language data',
        bytes: ocr.bytes,
        files: ocr.files,
        where: 'IndexedDB',
        clear: async () => {
          for (const n of ocr.names) await deleteIndexedDb(n);
        },
      });
    }
  }

  groups.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = groups.reduce((sum, g) => sum + g.bytes, 0);
  return { groups, totalBytes };
}
