// macOS-style dock of apps. Each tile shows the app's icon (a squircle built from
// its accent) and label; hovering magnifies it. Clicking calls onPick(app).
//
// Layout: a cluster of PINNED apps on the left (default: Tabs; right-click any app
// to pin/unpin), a divider, then every other app. Both zones scroll horizontally when
// their apps don't fit, and neither can be squeezed below one tile — so no number of
// pins can put an app out of reach (#279). The pinned cluster gives up room last, so
// in practice it stays put.

import { paintAppTile } from '../components/appIcon.js';
import { monogram } from '../lib/format.js';
import { store } from '../models/store.js';
import { openContextMenu } from '../components/contextMenu.js';
import { setAccent } from '../lib/accent.js';

interface DockApp {
  id: string;
  name: string;
  description?: string;
  accent?: string;
  [key: string]: unknown;
}

// One-time mount hint: if a zone overflows, nudge it and settle back so the user learns
// there are more apps to scroll to. Gated by a setting + reduced-motion, plays once per
// page load. (See Settings → Preferences.)
let scrollHintPlayed = false;
function scrollHint(zones: HTMLElement[]): void {
  if (scrollHintPlayed) return;
  if (store.get('dockScrollHint') === false) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  window.setTimeout(() => {
    const scrollEl = zones.find((z) => z.scrollWidth - z.clientWidth > 8);
    if (!scrollEl) return; // everything fits — nothing to hint
    scrollHintPlayed = true;
    const peek = Math.min(scrollEl.scrollWidth - scrollEl.clientWidth, 104);
    scrollEl.scrollTo({ left: peek, behavior: 'smooth' });
    window.setTimeout(() => scrollEl.scrollTo({ left: 0, behavior: 'smooth' }), 720);
  }, 550);
}

// Fade the edge a zone can still be scrolled towards, so an overflowing zone doesn't
// look like it simply ends. Driven off the live scroll position, not a one-shot check.
function markOverflow(zone: HTMLElement): void {
  const max = zone.scrollWidth - zone.clientWidth;
  zone.classList.toggle('can-scroll-start', zone.scrollLeft > 2);
  zone.classList.toggle('can-scroll-end', zone.scrollLeft < max - 2);
}

export function renderAppDock<T extends DockApp>(dockEl: HTMLElement, apps: T[], onPick: (app: T) => void) {
  const badges = new Map<string, HTMLSpanElement>();
  const items = new Map<string, HTMLButtonElement>();
  const lastBadge = new Map<string, number>(); // survive re-renders (e.g. pin toggles)

  // Build one dock tile (icon + label + running dot), wired for click + right-click.
  function tile(app: T): HTMLButtonElement {
    const item = document.createElement('button');
    item.className = 'dock-app';
    if (app.accent) setAccent(item, app.accent);
    item.setAttribute('aria-label', app.name);
    if (app.description) item.title = app.description;
    items.set(app.id, item);

    const tileEl = document.createElement('span');
    tileEl.className = 'dock-tile';
    if (!paintAppTile(tileEl, app)) {
      tileEl.innerHTML = `<span class="dock-mono">${monogram(app.name)}</span>`;
    }
    const badge = document.createElement('span');
    badge.className = 'dock-badge';
    badge.hidden = true;
    tileEl.append(badge);
    badges.set(app.id, badge);

    const name = document.createElement('span');
    name.className = 'dock-name';
    name.textContent = app.name;

    const dot = document.createElement('span');
    dot.className = 'dock-dot';

    item.append(tileEl, name, dot);
    item.addEventListener('click', () => onPick(app));

    // Right-click → open the app, or pin/unpin it to the fixed left cluster.
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pinned = store.get('dockPinned') || [];
      const isPinned = pinned.includes(app.id);
      openContextMenu(e.clientX, e.clientY, [
        { label: `Open ${app.name}`, onClick: () => onPick(app) },
        { separator: true },
        {
          label: isPinned ? `Unpin ${app.name} from the dock` : `Pin ${app.name} to the left`,
          onClick: () => {
            const next = isPinned ? pinned.filter((id) => id !== app.id) : [...pinned, app.id];
            void store.set({ dockPinned: next });
            render();
          },
        },
      ]);
    });
    return item;
  }

  function zone(cls: string, list: T[]): HTMLDivElement {
    const z = document.createElement('div');
    z.className = `dock-zone ${cls}`;
    for (const app of list) z.append(tile(app));
    return z;
  }
  const sep = (): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 'dock-sep';
    return s;
  };

  // A render replaces the zones, so the observer is re-pointed at the new ones rather
  // than left watching detached nodes.
  const sizeWatch = new ResizeObserver((entries) => {
    for (const e of entries) markOverflow(e.target as HTMLElement);
  });

  function render(): void {
    badges.clear();
    items.clear();
    sizeWatch.disconnect();
    const pinnedIds = store.get('dockPinned') || [];
    const pinnedApps = pinnedIds.map((id) => apps.find((a) => a.id === id)).filter((a): a is T => !!a);
    const pinnedSet = new Set(pinnedApps.map((a) => a.id));
    const scrollApps = apps.filter((a) => !pinnedSet.has(a.id));

    const pinnedZone = zone('dock-pinned', pinnedApps);
    const scrollZone = zone('dock-scroll', scrollApps);
    const children: HTMLElement[] = [pinnedZone];
    if (pinnedApps.length) children.push(sep());
    children.push(scrollZone);
    dockEl.replaceChildren(...children);

    for (const z of [pinnedZone, scrollZone]) {
      z.addEventListener('scroll', () => markOverflow(z), { passive: true });
      sizeWatch.observe(z); // fires once on observe, and on every viewport resize
    }

    // Re-apply any known badge counts (re-render dropped the old badge elements).
    for (const [id, n] of lastBadge) applyBadge(id, n);
    scrollHint([scrollZone, pinnedZone]);
  }

  function applyBadge(appId: string, count: number): void {
    const badge = badges.get(appId);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  render();

  function setBadge(appId: string, count: number): void {
    lastBadge.set(appId, count);
    applyBadge(appId, count);
  }
  function setOpen(appId: string, isOpen: boolean): void {
    items.get(appId)?.classList.toggle('is-open', isOpen);
  }

  return { setBadge, setOpen };
}
