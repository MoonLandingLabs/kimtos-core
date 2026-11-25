// AnubisDB registry — resolves which app owns each raw IndexedDB partition, so
// the explorer can group data (and name it) under the app that stored it.
//
// It is DERIVED, not hand-maintained: app labels come from every app's meta.ts
// (via metaIndex), and ownership follows the storage convention — a records
// collection, blob namespace, or kv key is prefixed with the owning app's id
// (`thoth-chunks`, `thoth:hashes`, `kimtai:downloaded`, `history:<app>`). So a
// new app's data is mapped automatically, with no edit here. The legacy tables
// below only cover a few early collections whose names predate the convention
// (`todos`, `pages`, …). Anything still unresolved shows under "Unmapped data".

import { allAppMetas } from '../metaIndex.js';

export interface AppMeta {
  id: string;
  name: string;
  accent: string;
}

// Data owners that aren't a dock app (system buckets + the fallback).
const EXTRA: Record<string, AppMeta> = {
  wallpapers: { id: 'wallpapers', name: 'Wallpapers', accent: '#38bdf8' },
  system: { id: 'system', name: 'Settings & caches', accent: '#94a3b8' },
  unknown: { id: 'unknown', name: 'Unmapped data', accent: '#8b93a3' },
};

// Every app (labelled + coloured from its own meta.ts) plus the system buckets.
export const APPS: Record<string, AppMeta> = {
  ...Object.fromEntries(allAppMetas().map((m) => [m.id, { id: m.id, name: m.name, accent: m.accent }])),
  ...EXTRA,
};

const APP_IDS = new Set(allAppMetas().map((m) => m.id));

// Legacy collection names that predate the `<appId>-…` convention.
const RECORD_OWNER: Record<string, string> = {
  collections: 'notes',
  pages: 'notes',
  notes: 'notes',
  books: 'pdflib',
  annotations: 'pdflib',
  todos: 'tasks',
  boards: 'notaboard',
  chats: 'kimtai',
  wallpapers: 'wallpapers',
  'tab-sessions': 'tabs',
};

// Legacy blob/kv key prefixes (token before ':') that predate the convention.
const PREFIX_OWNER: Record<string, string> = {
  pdf: 'pdflib',
  wallpaper: 'wallpapers',
  wp: 'wallpapers', // custom-wallpaper image blobs (local/wallpapers.local.ts)
  model: 'kimtai',
  chat: 'kimtai',
  notes: 'notes',
  readit: 'system',
  weather: 'system',
};

// Resolve the owning app id for a records collection, blob namespace, or kv key.
export function ownerOf(name: string): string {
  const n = String(name);
  // `history:<app>` (and `history:<app>/<uid>` blobs) map straight to the app.
  if (n.startsWith('history:')) {
    const app = n.slice('history:'.length).split('/')[0];
    return APPS[app] ? app : 'unknown';
  }
  // Settings mirror: `settings:<appId>` → that app (store.ts per-app config, plus
  // `settings:<appId>-<sub>` for content-script config like `settings:grammit-anywhere`
  // / `settings:clipboard-capture`). The non-app `settings:general` (and any legacy
  // `settings:prefs`) → the system bucket. App ids never contain `-`, so the leading
  // segment before `-`/`:`/`/` is the owner.
  if (n.startsWith('settings:')) {
    const seg = n.slice('settings:'.length).split(/[-:/]/)[0];
    return APP_IDS.has(seg) ? seg : 'system';
  }
  // `name` may be a full key (`pdf:123`) or an already-stripped namespace (`pdf`).
  const colon = n.indexOf(':');
  const prefix = colon > 0 ? n.slice(0, colon) : n;
  if (PREFIX_OWNER[prefix]) return PREFIX_OWNER[prefix];
  if (RECORD_OWNER[n]) return RECORD_OWNER[n];
  // Convention: the leading segment (before `-`, `:` or `/`) is the owning app id
  // — `thoth-chunks` → thoth, `thoth:hashes` → thoth, `kimtai:downloaded` → kimtai.
  const seg = n.split(/[-:/]/)[0];
  if (APP_IDS.has(seg)) return seg;
  return 'unknown';
}

export const appMeta = (id: string): AppMeta => APPS[id] ?? APPS.unknown;
