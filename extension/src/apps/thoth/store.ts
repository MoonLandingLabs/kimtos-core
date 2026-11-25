// Thoth — on-device vector store, layered on the shared IndexedDB (dataStore).
// Chunk vectors are Float32Arrays, which IndexedDB persists natively via
// structured clone (no lossy JSON). Everything stays on the device.

import { dataStore } from '../../lib/dataStore.js';
import { STORAGE_KEYS } from '@kimtos/config/ui';

const CHUNKS = 'thoth-chunks';
const HASHES_KEY = STORAGE_KEYS.thothHashes;

export interface StoredChunk {
  id: string;
  /** `${app}:${docId}` — groups all chunks of one source document. */
  docKey: string;
  app: string;
  docId: string;
  title: string;
  text: string;
  vector: Float32Array;
}

export async function loadChunks(): Promise<StoredChunk[]> {
  return (await dataStore.list(CHUNKS)) as unknown as StoredChunk[];
}

export async function saveChunks(chunks: Omit<StoredChunk, 'id'>[]): Promise<void> {
  for (const c of chunks) await dataStore.put(CHUNKS, c as unknown as Record<string, unknown>);
}

// Delete every chunk belonging to any of `docKeys` (caller passes the already-
// loaded chunk list so we don't re-read the whole collection per document).
export async function removeDocKeys(all: StoredChunk[], docKeys: Set<string>): Promise<void> {
  for (const c of all) if (docKeys.has(c.docKey)) await dataStore.remove(CHUNKS, c.id);
}

export async function getHashes(): Promise<Record<string, string>> {
  return (await dataStore.kv.get<Record<string, string>>(HASHES_KEY)) ?? {};
}
export async function setHashes(hashes: Record<string, string>): Promise<void> {
  await dataStore.kv.set(HASHES_KEY, hashes);
}
