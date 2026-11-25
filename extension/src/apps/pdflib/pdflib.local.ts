// Local handlers for PDF Library: book CRUD, annotations, and PDF blobs.
// Import-by-URL fetches the PDF client side — MV3 host_permissions let the
// extension bypass CORS.
import { register } from '../../lib/localRouter.js';
import { dataStore as db } from '../../lib/dataStore.js';
import { isPdf } from '../../lib/fileType.js';
import { PDF_MAX_BYTES, megabytes } from '../../lib/limits.js';

interface Book {
  id: string;
  title?: string;
  url?: string;
  source?: string;
  read?: boolean;
  added?: number;
  lastPage?: number;
  zoom?: number;
  [key: string]: unknown;
}
interface Annotation {
  id: string;
  bookId: string;
  page?: number;
  rects?: unknown;
  text?: string;
  color?: string;
  comment?: string;
  created?: number;
  [key: string]: unknown;
}

const blobKey = (id: string): string => `pdf:${id}`;
// Both import paths (by URL and by upload) reject the same size, with the same words.
const tooBig = (): Error => new Error(`File is larger than the ${megabytes(PDF_MAX_BYTES)} limit.`);
const guardSize = (buffer: ArrayBuffer): void => {
  if (buffer.byteLength > PDF_MAX_BYTES) throw tooBig();
};

/**
 * Read a response body, refusing it the moment it passes the limit.
 *
 * The URL is the user's, and it used to be read whole — `await res.arrayBuffer()` — and only THEN
 * measured. So the cap was enforced against a buffer already in memory: a URL pointing at
 * something enormous could exhaust the tab before `guardSize` ever ran (#1304). A declared
 * `Content-Length` is refused before a byte is read; a body that declares nothing, or lies about
 * it, is cut off as it arrives.
 */
async function readCapped(res: Response): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > PDF_MAX_BYTES) throw tooBig();
  // No stream to read (a mocked or opaque response): fall back to the whole body, which the
  // declared length above has already vouched for as far as anything can.
  if (!res.body) {
    const buffer = await res.arrayBuffer();
    guardSize(buffer);
    return buffer;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > PDF_MAX_BYTES) throw tooBig();
      chunks.push(value);
    }
  } finally {
    // Stop the transfer on the way out, whether that was the end of the body or the cap.
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

// Unread first, then newest.
const byReadThenNew = (a: Book, b: Book): number =>
  a.read === b.read ? (b.added || 0) - (a.added || 0) : a.read ? 1 : -1;

register('GET', 'books', async () => ({
  books: ((await db.list('books')) as unknown as Book[]).sort(byReadThenNew),
}));

register('POST', 'books', async ({ body }) => {
  const b = (body || {}) as { url?: string; title?: string };
  const url = (b.url || '').trim();
  if (!url) throw new Error('A URL is required.');
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await readCapped(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The size refusal is about the FILE, not about the download: wrapping it in "Couldn't
    // download that PDF" would blame the network for a limit we chose.
    if (msg.includes('limit')) throw err;
    throw new Error(`Couldn't download that PDF: ${msg}`, { cause: err });
  }
  if (!isPdf(buffer)) throw new Error("That URL doesn't point to a PDF file.");
  const title = (b.title || '').trim() || url.split('/').pop() || 'Untitled';
  const book = await db.put('books', { title, url, source: 'url', read: false, added: Date.now(), lastPage: 1 });
  await db.putBlob(blobKey(book.id), new Blob([buffer], { type: 'application/pdf' }));
  return book;
});

register('POST', 'books/upload', async ({ form }) => {
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new Error('The file is empty.');
  const buffer = await file.arrayBuffer();
  guardSize(buffer);
  if (!isPdf(buffer)) throw new Error("That file isn't a valid PDF.");
  const rawTitle = form?.get('title');
  const title =
    (typeof rawTitle === 'string' ? rawTitle : '').trim() || (file.name || 'Untitled').replace(/\.[^.]+$/, '');
  const book = await db.put('books', { title, url: '', source: 'file', read: false, added: Date.now(), lastPage: 1 });
  await db.putBlob(blobKey(book.id), file);
  return book;
});

register('FILE', 'books/:id/file', async ({ params }) => {
  const url = await db.blobUrl(blobKey(params.id));
  if (!url) throw new Error('File not found.');
  return url;
});

register('PATCH', 'books/:id', async ({ params, body }) => {
  const b = (body || {}) as { title?: string; read?: boolean; zoom?: number; lastPage?: number };
  const patch: Record<string, unknown> = {};
  if (b.title != null && b.title.trim()) patch.title = b.title.trim();
  if (b.read != null) patch.read = b.read;
  if (b.zoom != null) patch.zoom = b.zoom; // remembered per book
  if (b.lastPage != null) {
    patch.lastPage = Math.max(1, b.lastPage);
    patch.lastReadAt = Date.now(); // reading activity → "last read"
  }
  const book = await db.patch('books', params.id, patch);
  if (!book) throw new Error('Book not found.');
  return book;
});

register('DELETE', 'books/:id', async ({ params }) => {
  await db.remove('books', params.id);
  await db.delBlob(blobKey(params.id));
  const orphans = ((await db.list('annotations')) as unknown as Annotation[]).filter((a) => a.bookId === params.id);
  await Promise.all(orphans.map((a) => db.remove('annotations', a.id)));
  return { ok: true };
});

// --- annotations (highlights + comments) ---
const publicAnnot = ({ bookId, ...rest }: Annotation) => rest; // bookId is internal

register('GET', 'books/:id/annotations', async ({ params }) => {
  const list = ((await db.list('annotations')) as unknown as Annotation[])
    .filter((a) => a.bookId === params.id)
    .sort((a, b) => (a.created || 0) - (b.created || 0));
  return { annotations: list.map(publicAnnot) };
});

register('POST', 'books/:id/annotations', async ({ params, body }) => {
  const b = (body || {}) as { page?: number; rects?: unknown; text?: string; color?: string; comment?: string };
  const annot = (await db.put('annotations', {
    bookId: params.id,
    page: b.page,
    rects: b.rects,
    text: b.text || '',
    color: b.color || 'yellow',
    comment: (b.comment || '').trim(),
    created: Date.now(),
  })) as unknown as Annotation;
  return publicAnnot(annot);
});

register('PATCH', 'books/:id/annotations/:aid', async ({ params, body }) => {
  const b = (body || {}) as { color?: string; comment?: string };
  const patch: Record<string, unknown> = {};
  if (b.color != null) patch.color = b.color;
  if (b.comment != null) patch.comment = b.comment.trim();
  const annot = (await db.patch('annotations', params.aid, patch)) as unknown as Annotation | null;
  if (!annot) throw new Error('Annotation not found.');
  return publicAnnot(annot);
});

register('DELETE', 'books/:id/annotations/:aid', async ({ params }) => {
  await db.remove('annotations', params.aid);
  return { ok: true };
});
