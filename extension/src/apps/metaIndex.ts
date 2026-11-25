// Look up an app's catalog metadata (from its meta.ts) by id — used by the App
// Store to show version / category / highlights without threading them
// through every descriptor. Auto-discovers every apps/<id>/meta.ts.

import type { AppMeta } from './meta.js';

const modules = import.meta.glob<{ default?: AppMeta }>('./*/meta.{js,ts}', { eager: true });

const byId = new Map<string, AppMeta>();
for (const m of Object.values(modules)) {
  if (m.default) byId.set(m.default.id, m.default);
}

export const appMeta = (id: string): AppMeta | undefined => byId.get(id);

/** Every app's metadata (used e.g. by AnubisDB to label + own each app's data). */
export const allAppMetas = (): AppMeta[] => [...byId.values()];
