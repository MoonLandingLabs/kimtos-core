// Local handlers for custom wallpapers.
import { register } from '../lib/localRouter.js';
import { dataStore as db } from '../lib/dataStore.js';
import { imageMime } from '../lib/fileType.js';
import { WALLPAPER_MAX_BYTES, megabytes } from '../lib/limits.js';

const blobKey = (id: string): string => `wp:${id}`;

register('GET', 'wallpapers', async () => {
  const list = (await db.list('wallpapers')).sort((a, b) => ((b.added as number) || 0) - ((a.added as number) || 0));
  return { wallpapers: list.map(({ id, name }) => ({ id, name })) };
});

register('POST', 'wallpapers', async ({ form }) => {
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new Error('The file is empty.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > WALLPAPER_MAX_BYTES)
    throw new Error(`Image is larger than the ${megabytes(WALLPAPER_MAX_BYTES)} limit.`);
  if (!imageMime(buffer)) throw new Error("That file isn't a supported image (JPG, PNG, WebP, AVIF, GIF).");
  const rawName = form?.get('name');
  const name = (typeof rawName === 'string' ? rawName : '').trim() || (file.name || 'Custom').replace(/\.[^.]+$/, '');
  const wallpaper = await db.put('wallpapers', { name, added: Date.now() });
  await db.putBlob(blobKey(wallpaper.id), file);
  return { id: wallpaper.id, name: wallpaper.name };
});

register('FILE', 'wallpapers/:id/file', async ({ params }) => {
  const url = await db.blobUrl(blobKey(params.id));
  if (!url) throw new Error('Wallpaper not found.');
  return url;
});

register('DELETE', 'wallpapers/:id', async ({ params }) => {
  await db.remove('wallpapers', params.id);
  await db.delBlob(blobKey(params.id));
  return { ok: true };
});
