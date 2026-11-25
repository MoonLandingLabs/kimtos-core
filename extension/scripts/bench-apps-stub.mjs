// The production app registry (src/apps/index.ts) is built with Vite's `import.meta.glob`,
// which does not exist in Node. The bench redirects that ONE module here (see
// bench-loader.mjs) and rebuilds the same list from each app's meta.ts, which is plain TS.
//
// This is deliberately the only thing that is stubbed. The prompt builder and the parser under
// measurement are the production ones, untouched — the app list only feeds the prompt's "apps
// you could install" section, and it is reproduced faithfully rather than emptied.

import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'apps');

const loaded = [];
for (const id of readdirSync(appsDir)) {
  const meta = join(appsDir, id, 'meta.ts');
  if (!existsSync(meta)) continue;
  const mod = await import(pathToFileURL(meta).href);
  const m = mod.default;
  if (!m?.id) continue;
  loaded.push({
    id: m.id,
    name: m.name,
    accent: m.accent,
    order: m.order,
    description: m.marketing?.desc ?? '',
    tools: [],
  });
}

export const apps = loaded.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
export default apps;

// src/apps/metaIndex.ts is the second Vite-glob module. Same exports, same shapes.
const metas = loaded.map((a) => ({ id: a.id, name: a.name, accent: a.accent, order: a.order }));
export const appMeta = (id) => metas.find((m) => m.id === id);
export const allAppMetas = () => [...metas];
