// The app registry, rebuilt for Node.
//
// `src/apps/index.ts` and `src/apps/metaIndex.ts` are built with Vite's `import.meta.glob`, which
// Node does not have. That one piece of Vite-only syntax makes EVERYTHING that imports the
// registry untestable — every view and every controller. #227 gave the runner a DOM; this is the
// sibling wall.
//
// Only the two glob modules are stubbed, and they are rebuilt from the REAL meta.ts files — so a
// test sees the actual apps, with their actual ids and names. Nothing under test is faked.

import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps');

const metas = [];
for (const name of readdirSync(appsDir)) {
  const meta = join(appsDir, name, 'meta.ts');
  if (!existsSync(meta)) continue;
  const mod = await import(pathToFileURL(meta).href);
  if (mod.default?.id) metas.push(mod.default);
}
metas.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

// --- src/apps/metaIndex.ts ---
// `metas` is the array both registries read; __setApps() rewrites it in place too, because
// the install model (models/installed.ts) reads `optIn`/`required` from the meta, not from the
// descriptor.
export const appMeta = (id) => metas.find((m) => m.id === id);
export const allAppMetas = () => [...metas];

// --- src/apps/index.ts ---
// The descriptors, minus `render` (a test that needs an app's UI should import that app directly).
export const apps = metas.map((m) => ({
  id: m.id,
  name: m.name,
  accent: m.accent,
  order: m.order,
  description: m.marketing?.desc ?? '',
  tools: [],
  render: () => () => {},
}));
export default apps;

/**
 * Replace the registry, IN PLACE, for a test.
 *
 * A real app descriptor cannot be imported in Node — every app's index.ts begins with
 * `import './x.css'` — which is why the ones above are rebuilt from meta.ts and carry no
 * `widget()`. A test that needs a widget (e.g. the home screen) supplies its own.
 *
 * It mutates the array rather than reassigning it, because consumers hold the imported reference
 * (`appList.map(...)` in appController), and a reassignment here would not reach them.
 */
export function __setApps(list) {
  apps.length = 0;
  apps.push(...list);
  // The metas too: models/installed.ts asks the META (apps/meta.ts is the single source of
  // `optIn`/`required`), so an injected app has to be there as well.
  metas.length = 0;
  metas.push(...list.map((a) => ({ id: a.id, name: a.name, accent: a.accent, order: a.order })));
}
