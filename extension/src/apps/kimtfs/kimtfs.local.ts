// Local data layer for KimtFS — a private on-device file system. Everything is a
// node in the `kimtfs-nodes` records collection: folders and files, linked by
// `parentId` (''=root). Text files keep their content inline; uploaded files keep
// their bytes in a blob keyed `kimtfs:<id>`. Both partitions are prefixed with the
// app id, so AnubisDB attributes them to KimtFS automatically.
//
// Nothing here touches the network. The files live in this browser's IndexedDB and
// nowhere else — which is exactly why the migration below has to be careful: if it
// loses a byte, that byte is gone.

import { register } from '../../lib/localRouter.js';
import { dataStore as db } from '../../lib/dataStore.js';
import { migrateFromHomefs } from './migrate.js';

const NODES = 'kimtfs-nodes';
const blobKey = (id: string): string => `kimtfs:${id}`;

// The app was called `homefs` until #188. Its partitions were id-prefixed (correctly,
// per convention 6), so the rename renames them — and every file the user has ever
// saved would become unreachable. So the old data is carried across, once, before any
// route is allowed to read the store. Every handler awaits this.
const ready: Promise<void> = migrateFromHomefs(db);

// Wrap register() rather than remembering to `await ready` in eight handlers — the one that
// forgot would read a half-migrated tree, and it would do it silently.
type Handler = Parameters<typeof register>[2];
const route = (method: string, pattern: string, handler: Handler): void =>
  register(method, pattern, async (ctx) => {
    await ready;
    return handler(ctx);
  });

// Exported so the app can decide whether a file is small enough to open in the editor
// instead of finding out from a thrown error after the user has typed into it.
export const MAX_TEXT = 200_000;
const guardText = (text: string | undefined): void => {
  if ((text || '').length > MAX_TEXT) throw new Error(`File exceeds the ${MAX_TEXT.toLocaleString()} character limit.`);
};

export interface FsNode {
  id: string;
  parentId: string;
  type: 'folder' | 'file';
  name: string;
  kind?: 'text' | 'blob';
  text?: string;
  blobKey?: string;
  size?: number;
  mime?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

const all = (): Promise<FsNode[]> => db.list(NODES) as unknown as Promise<FsNode[]>;
const cleanName = (name: unknown, fallback: string): string => String(name ?? '').trim() || fallback;

// Lean node for listings (no inline text — fetched per-file when opened).
const lean = (n: FsNode) => ({
  id: n.id,
  parentId: n.parentId ?? '',
  type: n.type,
  name: n.name,
  kind: n.kind,
  size: n.size ?? 0,
  mime: n.mime,
  updatedAt: n.updatedAt ?? 0,
});

// Every descendant of a folder (for recursive delete / move guards).
function descendants(nodes: FsNode[], rootId: string): FsNode[] {
  const byParent = new Map<string, FsNode[]>();
  for (const n of nodes) {
    const arr = byParent.get(n.parentId ?? '') ?? [];
    arr.push(n);
    byParent.set(n.parentId ?? '', arr);
  }
  const out: FsNode[] = [];
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      if (child.type === 'folder') walk(child.id);
    }
  };
  walk(rootId);
  return out;
}

// --- read ---
route('GET', 'kimtfs/nodes', async () => {
  const nodes = (await all()).sort(
    (a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.name.localeCompare(b.name),
  );
  return { nodes: nodes.map(lean) };
});

route('GET', 'kimtfs/nodes/:id', async ({ params }) => {
  const node = (await db.get(NODES, params.id)) as unknown as FsNode | null;
  if (!node) throw new Error('Not found.');
  return node;
});

route('FILE', 'kimtfs/blob/:id', async ({ params }) => db.blobUrl(blobKey(params.id)));

// --- create ---
route('POST', 'kimtfs/folders', async ({ body }) => {
  const b = (body || {}) as { parentId?: string; name?: string };
  const now = Date.now();
  return db.put(NODES, {
    parentId: b.parentId || '',
    type: 'folder',
    name: cleanName(b.name, 'New folder'),
    createdAt: now,
    updatedAt: now,
  });
});

route('POST', 'kimtfs/files', async ({ body }) => {
  const b = (body || {}) as { parentId?: string; name?: string; text?: string };
  guardText(b.text);
  const now = Date.now();
  const text = b.text || '';
  return db.put(NODES, {
    parentId: b.parentId || '',
    type: 'file',
    kind: 'text',
    name: cleanName(b.name, 'Untitled.txt'),
    text,
    size: text.length,
    createdAt: now,
    updatedAt: now,
  });
});

route('POST', 'kimtfs/upload', async ({ form }) => {
  const file = form?.get('file');
  if (!(file instanceof Blob)) throw new Error('No file provided.');
  const parentId = String(form?.get('parentId') ?? '');
  const name = cleanName((file as File).name, 'Upload');
  const now = Date.now();
  const node = (await db.put(NODES, {
    parentId,
    type: 'file',
    kind: 'blob',
    name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    createdAt: now,
    updatedAt: now,
  })) as unknown as FsNode;
  await db.putBlob(blobKey(node.id), file);
  return db.patch(NODES, node.id, { blobKey: blobKey(node.id) });
});

// --- update (rename / edit content / move) ---
route('PATCH', 'kimtfs/nodes/:id', async ({ params, body }) => {
  const b = (body || {}) as { name?: string; text?: string; parentId?: string };
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (b.name != null) patch.name = cleanName(b.name, 'Untitled');
  if (b.text != null) {
    guardText(b.text);
    // WHERE the bytes live decides how an edit is written. A file created in the app is a
    // `text` node and keeps its content inline; an UPLOADED text file is a `blob` node, and
    // writing `text` onto it would leave the actual bytes untouched — the edit would look
    // saved and be gone on reopen. So a blob node has its blob rewritten instead (#651).
    const current = (await db.get(NODES, params.id)) as unknown as FsNode | null;
    if (current?.kind === 'blob') {
      const blob = new Blob([b.text], { type: current.mime || 'text/plain' });
      await db.putBlob(blobKey(params.id), blob);
      patch.size = blob.size; // bytes, matching how the upload route sized it
    } else {
      patch.text = b.text;
      patch.size = b.text.length;
    }
  }
  if (b.parentId != null) {
    // Don't let a folder be moved inside itself/its own subtree.
    if (b.parentId === params.id) throw new Error("Can't move a folder into itself.");
    const nodes = await all();
    if (descendants(nodes, params.id).some((n) => n.id === b.parentId))
      throw new Error("Can't move a folder into its own subfolder.");
    patch.parentId = b.parentId;
  }
  const node = await db.patch(NODES, params.id, patch);
  if (!node) throw new Error('Not found.');
  return node;
});

// --- delete (recursive; frees any blobs) ---
route('DELETE', 'kimtfs/nodes/:id', async ({ params }) => {
  const nodes = await all();
  const node = nodes.find((n) => n.id === params.id);
  if (!node) return { ok: true };
  const doomed = node.type === 'folder' ? [node, ...descendants(nodes, node.id)] : [node];
  for (const n of doomed) {
    if (n.kind === 'blob') await db.delBlob(blobKey(n.id));
    await db.remove(NODES, n.id);
  }
  return { ok: true };
});
