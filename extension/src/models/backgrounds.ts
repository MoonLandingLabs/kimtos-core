// Bundled wallpapers are the image files in src/assets/images/wallpapers. Vite
// bundles each one and hands back its hashed URL, so dropping an image into that
// folder is enough to add it to the rotation. Non-wallpaper art (e.g. vidrec's
// camera-off avatar) lives in the parent images/ folder so it never appears as a
// wallpaper. User-uploaded wallpapers are stored separately in IndexedDB.

const files = import.meta.glob<string>('../assets/images/wallpapers/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const baseName = (path: string): string => (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');

// Attribution for bundled wallpapers, keyed by filename (without ext).
interface Credit {
  author: string;
  source?: string;
}
const CREDITS: Record<string, Credit> = {
  'default-light': { author: 'kimtos' },
  'default-dark': { author: 'kimtos' },
};

const titleCase = (s: string): string => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export interface Background {
  id: string;
  author: string;
  source?: string;
  url: string;
}

export const backgrounds: Background[] = Object.entries(files).map(([path, url]) => {
  const id = baseName(path);
  const credit = CREDITS[id];
  return { id, author: credit?.author ?? titleCase(id), source: credit?.source, url };
});

export const byId = (id: string): Background | undefined => backgrounds.find((b) => b.id === id);

// The two bundled defaults, one per theme. When the user hasn't pinned their own
// wallpaper, the background follows the active theme (see backgroundController).
const DEFAULT_BG = { light: 'default-light', dark: 'default-dark' } as const;
export const defaultFor = (theme: 'light' | 'dark'): Background | undefined => byId(DEFAULT_BG[theme]);
