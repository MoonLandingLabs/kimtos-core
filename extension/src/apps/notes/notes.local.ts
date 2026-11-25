// Local handlers for notes. Notes are organized as collections (a notebook,
// e.g. per book) each holding one or more Markdown pages. A collection's
// `updated` is bumped whenever one of its pages changes, so "recent" sorting
// reflects activity.

import { register } from '../../lib/localRouter.js';
import { STORAGE_KEYS } from '@kimtos/config/ui';
import { dataStore as db } from '../../lib/dataStore.js';
import { NOTE_MAX_CHARS, grouped } from '../../lib/limits.js';

interface Collection {
  id: string;
  name?: string;
  updated?: number;
  [key: string]: unknown;
}
interface Page {
  id: string;
  collectionId: string;
  title?: string;
  content?: string;
  updated?: number;
  [key: string]: unknown;
}

const guardSize = (content: string | undefined): void => {
  if ((content || '').length > NOTE_MAX_CHARS)
    throw new Error(`Page exceeds the ${grouped(NOTE_MAX_CHARS)} character limit.`);
};

const touchCollection = (id: string): Promise<unknown> => db.patch('collections', id, { updated: Date.now() });

// One-time migration: the old flat `notes` become pages in a "My Notes"
// collection. Guarded by a single in-flight promise so concurrent handler calls
// on first load can't migrate twice.
let migrating: Promise<void> | null = null;
function migrate(): Promise<void> {
  if (!migrating) migrating = doMigrate();
  return migrating;
}
async function doMigrate(): Promise<void> {
  if (await db.kv.get(STORAGE_KEYS.notesMigrated)) return;
  const legacy = (await db.list('notes')) as unknown as {
    id: string;
    title?: string;
    content?: string;
    updated?: number;
  }[];
  if (legacy.length) {
    const col = await db.put('collections', { name: 'My Notes', updated: Date.now() });
    for (const note of legacy.sort((a, b) => (a.updated || 0) - (b.updated || 0))) {
      await db.put('pages', {
        collectionId: col.id,
        title: note.title || 'Untitled',
        content: note.content || '',
        updated: note.updated || Date.now(),
      });
      await db.remove('notes', note.id);
    }
  }
  await db.kv.set(STORAGE_KEYS.notesMigrated, true);
}

// --- collections ---
register('GET', 'collections', async () => {
  await migrate();
  const collections = ((await db.list('collections')) as unknown as Collection[]).sort(
    (a, b) => (b.updated || 0) - (a.updated || 0),
  );
  const pages = (await db.list('pages')) as unknown as Page[];
  const counts = pages.reduce<Record<string, number>>((m, p) => {
    m[p.collectionId] = (m[p.collectionId] || 0) + 1;
    return m;
  }, {});
  return {
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      updated: c.updated,
      pageCount: counts[c.id] || 0,
    })),
  };
});

register('POST', 'collections', async ({ body }) => {
  await migrate();
  const b = (body || {}) as { name?: string };
  return db.put('collections', { name: (b.name || '').trim() || 'New collection', updated: Date.now() });
});

register('PATCH', 'collections/:id', async ({ params, body }) => {
  const b = (body || {}) as { name?: string };
  const patch: Record<string, unknown> = { updated: Date.now() };
  if (b.name != null) patch.name = b.name.trim() || 'Untitled collection';
  const collection = await db.patch('collections', params.id, patch);
  if (!collection) throw new Error('Collection not found.');
  return collection;
});

// IDEMPOTENT, and that is load-bearing: a batch delete can hit an id that is already gone
// (a page selected alongside its own collection, which cascades below), and the bulk commit
// must see that as success — `db.remove` of a missing id is a no-op that resolves. Only a
// REAL store failure may reject here; the commit throws it so the undo toast can say so and
// the row comes back (#947). Do not add a "not found" throw to either DELETE.
register('DELETE', 'collections/:id', async ({ params }) => {
  const pages = ((await db.list('pages')) as unknown as Page[]).filter((p) => p.collectionId === params.id);
  for (const page of pages) await db.remove('pages', page.id);
  await db.remove('collections', params.id);
  return { ok: true };
});

// --- pages (within a collection) ---
register('GET', 'collections/:id/pages', async ({ params }) => {
  await migrate();
  const pages = ((await db.list('pages')) as unknown as Page[])
    .filter((p) => p.collectionId === params.id)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return { pages: pages.map(({ id, title, updated }) => ({ id, title, updated })) };
});

register('POST', 'collections/:id/pages', async ({ params, body }) => {
  const b = (body || {}) as { title?: string; content?: string };
  guardSize(b.content);
  const page = await db.put('pages', {
    collectionId: params.id,
    title: b.title || 'Untitled',
    content: b.content || '',
    updated: Date.now(),
  });
  await touchCollection(params.id);
  return page;
});

register('GET', 'pages/:id', async ({ params }) => {
  const page = await db.get('pages', params.id);
  if (!page) throw new Error('Page not found.');
  return page;
});

register('PATCH', 'pages/:id', async ({ params, body }) => {
  const b = (body || {}) as { title?: string; content?: string; collectionId?: string };
  if (b.content != null) guardSize(b.content);
  const patch: Record<string, unknown> = { updated: Date.now() };
  if (b.title != null) patch.title = b.title;
  if (b.content != null) patch.content = b.content;
  // Moving a page to another collection: validate the target and remember the
  // origin so both collections' "recent" timestamps get bumped.
  let from: string | null = null;
  if (b.collectionId != null) {
    if (!(await db.get('collections', b.collectionId))) throw new Error('Target collection not found.');
    from = ((await db.get('pages', params.id)) as unknown as Page | null)?.collectionId ?? null;
    patch.collectionId = b.collectionId;
  }
  const page = (await db.patch('pages', params.id, patch)) as unknown as Page | null;
  if (!page) throw new Error('Page not found.');
  await touchCollection(page.collectionId);
  if (from && from !== page.collectionId) await touchCollection(from);
  return page;
});

// IDEMPOTENT — see the note on DELETE collections/:id (#947).
register('DELETE', 'pages/:id', async ({ params }) => {
  const page = (await db.get('pages', params.id)) as unknown as Page | null;
  await db.remove('pages', params.id);
  if (page) await touchCollection(page.collectionId);
  return { ok: true };
});
