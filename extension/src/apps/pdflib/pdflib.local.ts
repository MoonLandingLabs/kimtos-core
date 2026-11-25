// Local handlers for PDF Library: book CRUD, annotations, and PDF blobs.
// PDFs come in only as files the user picks: nothing here makes a network request.
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
const guardSize = (buffer: ArrayBuffer): void => {
  if (buffer.byteLength > PDF_MAX_BYTES) throw new Error(`File is larger than the ${megabytes(PDF_MAX_BYTES)} limit.`);
};

// Unread first, then newest.
const byReadThenNew = (a: Book, b: Book): number =>
  a.read === b.read ? (b.added || 0) - (a.added || 0) : a.read ? 1 : -1;

register('GET', 'books', async () => ({
  books: ((await db.list('books')) as unknown as Book[]).sort(byReadThenNew),
}));

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
