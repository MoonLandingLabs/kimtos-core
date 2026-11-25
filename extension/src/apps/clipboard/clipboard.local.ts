// Local API routes for the Clipboard app. The UI and the KimtAI agent tools both
// call these (via getApi/jsonApi) so they can never drift. Capture itself happens
// in the background service worker; these are the browse/edit/manage operations.
import { register } from '../../lib/localRouter.js';
import {
  addClip,
  clearClips,
  exportClips,
  getTags,
  importClips,
  listClips,
  mergeClips,
  patchClip,
  removeClip,
  stats,
  tagClip,
  untagClip,
} from '../../lib/clipboardStore.js';
import type { ClipItem } from '../../lib/clipboardShared.js';

function filterSort(clips: ClipItem[], query: Record<string, string>): ClipItem[] {
  let out = clips;
  if (query.favorites === '1') out = out.filter((c) => c.favorite);
  if (query.tag) out = out.filter((c) => c.tags.includes(query.tag));
  const q = (query.q || '').trim().toLowerCase();
  if (q) out = out.filter((c) => c.text.toLowerCase().includes(q));
  if (query.sort === 'alpha') out = [...out].sort((a, b) => a.text.localeCompare(b.text));
  return out;
}

register('GET', 'clips', async ({ query }) => {
  return { clips: filterSort(await listClips(), query) };
});

register('GET', 'clips/stats', async () => stats());

register('GET', 'clips/tags', async () => ({ tags: await getTags() }));

register('GET', 'clips/export', async () => exportClips());

// Manual add (paste-in box / agent create_clip).
register('POST', 'clips', async ({ body }) => {
  const text = String((body as { text?: string })?.text || '');
  if (!text.trim()) throw new Error('Nothing to save.');
  const { item } = await addClip({ text });
  return item;
});

register('POST', 'clips/merge', async ({ body }) => {
  const { ids, separator } = (body || {}) as { ids?: string[]; separator?: string };
  const item = await mergeClips(ids || [], separator ?? '\n');
  if (!item) throw new Error('Select at least two clips to merge.');
  return item;
});

register('POST', 'clips/import', async ({ body }) => ({ imported: await importClips(body) }));

register('POST', 'clips/clear', async ({ body }) => {
  const scope = (body as { scope?: 'all' | 'non-favorites' })?.scope === 'all' ? 'all' : 'non-favorites';
  return { removed: await clearClips(scope) };
});

register('PATCH', 'clips/:id', async ({ params, body }) => {
  const patch = (body || {}) as Partial<ClipItem>;
  const item = await patchClip(params.id, patch);
  if (!item) throw new Error('Clip not found.');
  return item;
});

register('POST', 'clips/:id/tag', async ({ params, body }) => {
  const name = String((body as { name?: string })?.name || '').trim();
  if (!name) throw new Error('A tag name is required.');
  const item = await tagClip(params.id, name);
  if (!item) throw new Error('Clip not found.');
  return item;
});

register('POST', 'clips/:id/untag', async ({ params, body }) => {
  const name = String((body as { name?: string })?.name || '');
  const item = await untagClip(params.id, name);
  if (!item) throw new Error('Clip not found.');
  return item;
});

register('DELETE', 'clips/:id', async ({ params }) => {
  await removeClip(params.id);
  return { ok: true };
});
