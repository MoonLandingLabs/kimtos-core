// Clipboard app — the persistence layer over the shared dataStore. Used by the
// background service worker (on capture) AND the app's local routes / agent tools
// (manual create, browse, edit), so dedupe + trim behave identically everywhere.
// The capture content script must NOT import this (it can't reach the extension
// IndexedDB) — it only talks to the SW.

import { dataStore } from './dataStore.js';
import {
  CLIP_COLLECTION,
  TAGS_KEY,
  byteLen,
  classifyText,
  clipboardActive,
  getCaptureState,
  hashText,
  imageBlobKey,
  previewOf,
  type ClipItem,
  type ClipSource,
} from './clipboardShared.js';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface Tag {
  name: string;
  color: string;
}

const asClips = (rows: unknown[]): ClipItem[] => rows as unknown as ClipItem[];

/** All clips, most-recently-used first. */
export async function listClips(): Promise<ClipItem[]> {
  const clips = asClips(await dataStore.list(CLIP_COLLECTION));
  return clips.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

export async function getClip(id: string): Promise<ClipItem | null> {
  return (await dataStore.get(CLIP_COLLECTION, id)) as unknown as ClipItem | null;
}

// Nothing may be written for a user who hasn't installed Clipboard. That rule is enforced HERE, in the only two functions that can create a clip —
// not in each caller. A caller-side check is one you can forget, and forgetting it is
// silent (the write just succeeds); that is exactly how #51 happened. Reads, edits and
// deletes stay open: a user who uninstalls must still be able to see and erase the
// clips they already own.

/**
 * Add a clip (or bump an existing identical one). Dedupe is by hash, confirmed by
 * exact text so a hash collision can never merge two different clips. After an
 * insert we trim to `maxItems`, never evicting favorites.
 */
export async function addClip(input: { text: string; source?: ClipSource }): Promise<{
  added: boolean;
  item: ClipItem | null;
}> {
  const text = input.text ?? '';
  if (!text.trim()) return { added: false, item: null };
  if (!(await clipboardActive())) return { added: false, item: null };
  const hash = hashText(text);
  const now = Date.now();
  const existing = (await listClips()).find((c) => c.hash === hash && c.text === text);
  if (existing) {
    const item = (await dataStore.patch(CLIP_COLLECTION, existing.id, {
      lastUsedAt: now,
      useCount: (existing.useCount || 0) + 1,
      source: input.source ?? existing.source,
    })) as unknown as ClipItem;
    return { added: false, item };
  }
  const item: ClipItem = {
    id: dataStore.uid(),
    type: classifyText(text),
    text,
    preview: previewOf(text),
    hash,
    bytes: byteLen(text),
    favorite: false,
    tags: [],
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
    source: input.source,
  };
  await dataStore.put(CLIP_COLLECTION, item as unknown as Record<string, unknown>);
  await trim();
  return { added: true, item };
}

/** Add a copied image (dedupe by content hash). The bytes live in the blob store. */
export async function addImageClip(input: { dataUrl: string; mime: string; source?: ClipSource }): Promise<{
  added: boolean;
  item: ClipItem | null;
}> {
  const { dataUrl, mime } = input;
  if (!dataUrl.startsWith('data:')) return { added: false, item: null };
  if (!(await clipboardActive())) return { added: false, item: null };
  const hash = hashText(dataUrl);
  const now = Date.now();
  const existing = (await listClips()).find((c) => c.type === 'image' && c.hash === hash);
  if (existing) {
    const item = (await dataStore.patch(CLIP_COLLECTION, existing.id, {
      lastUsedAt: now,
      useCount: (existing.useCount || 0) + 1,
    })) as unknown as ClipItem;
    return { added: false, item };
  }
  const blob = await (await fetch(dataUrl)).blob();
  const id = dataStore.uid();
  await dataStore.putBlob(imageBlobKey(id), blob);
  const item: ClipItem = {
    id,
    type: 'image',
    text: '',
    preview: 'Image',
    hash,
    bytes: blob.size,
    favorite: false,
    tags: [],
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
    source: input.source,
    mime,
  };
  await dataStore.put(CLIP_COLLECTION, item as unknown as Record<string, unknown>);
  await trim();
  return { added: true, item };
}

/** Evict oldest non-favorite clips beyond `maxItems`. */
export async function trim(): Promise<void> {
  const { maxItems } = await getCaptureState();
  const clips = await listClips();
  if (clips.length <= maxItems) return;
  const evictable = clips.filter((c) => !c.favorite).sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
  let over = clips.length - maxItems;
  for (const c of evictable) {
    if (over <= 0) break;
    await removeClip(c.id);
    over--;
  }
}

export async function patchClip(id: string, patch: Partial<ClipItem>): Promise<ClipItem | null> {
  // Keep derived fields honest when the text itself is edited.
  const extra: Partial<ClipItem> = {};
  if (typeof patch.text === 'string') {
    extra.preview = previewOf(patch.text);
    extra.hash = hashText(patch.text);
    extra.bytes = byteLen(patch.text);
    extra.type = classifyText(patch.text);
  }
  return (await dataStore.patch(CLIP_COLLECTION, id, {
    ...patch,
    ...extra,
  })) as unknown as ClipItem | null;
}

// One-off reclassification (#948). A clip's `type` is derived at capture and re-derived
// only on an edit, so colours the old classifier missed (4/8-digit hex, oklch() and the
// other modern functions) are stored as `text` forever unless corrected here. Re-derive
// every non-image clip's type once per classifier version and patch the disagreements.
const CLASSIFY_VERSION_KEY = 'clipboard:classify-v';
const CLASSIFY_VERSION = 2;

/** Re-derive stored clip types after a classifier change. Returns how many changed. */
export async function reclassifyClips(): Promise<number> {
  if ((await dataStore.kv.get<number>(CLASSIFY_VERSION_KEY)) === CLASSIFY_VERSION) return 0;
  let n = 0;
  for (const c of await listClips()) {
    if (c.type === 'image') continue;
    const type = classifyText(c.text);
    if (type !== c.type) {
      await dataStore.patch(CLIP_COLLECTION, c.id, { type });
      n++;
    }
  }
  await dataStore.kv.set(CLASSIFY_VERSION_KEY, CLASSIFY_VERSION);
  return n;
}

export async function removeClip(id: string): Promise<void> {
  const clip = await getClip(id);
  if (clip?.type === 'image') await dataStore.delBlob(imageBlobKey(id));
  await dataStore.remove(CLIP_COLLECTION, id);
}

/** Combine several clips (most-recent first) into one new clip. */
export async function mergeClips(ids: string[], separator = '\n'): Promise<ClipItem | null> {
  const byId = new Map((await listClips()).map((c) => [c.id, c]));
  const chosen = ids.map((id) => byId.get(id)).filter((c): c is ClipItem => Boolean(c));
  if (chosen.length < 2) return null;
  const text = chosen.map((c) => c.text).join(separator);
  const { item } = await addClip({ text });
  return item;
}

/** Storage analytics for the app footer. */
export async function stats(): Promise<{
  count: number;
  bytes: number;
  favorites: number;
  byType: Record<string, number>;
}> {
  const clips = await listClips();
  const byType: Record<string, number> = {};
  let bytes = 0;
  let favorites = 0;
  for (const c of clips) {
    bytes += c.bytes || 0;
    if (c.favorite) favorites++;
    byType[c.type] = (byType[c.type] || 0) + 1;
  }
  return { count: clips.length, bytes, favorites, byType };
}

/** Remove all clips, or only the non-favorites. Returns how many were removed. */
export async function clearClips(scope: 'all' | 'non-favorites'): Promise<number> {
  const clips = await listClips();
  const doomed = scope === 'all' ? clips : clips.filter((c) => !c.favorite);
  for (const c of doomed) await removeClip(c.id);
  return doomed.length;
}

// --- tags (colour palette lives in kv; items reference tag names) -------------

const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];

export async function getTags(): Promise<Tag[]> {
  return (await dataStore.kv.get<Tag[]>(TAGS_KEY)) || [];
}

/** Create the tag if new (auto-assigning the next palette colour) and return it. */
async function ensureTag(name: string): Promise<Tag> {
  const clean = name.trim();
  const tags = await getTags();
  const found = tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const tag: Tag = { name: clean, color: PALETTE[tags.length % PALETTE.length] };
  await dataStore.kv.set(TAGS_KEY, [...tags, tag]);
  return tag;
}

export async function tagClip(id: string, name: string): Promise<ClipItem | null> {
  const tag = await ensureTag(name);
  const clip = await getClip(id);
  if (!clip) return null;
  if (clip.tags.includes(tag.name)) return clip;
  return patchClip(id, { tags: [...clip.tags, tag.name] });
}

export async function untagClip(id: string, name: string): Promise<ClipItem | null> {
  const clip = await getClip(id);
  if (!clip) return null;
  return patchClip(id, { tags: clip.tags.filter((t) => t !== name) });
}

// --- import / export ----------------------------------------------------------

export interface ClipExport {
  format: 'kimtos-clipboard';
  version: 1;
  exportedAt: number;
  items: Array<ClipItem & { dataUrl?: string }>;
  tags: Tag[];
}

export async function exportClips(): Promise<ClipExport> {
  const items: Array<ClipItem & { dataUrl?: string }> = [];
  for (const c of await listClips()) {
    if (c.type === 'image') {
      const blob = await dataStore.getBlob(imageBlobKey(c.id));
      items.push({ ...c, dataUrl: blob ? await blobToDataUrl(blob) : undefined });
    } else {
      items.push(c);
    }
  }
  return { format: 'kimtos-clipboard', version: 1, exportedAt: Date.now(), items, tags: await getTags() };
}

/** Import items (merging by hash) from our export or a compatible {items:[{text}]}. */
export async function importClips(data: unknown): Promise<number> {
  const rows = (data as { items?: Array<Partial<ClipItem> & { dataUrl?: string }> })?.items;
  if (!Array.isArray(rows)) throw new Error('Not a clipboard export file.');
  let n = 0;
  for (const row of rows) {
    if (row?.type === 'image' && row.dataUrl) {
      const { added } = await addImageClip({ dataUrl: row.dataUrl, mime: row.mime || 'image/png' });
      if (added) n++;
      continue;
    }
    if (!row?.text) continue;
    const { item, added } = await addClip({ text: String(row.text) });
    if (item && (row.favorite || row.tags?.length)) {
      await patchClip(item.id, { favorite: Boolean(row.favorite), tags: row.tags ?? item.tags });
    }
    if (added) n++;
  }
  return n;
}
