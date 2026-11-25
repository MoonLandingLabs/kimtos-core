// Validated download-and-cache for hand-rolled model/asset fetches.
//
// Anything we fetch ourselves (rather than through Transformers.js, which validates
// its own downloads) and feed straight to a parser is a trap: a 200 response does
// NOT mean we got the file we asked for. A misconfigured static host answers
// `GET /models/x.onnx` with its SPA fallback — an HTML page, HTTP 200 — and the
// parser then reports "expected magic word", which reads like "the model is
// corrupt" instead of "the download went to the wrong place". Worse, the bad body
// gets cached, so the user stays broken until they clear browser storage, which
// they never think to do.
//
// So: validate before trusting, fail with the real reason, never cache a bad body,
// and validate the CACHED body too so an already-poisoned entry self-heals instead
// of failing forever.
import { type OnProgress } from './engines/types.js';

// Any model asset we hand-fetch is large (the smallest today, DeepFilterNet, is
// ~16 MB). A body smaller than this is a truncated download or an error page, never
// a real model. Deliberately conservative so a genuinely small asset is never
// rejected; callers with a known size can tighten it via `minBytes`.
const DEFAULT_MIN_BYTES = 1_000_000;

// The first meaningful byte of a text error page: `<` (HTML/XML, SPA fallback,
// captive portal) or `{` (a JSON error body). A real ONNX file is protobuf and
// starts with neither. We deliberately do NOT check for ONNX "magic bytes": the
// `.onnx` format is raw protobuf with no magic number, so any such check would risk
// a false negative that bricks a working app — strictly worse than the bug we fix.
function firstMeaningfulByte(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    // skip ASCII whitespace and a UTF-8/UTF-16 BOM
    if (
      b === 0x20 ||
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      b === 0xef ||
      b === 0xbb ||
      b === 0xbf ||
      b === 0xff ||
      b === 0xfe
    )
      continue;
    return b;
  }
  return -1;
}

// Throw a message a human can act on if `bytes` is plainly not a model file. The
// bytes are authoritative — a content-type header can lie in both directions, so we
// judge the content itself, not the label.
export function assertModelBytes(bytes: Uint8Array, url: string, minBytes = DEFAULT_MIN_BYTES): void {
  const first = firstMeaningfulByte(bytes);
  if (first === 0x3c /* < */ || first === 0x7b /* { */) {
    const kind = first === 0x3c ? 'an HTML/XML page' : 'a JSON error body';
    throw new Error(
      `The model URL returned ${kind}, not a model file (${url}). The host is likely misconfigured — a static server serving its web-page fallback for a missing file, with HTTP 200.`,
    );
  }
  if (bytes.length < minBytes) {
    throw new Error(
      `The model download from ${url} was only ${bytes.length} bytes; a real model is at least ${minBytes}. The download was truncated or the host returned an error body.`,
    );
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// Fetch a model file from Cache Storage if present (and valid), else download it
// with byte progress and cache it. Returns the raw bytes.
//
// Invariants:
//   - a cached body is validated on read; if it fails, it is evicted and re-fetched
//     (self-heal), so a poisoned cache does not stay broken forever;
//   - a downloaded body is validated BEFORE it is cached, so a bad body is never
//     persisted.
export async function fetchModelFile(
  url: string,
  cacheName: string,
  onProgress?: OnProgress,
  opts: { minBytes?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const minBytes = opts.minBytes ?? DEFAULT_MIN_BYTES;
  const cache = await caches.open(cacheName);

  const hit = await cache.match(url);
  if (hit) {
    const cached = new Uint8Array(await hit.arrayBuffer());
    try {
      assertModelBytes(cached, url, minBytes);
      onProgress?.({ phase: 'download', label: 'Loading model', ratio: 1 });
      return cached;
    } catch {
      // Poisoned or truncated cache entry — drop it and download afresh.
      await cache.delete(url);
    }
  }

  const net = await fetch(url, { signal: opts.signal });
  if (!net.ok || !net.body) throw new Error(`Couldn't download the model (${net.status}) from ${url}.`);

  const total = Number(net.headers.get('content-length')) || 0;
  const reader = net.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    // An aborted signal also rejects reader.read(); this makes the cancel prompt even if a
    // read is momentarily stalled, and releases the reader so the connection is torn down.
    if (opts.signal?.aborted) {
      await reader.cancel();
      throw new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      phase: 'download',
      label: 'Downloading model',
      loaded,
      total,
      ratio: total ? loaded / total : null,
    });
  }

  const bytes = concatChunks(chunks, loaded);
  assertModelBytes(bytes, url, minBytes); // validate BEFORE caching — never persist a bad body
  const body = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  await cache.put(url, new Response(body));
  return bytes;
}
