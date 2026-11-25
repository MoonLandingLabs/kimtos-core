// Local handlers for NotaBoard. A board is one record in the `boards` collection
// carrying its whole scene (`elements`), the paper style, and a small `thumb`
// data URL for the sidebar preview. Inserted images live as blobs keyed
// `notaboard/<boardId>/<uid>` and are purged when the board is deleted.
import { register } from '../../lib/localRouter.js';
import { dataStore as db } from '../../lib/dataStore.js';

interface Board {
  id: string;
  title?: string;
  created?: number;
  updated?: number;
  thumb?: string;
  elements?: unknown[];
  paper?: string;
  theme?: string;
  [key: string]: unknown;
}

const COLLECTION = 'boards';
const listBoards = async (): Promise<Board[]> => (await db.list(COLLECTION)) as unknown as Board[];
const byUpdated = (a: Board, b: Board): number => (b.updated || 0) - (a.updated || 0);

// The sidebar only needs the light fields — never ship a board's full scene to
// the list view.
const summary = ({ id, title, created, updated, thumb }: Board) => ({ id, title, created, updated, thumb });

register('GET', 'boards', async () => {
  const boards = (await listBoards()).sort(byUpdated).map(summary);
  return { boards };
});

register('GET', 'boards/:id', async ({ params }) => {
  const board = await db.get(COLLECTION, params.id);
  if (!board) throw new Error('Board not found.');
  return board;
});

register('POST', 'boards', async ({ body }) => {
  const b = (body || {}) as Partial<Board>;
  const now = Date.now();
  return db.put(COLLECTION, {
    title: (b.title || '').trim() || 'Untitled board',
    elements: Array.isArray(b.elements) ? b.elements : [], // seeded when duplicating a board
    paper: b.paper || 'grid',
    theme: b.theme || 'dark',
    thumb: b.thumb || '',
    created: now,
    updated: now,
  });
});

register('PATCH', 'boards/:id', async ({ params, body }) => {
  const b = (body || {}) as Partial<Board>;
  const patch: Record<string, unknown> = { updated: Date.now() };
  if (b.title != null) patch.title = b.title.trim() || 'Untitled board';
  if (b.elements != null) patch.elements = b.elements;
  if (b.paper != null) patch.paper = b.paper;
  if (b.theme != null) patch.theme = b.theme;
  if (b.thumb != null) patch.thumb = b.thumb;
  const board = await db.patch(COLLECTION, params.id, patch);
  if (!board) throw new Error('Board not found.');
  return board;
});

register('DELETE', 'boards/:id', async ({ params }) => {
  await db.remove(COLLECTION, params.id);
  await db.clearBlobsByPrefix(`notaboard/${params.id}/`); // its inserted images
  return { ok: true };
});
