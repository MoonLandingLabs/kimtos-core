import { dataStore as db } from './dataStore.js';

// A shared `history:<app>` record store for apps that keep a capped list of
// user items, each optionally referencing one or more blobs. Centralizes the
// three pieces that were copy-pasted across denoise, vidrec and the media-text
// factory: newest-first listing, blob-aware delete, and newest-N pruning.
//
//   const hist = createBlobHistory('history:denoise',
//     { limit: 30, blobKeys: ['origKey', 'cleanKey'] });
//
// `blobKeys` names the record fields that hold blob keys to delete alongside the
// record. Apps keep their own `save*` (blob layout differs) and just call
// `hist.prune()` at the end. Returns { collection, load, remove, prune }.

interface HistoryEntry {
  id: string;
  at?: number;
  [key: string]: unknown;
}

export function createBlobHistory(
  collection: string,
  { limit, blobKeys = ['blobKey'] }: { limit?: number; blobKeys?: string[] } = {},
) {
  const load = async (): Promise<HistoryEntry[]> =>
    ((await db.list(collection)) as HistoryEntry[]).sort((a, b) => (b.at || 0) - (a.at || 0));
  const remove = async (entry: HistoryEntry): Promise<void> => {
    for (const key of blobKeys) if (entry[key]) await db.delBlob(String(entry[key]));
    await db.remove(collection, entry.id);
  };
  const prune = async (): Promise<void> => {
    if (!limit) return;
    for (const old of (await load()).slice(limit)) await remove(old); // keep newest N
  };
  return { collection, load, remove, prune };
}
