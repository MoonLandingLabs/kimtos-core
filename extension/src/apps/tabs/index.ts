// Tabs — an on-device tab manager. Search/switch every open tab with a ⌘K-style
// fuzzy finder, see them grouped by window, hibernate idle ones to reclaim
// memory, and stash a set of tabs as a session to reopen later. Uses the browser
// tab APIs directly (chromeTabs.ts) behind a runtime permission the user grants
// on first use — nothing leaves the device.

import './tabs.css';
import { el, clear } from '../../lib/dom.js';
import { debounce } from '../../lib/timing.js';
import { showSnackbar } from '../../components/snackbar.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { TRASH } from '../../components/icons.js';
import { fuzzyScore } from '../../lib/fuzzy.js';
import { createPopover } from '../../components/popover.js';
import appMeta from './meta.js';
import {
  tabsAvailable,
  hasTabsPermission,
  requestTabsPermission,
  queryWindows,
  groupMap,
  currentWindowTabs,
  activate,
  closeTab,
  hibernate,
  openUrls,
  onTabsChanged,
  moveTab,
  moveToNewWindow,
  setPinned,
  addToGroup,
  ungroup,
  updateGroup,
  tabsInGroup,
  recentlyClosed,
  restoreClosed,
  GROUP_COLORS,
  type TabItem,
  type WindowGroup,
  type GroupInfo,
  type ClosedItem,
} from './chromeTabs.js';
import { listSessions, saveSession, deleteSession, type Session } from './sessions.js';

const ACCENT = appMeta.accent;

const icon = (path: string, w = 15): string =>
  `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" ` +
  `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const IC_SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', 16);
const IC_CLOSE = icon('<path d="M18 6 6 18M6 6l12 12"/>');
const IC_MOON = icon('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
const IC_SAVE = icon(
  '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
);
const IC_OPEN = icon('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 14);
const IC_MORE = icon(
  '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  16,
);
const IC_PIN = icon('<path d="M9 4h6l-1 6 3 3v1h-4v5l-1 1-1-1v-5H6v-1l3-3z"/>', 14);
const IC_PLUS = icon('<path d="M12 5v14M5 12h14"/>', 14);
const IC_RESTORE = icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"/>', 14);

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, '') + (u.search ? '?…' : '');
  } catch {
    return url;
  }
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Search, switch, hibernate, and save your open tabs — all on-device',
  tip: 'Press ⌘K (Ctrl-K) on the new tab to jump straight here, then type to fuzzy-search every open tab (↑↓ then Enter to jump). Hibernate idle tabs to free memory, or “Save window” to stash a set of tabs and reopen them later. Your tabs never leave this device.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tools. Read + drive tabs; they can't grant the permission
  // (that needs a click), so they ask the user to open the app if it's missing.
  tools: [
    {
      name: 'list_tabs',
      description: 'List all open browser tabs (id, title, url, window, hibernated?).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const guard = await toolGuard();
        if (guard) return guard;
        const wins = await queryWindows();
        const lines = wins
          .flatMap((w, i) =>
            w.tabs.map((t) => `${t.id} · [w${i + 1}]${t.discarded ? ' [asleep]' : ''} ${t.title} — ${t.url}`),
          )
          .join('\n');
        const n = wins.reduce((s, w) => s + w.tabs.length, 0);
        return { ok: true, result: `${n} tab(s):\n${lines || '(none)'}`, summary: `${n} tab(s)` };
      },
    },
    {
      name: 'switch_tab',
      description: 'Focus an open tab by its id (from list_tabs).',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      run: async (args: { id?: number }) => {
        const guard = await toolGuard();
        if (guard) return guard;
        const tab = (await queryWindows()).flatMap((w) => w.tabs).find((t) => t.id === Number(args.id));
        if (!tab) return { ok: false, result: `No tab ${args.id}.`, summary: 'not found' };
        await activate(tab.id, tab.windowId);
        return { ok: true, result: `Switched to "${tab.title}".`, summary: `switched` };
      },
    },
    {
      name: 'close_tab',
      description: 'Close an open tab by its id (from list_tabs).',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      run: async (args: { id?: number }) => {
        const guard = await toolGuard();
        if (guard) return guard;
        try {
          await closeTab(Number(args.id));
          return { ok: true, result: `Closed tab ${args.id}.`, summary: 'closed' };
        } catch {
          return { ok: false, result: `Couldn't close tab ${args.id}.`, summary: 'failed' };
        }
      },
    },
    {
      name: 'hibernate_tab',
      description: 'Hibernate (discard) a tab by id to free memory; it reloads when next focused.',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      run: async (args: { id?: number }) => {
        const guard = await toolGuard();
        if (guard) return guard;
        try {
          await hibernate(Number(args.id));
          return { ok: true, result: `Hibernated tab ${args.id}.`, summary: 'hibernated' };
        } catch {
          return { ok: false, result: `Couldn't hibernate tab ${args.id}.`, summary: 'failed' };
        }
      },
    },
    {
      name: 'save_session',
      description: "Save the current window's tabs as a named session to reopen later.",
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [] },
      run: async (args: { name?: string }) => {
        const guard = await toolGuard();
        if (guard) return guard;
        const tabs = (await currentWindowTabs()).filter((t) => /^https?:/.test(t.url));
        if (!tabs.length) return { ok: false, result: 'No saveable tabs in this window.', summary: 'nothing to save' };
        const s = await saveSession(String(args.name || defaultSessionName(tabs.length)), tabs.map(toSavedTab));
        return { ok: true, result: `Saved "${s.name}" (${tabs.length} tabs).`, summary: `saved ${tabs.length}` };
      },
    },
    {
      name: 'list_sessions',
      description: 'List saved tab sessions with their ids and tab counts.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const sessions = await listSessions();
        const lines = sessions.map((s) => `${s.id} · ${s.name} (${s.tabs.length} tabs)`).join('\n');
        return { ok: true, result: lines || '(no saved sessions)', summary: `${sessions.length} session(s)` };
      },
    },
    {
      name: 'open_session',
      description: 'Reopen a saved session (all its tabs in a new window), by id from list_sessions.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: { id?: string }) => {
        const guard = await toolGuard();
        if (guard) return guard;
        const s = (await listSessions()).find((x) => x.id === String(args.id));
        if (!s) return { ok: false, result: `No session ${args.id}.`, summary: 'not found' };
        await openUrls(s.tabs.map((t) => t.url));
        return { ok: true, result: `Reopened "${s.name}" (${s.tabs.length} tabs).`, summary: 'reopened' };
      },
    },
    {
      name: 'delete_session',
      description: 'Delete a saved session by id (from list_sessions).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: { id?: string }) => {
        const s = (await listSessions()).find((x) => x.id === String(args.id));
        if (!s) return { ok: false, result: `No session ${args.id}.`, summary: 'not found' };
        await deleteSession(s.id);
        return { ok: true, result: `Deleted "${s.name}".`, summary: 'deleted' };
      },
    },
  ],

  render(body: HTMLElement) {
    const root = el('div', 'tabs');
    body.replaceChildren(root);

    if (!tabsAvailable()) {
      root.append(
        infoPane(
          'Tabs needs the installed extension',
          'This app manages your browser tabs, so it only works when KimtOS runs as a Chrome extension — not in the dev preview.',
        ),
      );
      return () => {};
    }

    // ---- state ----
    let windows: WindowGroup[] = [];
    let groups = new Map<number, GroupInfo>();
    let sessions: Session[] = [];
    let query = '';
    let highlight = 0;
    let results: TabItem[] = [];
    let closed: ClosedItem[] = [];
    let dragId: number | null = null;
    let teardown: (() => void) | null = null;

    let searchEl: HTMLInputElement | null = null;
    let countEl: HTMLElement | null = null;
    let listHost: HTMLElement | null = null;

    const menu = createPopover({ host: root, className: 'tabs-menu' });

    const entryOf = (t: TabItem) => ({ id: String(t.id), title: t.title, url: t.url });

    const loadTabs = async () => {
      [windows, groups] = await Promise.all([queryWindows(), groupMap()]);
    };
    const loadSessions = async () => {
      sessions = await listSessions();
    };
    const loadClosed = async () => {
      closed = await recentlyClosed();
    };
    const refresh = async () => {
      await Promise.all([loadTabs(), loadClosed()]);
      renderList();
    };

    // Both lists render from in-memory snapshots (`windows` / `sessions`), so the moment a
    // delete COMMITS they are stale and the pending ids are gone — repainting the snapshot
    // would resurrect the deleted rows (#940). `refresh` re-reads truth on exactly that
    // transition; every selection toggle keeps the cheap synchronous repaint, so the search
    // box in the persistent bar is never rebuilt mid-type (#217).
    const bulkTabs = createBulkSelect({
      noun: 'tab',
      remove: (e) => closeTab(Number(e.id)),
      onChange: () => renderList(),
      refresh: () => refresh(),
    });
    const bulkSessions = createBulkSelect({
      noun: 'session',
      remove: (e) => deleteSession(String(e.id)),
      onChange: () => renderList(),
      refresh: () => reloadSessions(),
    });

    // ---- permission gate, then boot ----
    void hasTabsPermission().then((granted) => {
      if (granted) return boot();
      root.replaceChildren(
        permissionGate(async () => {
          if (await requestTabsPermission()) boot();
          else showSnackbar('Tab access wasn’t granted — nothing changed.');
        }),
      );
    });

    function boot() {
      teardown = onTabsChanged(() => void refresh());
      buildShell();
      void Promise.all([loadTabs(), loadSessions(), loadClosed()]).then(renderList);
    }

    // ---- persistent shell (search input survives re-renders so typing is smooth) ----
    function buildShell() {
      clear(root);
      const bar = el('div', 'tabs-bar');

      const searchWrap = el('div', 'tabs-searchwrap');
      searchWrap.innerHTML = IC_SEARCH;
      const search = el('input', 'tabs-search') as HTMLInputElement;
      search.type = 'search';
      search.placeholder = 'Search tabs…  (↑ ↓ then Enter to jump)';
      search.spellcheck = false;
      search.autocomplete = 'off';
      // Debounced: renderList() rebuilds the whole list + fuzzy-scores every tab,
      // so run it once the user pauses rather than on every keystroke.
      const onSearchInput = debounce(() => {
        query = search.value.trim();
        highlight = 0;
        renderList();
      }, 120);
      search.addEventListener('input', onSearchInput);
      search.addEventListener('keydown', onSearchKey);
      searchWrap.append(search);
      searchEl = search;

      countEl = el('span', 'tabs-count');
      const save = el('button', 'tabs-btn');
      save.type = 'button';
      save.innerHTML = `${IC_SAVE}<span>Save window</span>`;
      save.title = 'Save this window’s tabs as a session';
      save.addEventListener('click', () => void onSaveWindow());

      bar.append(searchWrap, countEl, save);
      listHost = el('div', 'tabs-listhost');
      root.append(bar, listHost);
      requestAnimationFrame(() => search.focus());
    }

    function onSearchKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        highlight = Math.min(highlight + 1, Math.max(0, results.length - 1));
        renderList();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        highlight = Math.max(0, highlight - 1);
        renderList();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const t = results[highlight];
        if (t) void activate(t.id, t.windowId);
        e.preventDefault();
      } else if (e.key === 'Escape' && query) {
        query = '';
        if (searchEl) searchEl.value = '';
        renderList();
        e.preventDefault();
      }
    }

    // ---- the dynamic list ----
    function renderList() {
      const host = listHost;
      if (!host) return;
      const all = windows.flatMap((w) => w.tabs);
      if (countEl) countEl.textContent = `${all.length} tab${all.length === 1 ? '' : 's'}`;
      clear(host);
      host.append(query ? searchResults(all) : overview());
      if (!query && closed.length) host.append(closedSection());
      host.append(sessionsSection());
    }

    function searchResults(all: TabItem[]): HTMLElement {
      const sec = el('div', 'tabs-section');
      results = all
        .map((t) => ({ t, s: fuzzyScore(query, `${t.title} ${prettyUrl(t.url)}`) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((r) => r.t);
      if (highlight >= results.length) highlight = Math.max(0, results.length - 1);
      if (!results.length) {
        sec.append(el('div', 'tabs-empty', `No tabs match “${query}”.`));
        return sec;
      }
      const list = el('div', 'tabs-rows');
      results.forEach((t, i) => list.append(tabRow(t, { highlight: i === highlight })));
      sec.append(list);
      return sec;
    }

    function overview(): HTMLElement {
      const sec = el('div', 'tabs-section');
      const all = windows.flatMap((w) => w.tabs);
      const head = el('div', 'tabs-sec-head');
      head.append(el('h3', 'tabs-sec-title', windows.length > 1 ? `${windows.length} windows` : 'Open tabs'));
      const right = el('div', 'tabs-sec-actions');
      if (bulkTabs.isSelecting()) {
        const checked = all.filter((t) => bulkTabs.isChecked(String(t.id))).map((t) => t.id);
        if (checked.length) {
          const gbtn = el('button', 'tabs-btn tabs-btn-sm');
          gbtn.type = 'button';
          gbtn.innerHTML = `${IC_PLUS}<span>Group ${checked.length}</span>`;
          gbtn.addEventListener('click', async () => {
            await addToGroup(checked);
            await refresh();
          });
          right.append(gbtn);
        }
      }
      right.append(bulkTabs.controls(bulkTabs.filterVisible(all.map(entryOf))));
      head.append(right);
      sec.append(head);

      const pendingHidden = new Set(all.filter((t) => bulkTabs.isPending(String(t.id))).map((t) => t.id));
      const ordered = [...windows].sort((a, b) => Number(b.focused) - Number(a.focused));
      ordered.forEach((w, wi) => {
        const tabs = w.tabs.filter((t) => !pendingHidden.has(t.id));
        if (!tabs.length) return;
        if (ordered.length > 1) {
          const wh = el('div', 'tabs-win-head', w.focused ? 'This window' : `Window ${wi + 1}`);
          wh.append(el('span', 'tabs-win-count', ` · ${tabs.length}`));
          attachWindowDrop(wh, w.windowId);
          sec.append(wh);
        }
        const list = el('div', 'tabs-rows');
        list.dataset.bulkList = '';
        let lastGroup = -1;
        for (const t of tabs) {
          if (t.groupId !== -1 && t.groupId !== lastGroup) {
            const g = groups.get(t.groupId);
            const chip = el('button', 'tabs-group');
            (chip as HTMLButtonElement).type = 'button';
            chip.append(colorDot(g?.color));
            chip.append(el('span', 'tabs-group-name', g?.title || 'Group'));
            chip.title = 'Rename, recolor, or ungroup';
            const gid = t.groupId;
            chip.addEventListener('click', () => openGroupMenu(chip, gid));
            list.append(chip);
          }
          lastGroup = t.groupId;
          list.append(tabRow(t, {}));
        }
        sec.append(list);
      });
      return sec;
    }

    function tabRow(t: TabItem, opts: { highlight?: boolean }): HTMLElement {
      const selecting = bulkTabs.isSelecting();
      const row = el(
        'div',
        `tabs-row${t.active ? ' is-active' : ''}${t.discarded ? ' is-asleep' : ''}${opts.highlight ? ' is-highlight' : ''}`,
      );
      if (selecting)
        row.append(checkbox(bulkTabs.isChecked(String(t.id)), (on) => bulkTabs.setChecked(String(t.id), on)));
      if (t.pinned) row.append(el('span', 'tabs-badge tabs-pinned', 'Pinned'));
      row.append(favicon(t));
      const meta = el('div', 'tabs-meta');
      meta.append(el('div', 'tabs-title', t.title));
      meta.append(el('div', 'tabs-url', prettyUrl(t.url)));
      row.append(meta);
      if (t.audible) row.append(el('span', 'tabs-badge', '♪'));
      if (t.discarded) row.append(el('span', 'tabs-badge tabs-asleep', 'Asleep'));
      if (!selecting) {
        const acts = el('div', 'tabs-actions');
        if (!t.discarded)
          acts.append(iconBtn(IC_MOON, 'Hibernate to free memory', () => void hibernate(t.id).then(refresh)));
        acts.append(iconBtn(IC_CLOSE, 'Close tab', () => void closeTab(t.id).then(refresh)));
        const more = el('button', 'tabs-icon-btn');
        more.type = 'button';
        more.title = 'More actions';
        more.innerHTML = IC_MORE;
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          openTabMenu(more, t);
        });
        acts.append(more);
        row.append(acts);
        attachDrag(row, t);
      }
      row.addEventListener('click', () => {
        if (selecting) {
          bulkTabs.setChecked(String(t.id), !bulkTabs.isChecked(String(t.id)));
          renderList();
        } else void activate(t.id, t.windowId);
      });
      if (selecting) bulkTabs.bindRow(row, t.id);
      return row;
    }

    // ---- per-tab actions menu ----
    function openTabMenu(anchor: HTMLElement, t: TabItem) {
      menu.toggle(anchor, (panel) => {
        panel.append(
          menuItem(t.pinned ? 'Unpin tab' : 'Pin tab', IC_PIN, () => {
            menu.close();
            void setPinned(t.id, !t.pinned).then(refresh);
          }),
        );
        panel.append(menuDivider(), menuLabel('Move to'));
        panel.append(
          menuItem('New window', IC_PLUS, () => {
            menu.close();
            void moveToNewWindow(t.id).then(refresh);
          }),
        );
        [...windows]
          .sort((a, b) => Number(b.focused) - Number(a.focused))
          .forEach((w, wi) => {
            if (w.windowId === t.windowId) return;
            panel.append(
              menuItem(w.focused ? 'This window' : `Window ${wi + 1}`, '', () => {
                menu.close();
                void doMove(t.id, w.windowId, -1);
              }),
            );
          });
        panel.append(menuDivider(), menuLabel('Group'));
        panel.append(
          menuItem('New group', IC_PLUS, async () => {
            menu.close();
            await addToGroup([t.id]);
            await refresh();
          }),
        );
        for (const [gid, g] of groups) {
          if (gid === t.groupId) continue;
          const item = menuItem(g.title || 'Group', '', async () => {
            menu.close();
            await addToGroup([t.id], gid);
            await refresh();
          });
          item.prepend(colorDot(g.color));
          panel.append(item);
        }
        if (t.groupId !== -1)
          panel.append(
            menuItem('Remove from group', IC_CLOSE, async () => {
              menu.close();
              await ungroup([t.id]);
              await refresh();
            }),
          );
        panel.append(menuDivider());
        panel.append(
          menuItem('Close tab', IC_CLOSE, () => {
            menu.close();
            void closeTab(t.id).then(refresh);
          }),
        );
      });
    }

    // ---- group editor menu ----
    function openGroupMenu(anchor: HTMLElement, groupId: number) {
      menu.toggle(anchor, (panel) => {
        const g = groups.get(groupId);
        panel.append(menuLabel('Rename group'));
        const input = el('input', 'tabs-menu-input') as HTMLInputElement;
        input.value = g?.title || '';
        input.placeholder = 'Group name';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', () => void updateGroup(groupId, { title: input.value }).then(refresh));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            menu.close();
            void updateGroup(groupId, { title: input.value }).then(refresh);
          }
        });
        panel.append(input, menuLabel('Color'));
        const swatches = el('div', 'tabs-swatches');
        for (const c of GROUP_COLORS) {
          const sw = el('button', `tabs-swatch${g?.color === c ? ' is-on' : ''}`);
          (sw as HTMLButtonElement).type = 'button';
          sw.style.background = groupHex(c);
          sw.title = c;
          sw.addEventListener('click', () => {
            menu.close();
            void updateGroup(groupId, { color: c }).then(refresh);
          });
          swatches.append(sw);
        }
        panel.append(swatches, menuDivider());
        panel.append(
          menuItem('Ungroup all tabs', IC_CLOSE, async () => {
            menu.close();
            await ungroup(await tabsInGroup(groupId));
            await refresh();
          }),
        );
        requestAnimationFrame(() => input.focus());
      });
    }

    // ---- drag to reorder / move across windows ----
    async function doMove(id: number, windowId: number, index: number) {
      try {
        await moveTab(id, windowId, index);
      } catch {
        /* pinned/edge constraints — Chrome clamps; just re-scan */
      }
      await refresh();
    }
    function attachDrag(row: HTMLElement, t: TabItem) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragId = t.id;
        row.classList.add('is-dragging');
        e.dataTransfer?.setData('text/plain', String(t.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        dragId = null;
        row.classList.remove('is-dragging');
        listHost?.querySelectorAll('.is-drop-before').forEach((n) => n.classList.remove('is-drop-before'));
      });
      row.addEventListener('dragover', (e) => {
        if (dragId == null || dragId === t.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.classList.add('is-drop-before');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-before'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-drop-before');
        if (dragId != null && dragId !== t.id) void doMove(dragId, t.windowId, t.index);
      });
    }
    function attachWindowDrop(head: HTMLElement, windowId: number) {
      head.addEventListener('dragover', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        head.classList.add('is-drop-into');
      });
      head.addEventListener('dragleave', () => head.classList.remove('is-drop-into'));
      head.addEventListener('drop', (e) => {
        e.preventDefault();
        head.classList.remove('is-drop-into');
        if (dragId != null) void doMove(dragId, windowId, -1);
      });
    }

    // ---- recently closed ----
    function closedSection(): HTMLElement {
      const sec = el('div', 'tabs-section tabs-closed');
      sec.append(el('h3', 'tabs-sec-title', 'Recently closed'));
      const list = el('div', 'tabs-rows');
      for (const c of closed.slice(0, 8)) {
        const row = el('div', 'tabs-row');
        if (c.kind === 'window') {
          const badge = el('span', 'tabs-session-icon');
          badge.textContent = String(c.count);
          row.append(badge);
        } else {
          row.append(favicon({ favIconUrl: c.favIconUrl, url: c.url, title: c.title }));
        }
        const meta = el('div', 'tabs-meta');
        meta.append(el('div', 'tabs-title', c.kind === 'window' ? `Closed window · ${c.title}` : c.title));
        meta.append(el('div', 'tabs-url', c.kind === 'window' ? 'reopen all its tabs' : prettyUrl(c.url)));
        row.append(meta);
        const acts = el('div', 'tabs-actions');
        acts.append(iconBtn(IC_RESTORE, 'Reopen', () => void restoreClosed(c.sessionId).then(refresh)));
        row.append(acts);
        row.addEventListener('click', () => void restoreClosed(c.sessionId).then(refresh));
        list.append(row);
      }
      sec.append(list);
      return sec;
    }

    // ---- sessions ----
    function sessionsSection(): HTMLElement {
      const sec = el('div', 'tabs-section tabs-sessions');
      const head = el('div', 'tabs-sec-head');
      head.append(el('h3', 'tabs-sec-title', 'Saved sessions'));
      const entries = sessions.map((s) => ({ id: s.id }));
      head.append(bulkSessions.controls(bulkSessions.filterVisible(entries)));
      sec.append(head);

      const visible = sessions.filter((s) => !bulkSessions.isPending(s.id));
      if (!visible.length) {
        sec.append(
          el('div', 'tabs-empty', 'No saved sessions yet — “Save window” stashes your current tabs to reopen later.'),
        );
        return sec;
      }
      const list = el('div', 'tabs-rows');
      list.dataset.bulkList = '';
      for (const s of visible) list.append(sessionRow(s));
      sec.append(list);
      return sec;
    }

    function sessionRow(s: Session): HTMLElement {
      const selecting = bulkSessions.isSelecting();
      const row = el('div', 'tabs-row tabs-session');
      if (selecting) row.append(checkbox(bulkSessions.isChecked(s.id), (on) => bulkSessions.setChecked(s.id, on)));
      row.append(el('span', 'tabs-session-icon', String(s.tabs.length)));
      const meta = el('div', 'tabs-meta');
      meta.append(el('div', 'tabs-title', s.name));
      meta.append(
        el('div', 'tabs-url', `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'} · ${whenLabel(s.createdAt)}`),
      );
      row.append(meta);
      if (!selecting) {
        const acts = el('div', 'tabs-actions');
        acts.append(iconBtn(IC_OPEN, 'Reopen these tabs', () => void openUrls(s.tabs.map((t) => t.url))));
        // Shared confirm + undo toast, identical to the batch delete (#724).
        acts.append(
          iconBtn(
            TRASH,
            'Delete session',
            () =>
              void bulkSessions.deleteOne(
                { id: s.id },
                { confirmMessage: `Delete the saved session “${s.name}”?`, undoMessage: `“${s.name}” deleted` },
              ),
          ),
        );
        row.append(acts);
      }
      row.addEventListener('click', () => {
        if (selecting) {
          bulkSessions.setChecked(s.id, !bulkSessions.isChecked(s.id));
          renderList();
        } else void openUrls(s.tabs.map((t) => t.url));
      });
      bulkSessions.bindRow(row, s.id);
      return row;
    }

    async function reloadSessions() {
      await loadSessions();
      renderList();
    }

    async function onSaveWindow() {
      const tabs = (await currentWindowTabs()).filter((t) => /^https?:/.test(t.url));
      if (!tabs.length) {
        showSnackbar('No saveable tabs in this window.');
        return;
      }
      await saveSession(defaultSessionName(tabs.length), tabs.map(toSavedTab));
      await loadSessions();
      renderList();
      showSnackbar(`Saved ${tabs.length} tab${tabs.length === 1 ? '' : 's'} as a session.`);
    }

    return () => {
      if (teardown) teardown();
    };
  },
};

// ---- shared little builders ----
function iconBtn(svg: string, title: string, onClick: () => void): HTMLElement {
  const b = el('button', 'tabs-icon-btn');
  b.type = 'button';
  b.title = title;
  b.innerHTML = svg;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function checkbox(checked: boolean, onToggle: (on: boolean) => void): HTMLElement {
  const cb = el('input', 'tabs-check') as HTMLInputElement;
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => onToggle(cb.checked));
  return cb;
}

function favicon(t: { favIconUrl?: string; url?: string; title?: string }): HTMLElement {
  // Only https/data favicons: the extension CSP blocks http: images (mixed
  // content), so an http favicon would just log a CSP error — use the monogram.
  const usable = !!t.favIconUrl && /^(https:|data:)/.test(t.favIconUrl);
  if (!usable) return monogramTile(t.url, t.title);
  const img = el('img', 'tabs-favicon') as HTMLImageElement;
  img.src = t.favIconUrl as string;
  img.loading = 'lazy';
  img.decoding = 'async';
  // Fall back to a monogram tile (the app-icon pattern) if the favicon fails.
  img.addEventListener('error', () => img.replaceWith(monogramTile(t.url, t.title)), { once: true });
  return img;
}

// A squircle gradient tile with the site's initial — the same monogram-fallback
// idea as the app icons, hued per-domain so each site keeps a stable color.
function monogramTile(url?: string, title?: string): HTMLElement {
  const host = hostOf(url).replace(/^www\./, '');
  const label = host || title || '';
  const letter = (label.match(/[a-z0-9]/i)?.[0] ?? '•').toUpperCase();
  const tile = el('span', 'tabs-favicon tabs-favicon-mono', letter);
  const hue = hashHue(host || title || letter);
  tile.style.background = `linear-gradient(150deg, hsl(${hue} 62% 60%), hsl(${(hue + 26) % 360} 58% 46%))`;
  return tile;
}
function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

const GROUP_HEX: Record<string, string> = {
  grey: '#9aa0a6',
  blue: '#8ab4f8',
  red: '#f28b82',
  yellow: '#fdd663',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70',
};
const groupHex = (color?: string): string => (color && GROUP_HEX[color]) || '#9aa0a6';

function colorDot(color?: string): HTMLElement {
  const dot = el('span', 'tabs-dot');
  dot.style.background = groupHex(color);
  return dot;
}

function menuItem(label: string, iconSvg: string, onClick: () => void): HTMLElement {
  const b = el('button', 'tabs-menu-item');
  b.type = 'button';
  if (iconSvg) b.insertAdjacentHTML('afterbegin', `<span class="tabs-menu-ic">${iconSvg}</span>`);
  b.append(el('span', 'tabs-menu-text', label));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
const menuDivider = (): HTMLElement => el('div', 'tabs-menu-divider');
const menuLabel = (text: string): HTMLElement => el('div', 'tabs-menu-label', text);

function infoPane(title: string, msg: string): HTMLElement {
  const box = el('div', 'tabs-info');
  box.append(el('div', 'tabs-info-title', title));
  box.append(el('p', 'tabs-info-msg', msg));
  return box;
}

function permissionGate(onGrant: () => void): HTMLElement {
  const box = el('div', 'tabs-info');
  box.append(el('div', 'tabs-info-title', 'Manage your tabs — privately'));
  const p = el('p', 'tabs-info-msg');
  p.innerHTML =
    'To search, switch, hibernate, and save your tabs, KimtOS needs permission to read them. ' +
    'This runs <b>entirely on your device</b> — your tabs are never uploaded.';
  box.append(p);
  const btn = el('button', 'tabs-btn tabs-grant');
  btn.type = 'button';
  btn.textContent = 'Grant access to my tabs';
  btn.addEventListener('click', onGrant);
  box.append(btn);
  return box;
}

// ---- pure helpers (module scope) ----
function toSavedTab(t: TabItem) {
  return { title: t.title, url: t.url, favIconUrl: t.favIconUrl };
}
function defaultSessionName(count: number): string {
  return `${count} tab${count === 1 ? '' : 's'} · ${whenLabel(Date.now())}`;
}
function whenLabel(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

async function toolGuard(): Promise<{ ok: false; result: string; summary: string } | null> {
  if (!tabsAvailable())
    return { ok: false, result: 'Tab control only works in the installed extension.', summary: 'unavailable' };
  if (!(await hasTabsPermission()))
    return {
      ok: false,
      result: 'Tab access not granted yet. Open the Tabs app and click “Grant access to my tabs” first.',
      summary: 'permission needed',
    };
  return null;
}

export default app;
