import { store } from '../models/store.js';
import { backgrounds, byId, defaultFor, type Background } from '../models/backgrounds.js';
import { resolvedTheme } from '../lib/theme.js';
import { renderBackgroundBar, renderCredit } from '../views/backgroundBar.js';
import { fileUrl, getApi, callApi, jsonApi } from '../lib/api.js';

interface Wp {
  id: string;
  author: string;
  url: string;
  custom?: boolean;
}

const CUSTOM = 'custom:'; // prefix marking a user-uploaded wallpaper id
// Resolves a stored wallpaper to a local object URL.
const customUrl = async (rawId: string): Promise<string> => (await fileUrl(`wallpapers/${rawId}/file`)) as string;

function preload(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = reject;
    img.src = url;
  });
}

export function createBackgroundController({
  layerEl,
  barEl,
  creditEl,
}: {
  layerEl: HTMLElement;
  barEl: HTMLElement;
  creditEl: HTMLElement;
}) {
  let current: Wp | null = null;
  let customList: Wp[] = []; // [{ id:'custom:xx', author, url, custom:true }]
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((fn) => fn());

  // Bundled wallpapers the user has removed are hidden (the files stay in the
  // build; "Restore" just clears this list). Rotation + the gallery skip them.
  const hiddenIds = (): string[] => store.get('hiddenBgIds') || [];
  const visibleBundled = (): Background[] => backgrounds.filter((b) => !hiddenIds().includes(b.id));

  // The rotation pool: the user's uploaded wallpapers plus the visible bundled
  // ones. `customList` is kept current by loadCustom() (called in init/upload/etc).
  const rotationPool = (): Wp[] => [...customList, ...visibleBundled()];

  function pickRandom(excludeId: string | null): Wp | null {
    const pool = rotationPool();
    const choices = excludeId ? pool.filter((b) => b.id !== excludeId) : pool;
    const arr = choices.length ? choices : pool;
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  }
  function pickNext(currentId: string | undefined): Wp | null {
    const pool = rotationPool();
    if (!pool.length) return null;
    const i = pool.findIndex((b) => b.id === currentId);
    return pool[(i + 1) % pool.length];
  }
  // Bundled-only fallback for apply()'s error recovery (always-present images).
  function pickNextBundled(currentId: string | undefined): Background | null {
    const pool = visibleBundled();
    if (!pool.length) return null;
    const i = pool.findIndex((b) => b.id === currentId);
    return pool[(i + 1) % pool.length];
  }

  function clearBackground(): void {
    current = null;
    layerEl.classList.remove('is-loaded');
    layerEl.style.backgroundImage = '';
    renderCredit(creditEl, null);
    paintBar();
  }

  // Resolve a stored id (bundled or custom) into a wallpaper object.
  async function resolve(id: string | null): Promise<Wp | null> {
    if (!id) return null;
    if (id.startsWith(CUSTOM)) {
      const found = customList.find((c) => c.id === id);
      if (found) return found;
      try {
        return { id, author: 'Custom wallpaper', url: await customUrl(id.slice(CUSTOM.length)), custom: true };
      } catch {
        // The blob is gone — e.g. the user cleared all data in AnubisDB. Forget
        // the dangling pointer and fall back to the default rotation instead of
        // throwing, so the page returns to a valid initial state.
        if (store.get('pinnedBgId') === id) await store.set({ pinnedBgId: null });
        if (store.get('lastBgId') === id) await store.set({ lastBgId: null });
        return null;
      }
    }
    return byId(id) ?? null;
  }

  function paintBar(): void {
    renderBackgroundBar(barEl, {
      pinned: store.get('pinnedBgId') === current?.id,
      onShuffle: shuffle,
      onTogglePin: togglePin,
    });
  }

  // Try the chosen wallpaper; if it fails to load, walk to the next bundled one
  // so a single blocked/slow image never leaves the page on the bare gradient.
  async function apply(background: Wp | Background | null): Promise<void> {
    let candidate: Wp | Background | null = background;
    for (let tries = 0; candidate && tries < backgrounds.length + 1; tries++) {
      try {
        await preload(candidate.url);
        current = candidate;
        layerEl.style.backgroundImage = `url("${candidate.url}")`;
        layerEl.classList.add('is-loaded');
        renderCredit(creditEl, candidate);
        paintBar();
        await store.set({ lastBgId: candidate.id });
        return;
      } catch {
        candidate = pickNextBundled(candidate.id); // skip to a visible bundled one
      }
    }
  }

  async function shuffle(): Promise<void> {
    const next = pickNext(current?.id);
    if (next) await apply(next);
    notify();
  }

  async function togglePin(): Promise<void> {
    const pinned = store.get('pinnedBgId') === current?.id;
    await store.set({ pinnedBgId: pinned ? null : (current?.id ?? null) });
    paintBar();
    notify();
  }

  async function loadCustom(): Promise<Wp[]> {
    try {
      const { wallpapers } = (await getApi('wallpapers')) as {
        wallpapers?: { id: string; name: string }[];
      };
      customList = await Promise.all(
        (wallpapers || []).map(async (w) => ({
          id: CUSTOM + w.id,
          author: w.name,
          url: await customUrl(w.id),
          custom: true,
        })),
      );
    } catch {
      customList = [];
    }
    return customList;
  }

  async function init(): Promise<void> {
    // Load custom wallpapers up front so a custom pinned id resolves. A pinned
    // wallpaper (the user's own choice / upload) always wins; otherwise the
    // background follows the active theme's bundled default.
    await loadCustom();
    const start = (await resolve(store.get('pinnedBgId'))) || defaultFor(resolvedTheme()) || pickRandom(null);
    if (start) await apply(start);
  }

  // Called when the theme changes (Settings toggle, or the OS in System mode):
  // if the user hasn't pinned their own wallpaper, follow the new theme's default.
  async function onThemeChange(): Promise<void> {
    if (store.get('pinnedBgId')) return;
    const def = defaultFor(resolvedTheme());
    if (def && def.id !== current?.id) await apply(def);
  }

  // Wallpaper management surface used by the Settings gallery.
  const wallpaper = {
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentId: (): string | null => current?.id || null,
    pinnedId: (): string | null => store.get('pinnedBgId') || null,
    async list(): Promise<Wp[]> {
      await loadCustom();
      const bundled: Wp[] = visibleBundled().map((b) => ({
        id: b.id,
        author: b.author,
        url: b.url,
        custom: false,
      }));
      return [...customList, ...bundled];
    },
    // How many bundled defaults are currently hidden (Settings shows "Restore").
    hiddenCount: (): number => hiddenIds().length,
    async restoreDefaults(): Promise<void> {
      await store.set({ hiddenBgIds: [] });
      if (!current) {
        const next = pickRandom(null);
        if (next) await apply(next);
      }
      notify();
    },
    async setCurrent(id: string): Promise<void> {
      await apply(await resolve(id));
      notify();
    },
    async setPinned(id: string | null): Promise<void> {
      await store.set({ pinnedBgId: id });
      if (id) await apply(await resolve(id)); // favoriting also makes it the wallpaper
      paintBar();
      notify();
    },
    async upload(file: File): Promise<string> {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const w = (await callApi('wallpapers', fd)) as { id: string; name: string }; // { id, name }
      await loadCustom();
      return CUSTOM + w.id;
    },
    async remove(id: string): Promise<void> {
      if (id.startsWith(CUSTOM)) {
        try {
          await jsonApi('DELETE', `wallpapers/${id.slice(CUSTOM.length)}`);
        } catch {
          /* ignore */
        }
        await loadCustom();
      } else {
        // Bundled default: hide it (restorable). The file stays in the build.
        const h = hiddenIds();
        if (!h.includes(id)) await store.set({ hiddenBgIds: [...h, id] });
      }
      if (store.get('pinnedBgId') === id) await store.set({ pinnedBgId: null });
      if (current?.id === id) {
        const next = pickRandom(null);
        if (next) await apply(next);
        else clearBackground();
      }
      notify();
    },
  };

  return { init, wallpaper, onThemeChange };
}
