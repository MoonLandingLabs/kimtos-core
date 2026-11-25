// In-browser OCR via Tesseract.js (WASM). Runs entirely on-device — the image
// never leaves the browser. The engine + language data download on first use and
// are cached by Tesseract.js, so later runs are fast and work offline.
//
// `onProgress` receives a normalized `{ phase, label, ratio }` where phase is
// 'download' (loading core/lang) or 'recognize'.

import { type OnProgress } from './types.js';
import { pageSegMode } from './ocrLayout.js';
import {
  type Band,
  type RecognizedLine,
  type Recovery,
  MAX_RESCAN_BANDS,
  cropBand,
  isUsefulRecovery,
  sampleGray,
  smallBandsOf,
  spliceRecoveries,
  uncoveredBands,
} from './ocrSmallText.js';

// English is bundled (/ocr/eng.traineddata.gz) so OCR works fully offline with no download.
// Every other language's pack comes from Tesseract.js's own default, the official
// `@tesseract.js-data/<lang>` npm package on jsDelivr (version 4.0.0_best_int, gzip). Returning
// undefined leaves that default in place; see lib/modelHosts.ts.
const langPathFor = (lang: string): string | undefined => (lang === 'eng' ? '/ocr' : undefined);

interface TessLog {
  status?: string;
  progress?: number;
}
interface TessBBox {
  y0: number;
  y1: number;
}
interface TessBlocks {
  paragraphs?: { lines?: { bbox?: TessBBox }[] }[];
}
interface TessResult {
  text?: string;
  // Only present when the recognition asks for it (see RECOGNIZE_OUTPUT).
  blocks?: TessBlocks[] | null;
}
interface TessWorker {
  // Params passed here are applied before the image is set and restored afterwards,
  // so no separate setParameters round-trip is needed. The third argument selects which
  // renderers run; asking for `blocks` is what gives us per-line boxes.
  recognize: (
    f: Blob,
    opts?: Record<string, string>,
    output?: Record<string, boolean>,
  ) => Promise<{ data: TessResult }>;
  terminate: () => Promise<void>;
}
type CreateWorker = (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker>;

// Text plus the per-line boxes the small-text rescan needs to know what was already read.
// Tesseract.js returns no boxes by default, and without them a rescan could duplicate a
// line it had in fact recognized — so the rescan is skipped outright if they are missing.
const RECOGNIZE_OUTPUT = { text: true, blocks: true };

/** The recognized lines, in document order, as plain y-ranges. */
function linesOf(data: TessResult): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  for (const block of data.blocks || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || []) if (line.bbox) out.push({ y0: line.bbox.y0, y1: line.bbox.y1 });
  return out;
}

/**
 * Re-read the slivers of the image whose text is small enough that Tesseract's layout
 * analysis discarded it as noise (#956). Best-effort by design: any failure here — a
 * blob that will not decode, a canvas the browser refuses to read back — leaves the
 * main pass's text exactly as it was rather than failing the whole recognition.
 */
async function recoverSmallText(
  file: Blob,
  worker: TessWorker,
  lines: RecognizedLine[],
  params: Record<string, string>,
): Promise<Recovery[]> {
  let image: ImageBitmap | null = null;
  try {
    image = await createImageBitmap(file);
    const sample = sampleGray(image);
    if (!sample) return [];
    const bands: Band[] = uncoveredBands(smallBandsOf(sample), lines).slice(0, MAX_RESCAN_BANDS);
    const recoveries: Recovery[] = [];
    for (const band of bands) {
      // Per-band, so one band that fails (say, an upscale that exceeds the browser's
      // canvas size cap) cannot throw away the lines the other bands recovered.
      try {
        const crop = await cropBand(image, band);
        if (!crop) continue;
        // PSM 6 ("a single uniform block") suits a strip that is one or a few lines of one
        // size — which is exactly what a band is, by construction.
        const { data } = await worker.recognize(crop, { ...params, tessedit_pageseg_mode: '6' });
        const text = (data.text || '').trim();
        if (text && isUsefulRecovery(text)) recoveries.push({ top: band.top, text });
      } catch {
        /* skip this band */
      }
    }
    return recoveries;
  } catch {
    return [];
  } finally {
    image?.close();
  }
}

export async function recognizeText(
  file: Blob,
  {
    lang = 'eng',
    layout,
    onProgress,
    signal,
  }: { lang?: string; layout?: string; onProgress?: OnProgress; signal?: AbortSignal } = {},
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const { createWorker } = (await import('tesseract.js')) as unknown as { createWorker: CreateWorker };
  // Flipped once the main pass is done, so the progress line names the second phase
  // instead of restarting "Recognizing text" from zero for every strip.
  let recognizeLabel = 'Recognizing text';
  const worker = await createWorker(lang, 1, {
    // Self-hosted worker + core (copied to /ocr) — MV3 forbids loading the
    // worker from a CDN. Root-relative paths resolve against the extension root.
    // workerBlobURL:false loads the worker file directly; MV3 CSP bans blob: workers.
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
    workerBlobURL: false,
    ...(langPathFor(lang) ? { langPath: langPathFor(lang) } : {}),
    logger: (m: TessLog) => {
      const recognizing = (m.status || '').toLowerCase().includes('recogniz');
      onProgress?.({
        phase: recognizing ? 'recognize' : 'download',
        label: recognizing ? recognizeLabel : titleCase(m.status),
        ratio: typeof m.progress === 'number' ? m.progress : null,
      });
    },
  });
  // Stopping means terminating the worker, and that really stops it: the language download and
  // the recognition both live inside it. Without a signal the run was structurally unstoppable,
  // so KimtManager's Stop deleted the row and left the work going (#1304).
  //
  // Terminated at most ONCE. The abort path and the `finally` both want to end it, and calling
  // `terminate()` twice on a worker that has already gone rejects — turning a clean stop into an
  // error the user is shown.
  let ended = false;
  const end = async (): Promise<void> => {
    if (ended) return;
    ended = true;
    await worker.terminate();
  };
  const stop = (): void => void end();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const params = { tessedit_pageseg_mode: pageSegMode(layout) };
    const { data } = await worker.recognize(file, params, RECOGNIZE_OUTPUT);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const text = (data.text || '').trim();
    // No boxes means no way to tell what was already read, so no safe rescan.
    if (!Array.isArray(data.blocks)) return text;
    const lines = linesOf(data);
    recognizeLabel = 'Reading small text';
    const recoveries = await recoverSmallText(file, worker, lines, params);
    return spliceRecoveries(text, lines, recoveries);
  } finally {
    signal?.removeEventListener('abort', stop);
    await end();
  }
}

// Warm the OCR engine (compile WASM + load the bundled English data) so the
// first real recognition is instant. Used by onboarding.
export async function prefetchOcr(lang = 'eng', onProgress?: OnProgress): Promise<void> {
  const { createWorker } = (await import('tesseract.js')) as unknown as { createWorker: CreateWorker };
  const worker = await createWorker(lang, 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
    workerBlobURL: false,
    ...(langPathFor(lang) ? { langPath: langPathFor(lang) } : {}),
    logger: (m: TessLog) =>
      onProgress?.({
        phase: 'download',
        label: titleCase(m.status),
        ratio: typeof m.progress === 'number' ? m.progress : null,
      }),
  });
  await worker.terminate();
}

// Free cached OCR language data (uninstall). English is bundled (nothing to
// remove); other languages are cached by Tesseract.js in IndexedDB. Best-effort:
// drop any tesseract-named databases (Chrome supports indexedDB.databases()).
export async function removeOcrCache(): Promise<void> {
  try {
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(
      dbs
        .filter((d) => /tesseract|tessdata/i.test(d.name || ''))
        .map(
          (d) =>
            new Promise<void>((res) => {
              const r = indexedDB.deleteDatabase(d.name!);
              r.onsuccess = r.onerror = r.onblocked = () => res();
            }),
        ),
    );
  } catch {
    /* ignore */
  }
}

function titleCase(status?: string): string {
  if (!status) return 'Loading';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
