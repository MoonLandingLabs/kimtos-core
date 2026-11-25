// A Spotlight-style app launcher (#419). Ctrl+Space opens a search overlay over
// EVERY app — installed or not. Enter opens an installed app; a not-installed app
// shows an Install action, reusing the App
// Store's install button so install state and progress stay in sync.
//
// Follows the focused-input convention (#217): the search box is built ONCE and
// survives every keystroke — only the results region below it is repainted.

import { el } from '../lib/dom.js';
import { apps, type App } from '../apps/index.js';
import { appMeta } from '../apps/metaIndex.js';
import { isInstalled } from '../models/installed.js';
import { install, onInstalledChange, onProgress } from '../lib/installManager.js';
import { createInstallButton } from './installButton.js';
import { paintAppTile } from './appIcon.js';
import { monogram } from '../lib/format.js';
import { createDialog } from './dialog.js';
import { fuzzyBest } from '../lib/fuzzy.js';

export interface AppLauncher {
  open: () => void;
  toggle: () => void;
}

interface Row {
  el: HTMLElement;
  activate: () => void;
}

/** Build the launcher once (a singleton for the page). `openById` opens an
 *  installed app — the apps controller's opener, threaded in from appController. */
export function createAppLauncher(openById: (id: string) => void): AppLauncher {
  // The one dialog size ('lg'), like the other utility surfaces (Settings, App Store).
  // A Spotlight palette is a fixed centered surface — it must NOT maximize: the results
  // are capped at 52vh, so a maximized launcher is mostly empty (#498). The maximize
  // control stays visible but greyed, for consistent window chrome.
  const dialog = createDialog({
    title: 'Open an app',
    size: 'lg',
    appDialog: false,
    maximizable: false,
  });
  dialog.el.classList.add('launcher-dialog');

  const wrap = el('div', 'launcher');
  const search = el('input', 'launcher-search') as HTMLInputElement;
  // A real search field, not a text box: that is what ⌘K looks for when it decides which
  // box to focus (lib/windowSearch.ts), and the launcher is a `.dialog` — so as a text box
  // it would be the topmost window with nothing to focus, and ⌘K would open Tabs BEHIND
  // the open launcher (utility dialogs sit in a higher z band). The native clear button is
  // suppressed in components.css, so the palette looks exactly as it did.
  search.type = 'search';
  search.placeholder = 'Search apps…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const host = el('div', 'launcher-results');
  host.setAttribute('role', 'listbox');
  const empty = el('div', 'launcher-empty', 'No apps match.');
  wrap.append(search, host, empty);
  dialog.body.append(wrap);

  let rows: Row[] = [];
  let sel = 0;
  const updaters: Array<() => void> = []; // install-button update() fns, ticked by onProgress

  /** All apps for an empty query (already sorted by order then name), else the
   *  fuzzy matches ranked best-first — each field scored separately (#fuzzy). */
  function matches(q: string): App[] {
    const trimmed = q.trim();
    if (!trimmed) return apps;
    return apps
      .map((a) => ({ a, s: fuzzyBest(trimmed, [a.name, appMeta(a.id)?.marketing?.tech ?? '', a.description ?? '']) }))
      .filter((x) => x.s >= 0)
      .sort((p, n) => n.s - p.s)
      .map((x) => x.a);
  }

  function activate(app: App): void {
    if (isInstalled(app.id)) {
      openById(app.id);
      dialog.close();
    } else {
      install(app.id); // download in the background; the row flips to Open on onInstalledChange
    }
  }

  function subtitleOf(app: App): string {
    return appMeta(app.id)?.marketing?.tech ?? app.description ?? '';
  }

  function renderRow(app: App, index: number): Row {
    const row = el('div', 'launcher-row');
    row.setAttribute('role', 'option');

    const tile = el('span', 'launcher-tile');
    if (!paintAppTile(tile, { id: app.id, accent: app.accent })) tile.textContent = monogram(app.name);

    const text = el('div', 'launcher-text');
    text.append(el('span', 'launcher-name', app.name));
    const sub = subtitleOf(app);
    if (sub) text.append(el('span', 'launcher-sub', sub));

    const cta = el('span', 'launcher-cta');
    if (isInstalled(app.id)) {
      // Installed: the whole row opens it; a plain Open affordance makes that clickable too.
      const open = el('button', 'launcher-open button-secondary', 'Open') as HTMLButtonElement;
      open.type = 'button';
      open.addEventListener('click', (e) => {
        e.stopPropagation();
        activate(app);
      });
      cta.append(open);
    } else {
      // Not installed: the App Store's own button (Install / progress).
      const btn = createInstallButton(app);
      updaters.push(btn.update);
      cta.append(btn.el);
    }

    row.append(tile, text, cta);
    row.addEventListener('click', () => activate(app));
    row.addEventListener('mousemove', () => select(index, false));
    return { el: row, activate: () => activate(app) };
  }

  function highlight(scroll: boolean): void {
    rows.forEach((r, i) => r.el.classList.toggle('is-sel', i === sel));
    if (scroll) rows[sel]?.el.scrollIntoView({ block: 'nearest' });
  }

  function select(i: number, scroll: boolean): void {
    if (i < 0 || i >= rows.length || i === sel) return;
    sel = i;
    highlight(scroll);
  }

  function move(delta: number): void {
    if (!rows.length) return;
    sel = (sel + delta + rows.length) % rows.length;
    highlight(true);
  }

  // Repaint ONLY the results — never the container that holds the search box (#217).
  function paint(): void {
    const list = matches(search.value);
    updaters.length = 0;
    rows = list.map((a, i) => renderRow(a, i));
    host.replaceChildren(...rows.map((r) => r.el));
    empty.style.display = list.length ? 'none' : '';
    sel = 0;
    highlight(false);
  }

  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[sel]?.activate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dialog.close();
    }
  });

  // Live state: a download's progress ticks the install buttons; an install/uninstall
  // rebuilds the list.
  onProgress(() => updaters.forEach((u) => u()));
  onInstalledChange(paint);

  function open(): void {
    search.value = '';
    paint();
    dialog.open();
    requestAnimationFrame(() => search.focus());
  }

  return {
    open,
    toggle: () => (dialog.isVisible() ? dialog.close() : open()),
  };
}
