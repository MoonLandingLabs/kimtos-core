// Clipboard — on-device clipboard history. Capture runs in the background service
// worker (see src/background) + the content script (src/content/clipboardCapture);
// this is the browse/search/manage UI, the KimtAI agent tools, and the settings.
// All data ops go through clipboard.local.ts (getApi/jsonApi) so UI + tools stay
// in sync.
import './clipboard.css';
import { getApi, jsonApi } from '../../lib/api.js';
import { dataStore } from '../../lib/dataStore.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { confirmDialog } from '../../components/confirm.js';
import { promptDialog } from '../../components/promptDialog.js';
import { el, clear } from '../../lib/dom.js';
import { COPY, PENCIL, TRASH, TAG, PLUS, DOWNLOAD, UPLOAD, SLIDERS, iconButton } from '../../components/icons.js';
import {
  CLIP_COLLECTION,
  TAGS_KEY,
  getCaptureState,
  imageBlobKey,
  onClipsChanged,
  setCaptureState,
} from '../../lib/clipboardShared.js';
import type { CaptureState, ClipItem } from '../../lib/clipboardShared.js';
import { reclassifyClips } from '../../lib/clipboardStore.js';
import type { Tag } from '../../lib/clipboardStore.js';
import appMeta from './meta.js';

const ACCENT = appMeta.accent;

interface Stats {
  count: number;
  bytes: number;
  favorites: number;
  byType: Record<string, number>;
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchClip(id: string): Promise<ClipItem | undefined> {
  const { clips } = (await getApi('clips')) as { clips: ClipItem[] };
  return clips.find((c) => c.id === id);
}

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Your private, on-device clipboard history',
  tip: 'Everything you copy on any site is saved here, on your device. Click an item to copy it again; star the ones worth keeping. Password fields are never captured.',
  accent: ACCENT,
  order: appMeta.order,
  // "Floating Mode" — pop the window out into a small always-on-top PiP window.
  popout: true,

  // KimtAI agent tools — every one routes through clipboard.local.ts.
  tools: [
    {
      name: 'list_clips',
      description: 'List saved clipboard items, most-recent first. Returns each id.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { clips } = (await getApi('clips')) as { clips: ClipItem[] };
        const list = clips.map((c) => `${c.id} · ${c.favorite ? '★ ' : ''}${c.preview}`).join('\n') || '(empty)';
        return { ok: true, result: `Clipboard (${clips.length}):\n${list}`, summary: `${clips.length} clip(s)` };
      },
    },
    {
      name: 'search_clips',
      description: 'Search clipboard items by substring. Returns matching ids.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (args: Record<string, unknown>) => {
        const q = encodeURIComponent(String(args.query || ''));
        const { clips } = (await getApi(`clips?q=${q}`)) as { clips: ClipItem[] };
        const list = clips.map((c) => `${c.id} · ${c.preview}`).join('\n') || '(no matches)';
        return { ok: true, result: list, summary: `${clips.length} match(es)` };
      },
    },
    {
      name: 'get_clip',
      description: 'Get the full text of one clip by id (from list_clips/search_clips).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const clip = await fetchClip(String(args.id));
        if (!clip) return { ok: false, result: 'No clip with that id.', summary: 'not found' };
        return { ok: true, result: clip.text, summary: 'clip text' };
      },
    },
    {
      name: 'create_clip',
      description: 'Save a new text item to the clipboard history.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: async (args: Record<string, unknown>) => {
        const text = String(args.text || '').trim();
        if (!text) return { ok: false, result: 'Provide text to save.', summary: 'nothing to save' };
        const c = (await jsonApi('POST', 'clips', { text })) as ClipItem;
        return { ok: true, result: `Saved clip ${c.id}.`, summary: 'saved a clip' };
      },
    },
    {
      name: 'copy_clip',
      description: 'Copy a saved clip back onto the system clipboard (id from list_clips).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const clip = await fetchClip(String(args.id));
        if (!clip) return { ok: false, result: 'No clip with that id.', summary: 'not found' };
        try {
          await navigator.clipboard.writeText(clip.text);
          await jsonApi('PATCH', `clips/${clip.id}`, { lastUsedAt: Date.now(), useCount: (clip.useCount || 0) + 1 });
          return { ok: true, result: `Copied "${clip.preview}" to the clipboard.`, summary: 'copied clip' };
        } catch {
          return {
            ok: false,
            result: 'Could not access the clipboard (needs a focused window).',
            summary: 'copy failed',
          };
        }
      },
    },
    {
      name: 'set_clip_favorite',
      description: 'Mark a clip as favorite (protected from auto-cleanup) or unmark it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, favorite: { type: 'boolean' } },
        required: ['id', 'favorite'],
      },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('PATCH', `clips/${String(args.id)}`, { favorite: Boolean(args.favorite) });
        return {
          ok: true,
          result: `Clip ${args.favorite ? 'favorited' : 'unfavorited'}.`,
          summary: 'updated favorite',
        };
      },
    },
    {
      name: 'tag_clip',
      description: 'Add a colour tag to a clip (creates the tag if new).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, tag: { type: 'string' } },
        required: ['id', 'tag'],
      },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('POST', `clips/${String(args.id)}/tag`, { name: String(args.tag || '') });
        return { ok: true, result: `Tagged with "${args.tag}".`, summary: 'tagged a clip' };
      },
    },
    {
      name: 'merge_clips',
      description: 'Merge two or more clips (by id) into one new clip.',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' } } },
        required: ['ids'],
      },
      run: async (args: Record<string, unknown>) => {
        const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
        if (ids.length < 2) return { ok: false, result: 'Provide at least two clip ids.', summary: 'need 2+ ids' };
        const c = (await jsonApi('POST', 'clips/merge', { ids })) as ClipItem;
        return { ok: true, result: `Merged ${ids.length} clips into ${c.id}.`, summary: 'merged clips' };
      },
    },
    {
      name: 'delete_clip',
      description: 'Delete one clip by id (from list_clips).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `clips/${String(args.id)}`);
        return { ok: true, result: 'Clip deleted.', summary: 'deleted a clip' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall).
  dataLabel: 'clipboard history',
  hasData: () => dataStore.hasAny(CLIP_COLLECTION),
  async clearData() {
    await dataStore.clearCollection(CLIP_COLLECTION);
    await dataStore.clearBlobsByPrefix('clipboard:');
    await dataStore.kv.del(TAGS_KEY);
  },

  render(body: HTMLElement) {
    const root = el('div', 'clip-root');
    body.replaceChildren(root);

    const ui = { q: '', sort: 'recent' as 'recent' | 'alpha', filter: 'all' as string };
    let capture: CaptureState | null = null;
    let editingId: string | null = null;

    // How much of the history is built into the DOM. A page at a time (see renderList);
    // `shown` remembers how far the user has scrolled so a re-render — a new clip
    // arriving, a window focus — does not throw their place away.
    const PAGE = 60;
    let shown = PAGE;
    let more: IntersectionObserver | null = null;
    // A new query is a new list: start from the top again.
    const resetPaging = (): void => {
      shown = PAGE;
    };

    // --- toolbar ---
    const toolbar = el('div', 'clip-toolbar');
    const search = Object.assign(el('input', 'clip-search'), { type: 'search', placeholder: 'Search clipboard…' });
    // Debounced: a keystroke used to re-query the store and rebuild the list synchronously,
    // so typing raced its own renders. One render per pause, not one per character.
    let searchTimer = 0;
    search.addEventListener('input', () => {
      ui.q = search.value;
      resetPaging();
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderList(), 120);
    });
    const sortBtn = el('button', 'clip-btn');
    sortBtn.type = 'button';
    sortBtn.textContent = 'Recent';
    sortBtn.addEventListener('click', () => {
      ui.sort = ui.sort === 'recent' ? 'alpha' : 'recent';
      sortBtn.textContent = ui.sort === 'recent' ? 'Recent' : 'A–Z';
      resetPaging();
      void renderList();
    });
    const monitorBtn = el('button', 'clip-btn clip-monitor');
    monitorBtn.type = 'button';
    monitorBtn.addEventListener('click', async () => {
      const next = !(capture?.monitorEnabled ?? true);
      capture = await setCaptureState({ monitorEnabled: next });
      paintMonitor();
    });
    const gearBtn = iconButton(SLIDERS, { title: 'Settings', className: 'clip-btn' });
    gearBtn.addEventListener('click', () => settings.classList.toggle('open'));
    toolbar.append(search, sortBtn, monitorBtn, gearBtn);

    // --- settings drawer (capture controls live in chrome.storage, cross-context) ---
    const settings = el('div', 'clip-settings');
    const maxInput = Object.assign(el('input', 'clip-num'), { type: 'number', min: '10', max: '5000' });
    const exclInput = Object.assign(el('input', 'clip-excl'), {
      type: 'text',
      placeholder: 'Excluded sites (comma-separated hosts)',
    });
    const notifyCb = Object.assign(el('input', 'clip-check'), { type: 'checkbox' });
    const notifyRow = el('label', 'clip-set-check');
    notifyRow.append(notifyCb, el('span', '', 'Show a note on the page when I copy'));
    const imgCb = Object.assign(el('input', 'clip-check'), { type: 'checkbox' });
    const imgRow = el('label', 'clip-set-check');
    imgRow.append(imgCb, el('span', '', 'Also capture copied images'));

    const saveSettings = el('button', 'clip-btn', 'Save');
    saveSettings.type = 'button';
    saveSettings.addEventListener('click', async () => {
      const maxItems = Math.max(10, Math.min(5000, Number(maxInput.value) || 500));
      const excludedSites = exclInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      capture = await setCaptureState({
        maxItems,
        excludedSites,
        notify: notifyCb.checked,
        captureImages: imgCb.checked,
      });
      settings.classList.remove('open');
      void load();
    });
    settings.append(
      el('label', 'clip-set-label', 'Keep at most'),
      maxInput,
      el('label', 'clip-set-label', 'Never capture from'),
      exclInput,
      notifyRow,
      imgRow,
      saveSettings,
    );

    // --- add-manually box ---
    const addRow = el('div', 'clip-add');
    const addInput = Object.assign(el('input', 'clip-add-input'), { type: 'text', placeholder: 'Add an item…' });
    const addBtn = iconButton(PLUS, { title: 'Add', className: 'clip-btn' });
    const doAdd = async (): Promise<void> => {
      const text = addInput.value.trim();
      if (!text) return;
      await jsonApi('POST', 'clips', { text });
      addInput.value = '';
      void load();
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void doAdd();
    });
    addRow.append(addInput, addBtn);

    // --- filter chips ---
    const chips = el('div', 'clip-chips');

    // --- bulk select header + list ---
    const header = el('div', 'clip-header');
    const listEl = el('div', 'clip-list');
    listEl.dataset.bulkList = '';
    const footer = el('div', 'clip-foot');

    root.append(toolbar, settings, addRow, chips, header, listEl, footer);

    // `owner: root` on every overlay below — Clipboard can be popped out into a
    // floating window, and an overlay defaults to the new-tab page behind it (#85).
    const bulk = createBulkSelect({
      owner: root,
      noun: 'clip',
      remove: async (e) => {
        await jsonApi('DELETE', `clips/${e.id}`);
      },
      // The star already survives auto-cleanup and "Clear"; delete was the one path where it
      // meant nothing, so Select all silently took the favorites with it (#650). Declaring it
      // here gates the confirm behind an explicit acknowledgement instead.
      isProtected: (e) => Boolean(e.favorite),
      protectedNoun: 'favorite',
      // List AND footer: the footer is the item/size counter, so repainting only the
      // list would leave it claiming clips that are gone.
      onChange: () => void renderList().then(renderFooter),
    });

    function paintMonitor(): void {
      const on = capture?.monitorEnabled ?? true;
      monitorBtn.textContent = on ? '● Monitoring' : '○ Paused';
      monitorBtn.classList.toggle('is-off', !on);
    }

    async function load(): Promise<void> {
      capture = await getCaptureState();
      maxInput.value = String(capture.maxItems);
      exclInput.value = capture.excludedSites.join(', ');
      notifyCb.checked = capture.notify;
      imgCb.checked = capture.captureImages;
      paintMonitor();
      await renderChips();
      await renderList();
      await renderFooter();
    }

    function endpoint(): string {
      const p = new URLSearchParams();
      if (ui.q) p.set('q', ui.q);
      if (ui.sort === 'alpha') p.set('sort', 'alpha');
      if (ui.filter === 'fav') p.set('favorites', '1');
      else if (ui.filter.startsWith('tag:')) p.set('tag', ui.filter.slice(4));
      const qs = p.toString();
      return qs ? `clips?${qs}` : 'clips';
    }

    async function renderChips(): Promise<void> {
      const { tags } = (await getApi('clips/tags')) as { tags: Tag[] };
      clear(chips);
      const chip = (key: string, label: string, color?: string): HTMLElement => {
        const b = el('button', 'clip-chip', label);
        b.type = 'button';
        if (color) b.style.setProperty('--chip', color);
        b.classList.toggle('is-active', ui.filter === key);
        b.addEventListener('click', () => {
          ui.filter = ui.filter === key ? 'all' : key;
          resetPaging();
          void renderChips();
          void renderList();
        });
        return b;
      };
      chips.append(chip('all', 'All'), chip('fav', '★ Favorites'));
      for (const t of tags) chips.append(chip(`tag:${t.name}`, `#${t.name}`, t.color));
    }

    function clipRow(c: ClipItem): HTMLElement {
      const row = el('div', `clip-row clip-type-${c.type}`);
      bulk.bindRow(row, c.id);

      if (bulk.isSelecting()) {
        const cb = Object.assign(el('input', 'clip-check'), { type: 'checkbox' });
        cb.checked = bulk.isChecked(c.id);
        cb.addEventListener('change', () => {
          bulk.setChecked(c.id, cb.checked);
          void renderList();
        });
        row.append(cb);
        // Keep the star visible (as a marker, not a control) while selecting, so what is
        // about to be deleted is legible in the list and not only in the confirm (#650).
        if (c.favorite) {
          const mark = el('span', 'clip-star on is-mark', '★');
          mark.title = 'Favorite';
          row.append(mark);
        }
      } else {
        const star = el('button', 'clip-star', c.favorite ? '★' : '☆');
        star.type = 'button';
        star.title = c.favorite ? 'Unfavorite' : 'Favorite';
        star.classList.toggle('on', c.favorite);
        star.addEventListener('click', async (e) => {
          e.stopPropagation();
          await jsonApi('PATCH', `clips/${c.id}`, { favorite: !c.favorite });
          void load();
        });
        row.append(star);
      }

      const main = el('div', 'clip-main');
      if (editingId === c.id) {
        const ta = Object.assign(el('textarea', 'clip-edit'), { value: c.text });
        const save = el('button', 'clip-btn', 'Save');
        save.type = 'button';
        save.addEventListener('click', async () => {
          await jsonApi('PATCH', `clips/${c.id}`, { text: ta.value });
          editingId = null;
          void load();
        });
        const cancel = el('button', 'clip-btn ghost', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
          editingId = null;
          void renderList();
        });
        const editActions = el('div', 'clip-edit-actions');
        editActions.append(save, cancel);
        main.append(ta, editActions);
      } else {
        if (c.type === 'image') {
          const thumb = el('img', 'clip-thumb');
          thumb.alt = 'Image clip';
          thumb.title = 'Click to copy image';
          thumb.addEventListener('click', () => void copyClip(c));
          void dataStore.blobUrl(imageBlobKey(c.id)).then((u) => {
            if (u) thumb.src = u;
          });
          main.append(thumb);
        } else {
          const text = el('div', 'clip-text', c.preview);
          text.title = 'Click to copy';
          text.addEventListener('click', () => void copyClip(c));
          main.append(text);
        }
        const meta = el('div', 'clip-meta');
        meta.append(el('span', 'clip-time', relTime(c.lastUsedAt)));
        if (c.source?.title || c.source?.url) {
          meta.append(el('span', 'clip-src', c.source.title || c.source.url));
        }
        for (const t of c.tags) {
          const chip = el('button', 'clip-tag', `#${t} ×`);
          chip.type = 'button';
          chip.title = `Remove tag “${t}”`;
          chip.addEventListener('click', async (e) => {
            e.stopPropagation();
            await jsonApi('POST', `clips/${c.id}/untag`, { name: t });
            void load();
          });
          meta.append(chip);
        }
        main.append(meta);
      }
      row.append(main);

      if (!bulk.isSelecting() && editingId !== c.id) {
        const actions = el('div', 'clip-actions');
        const copyB = iconButton(COPY, { title: 'Copy', className: 'clip-act', onClick: () => void copyClip(c) });
        const editB = iconButton(PENCIL, {
          title: 'Edit',
          className: 'clip-act',
          onClick: () => {
            editingId = c.id;
            void renderList();
          },
        });
        const tagB = iconButton(TAG, { title: 'Add tag', className: 'clip-act', onClick: () => void addTag(c) });
        const delB = iconButton(TRASH, {
          title: 'Delete',
          // Shared confirm + undo toast, identical to the batch delete (#724). This used
          // to delete on the first click, with no confirm and nothing to undo.
          className: 'clip-act',
          onClick: () => void bulk.deleteOne(c as unknown as { id: string }),
        });
        actions.append(copyB, editB, tagB, delB);
        row.append(actions);
      }
      return row;
    }

    async function addTag(c: ClipItem): Promise<void> {
      const name = await promptDialog({
        owner: root,
        title: 'Add a tag',
        label: 'Tag this clip for quick filtering.',
        placeholder: 'Tag name',
        confirmLabel: 'Add tag',
      });
      if (!name) return;
      await jsonApi('POST', `clips/${c.id}/tag`, { name });
      void load();
    }

    async function copyClip(c: ClipItem): Promise<void> {
      try {
        if (c.type === 'image') {
          const blob = await dataStore.getBlob(imageBlobKey(c.id));
          if (!blob) return;
          await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
          flash('Image copied');
        } else {
          await navigator.clipboard.writeText(c.text);
          flash('Copied');
        }
        await jsonApi('PATCH', `clips/${c.id}`, { lastUsedAt: Date.now(), useCount: (c.useCount || 0) + 1 });
      } catch {
        flash('Copy failed — click the window first');
      }
    }

    function selectedIds(current: ClipItem[]): string[] {
      return current.filter((c) => bulk.isChecked(c.id)).map((c) => c.id);
    }

    async function renderList(): Promise<void> {
      const { clips } = (await getApi(endpoint())) as { clips: ClipItem[] };
      const visible = bulk.filterVisible(clips as unknown as { id: string }[]) as unknown as ClipItem[];

      clear(header);
      header.append(bulk.controls(visible as unknown as { id: string }[]));
      if (bulk.isSelecting()) {
        const ids = selectedIds(visible);
        if (ids.length >= 2) {
          const mergeBtn = el('button', 'clip-btn', `Merge (${ids.length})`);
          mergeBtn.type = 'button';
          mergeBtn.addEventListener('click', async () => {
            await jsonApi('POST', 'clips/merge', { ids });
            void load();
          });
          header.append(mergeBtn);
        }
      }

      more?.disconnect();
      more = null;
      clear(listEl);
      if (!visible.length) {
        listEl.append(el('div', 'clip-empty', ui.q ? 'No matching clips.' : 'Nothing copied yet.'));
        return;
      }

      // Render a page at a time, not the whole history. This list is rebuilt on every
      // keystroke, every new clip and every window focus, so its cost has to be bounded
      // by the WINDOW, not by how much the user has ever copied: at 2,000 clips the old
      // full rebuild took 2.6s to open and up to 697ms per keystroke (#287).
      let rendered = 0;
      const paint = (upTo: number): void => {
        const frag = document.createDocumentFragment();
        for (let i = rendered; i < upTo; i += 1) frag.append(clipRow(visible[i]));
        listEl.insertBefore(frag, sentinel);
        rendered = upTo;
        shown = Math.max(shown, rendered); // survive a re-render: keep what the user scrolled to
      };

      const sentinel = el('div', 'clip-more');
      listEl.append(sentinel);
      paint(Math.min(Math.max(shown, PAGE), visible.length));

      if (rendered >= visible.length) {
        sentinel.remove();
        return;
      }
      // Scrolling towards the end brings the next page in before it is reached, so the
      // list feels continuous — nothing is out of reach, it is just not built yet.
      more = new IntersectionObserver(
        () => {
          if (rendered >= visible.length) return;
          paint(Math.min(rendered + PAGE, visible.length));
          if (rendered >= visible.length) {
            more?.disconnect();
            more = null;
            sentinel.remove();
          }
        },
        // Watched against the viewport rather than the list, because WHICH element scrolls
        // depends on the window: maximized or manually sized, `.clip-list` is its own
        // scroll container; at the default size the dialog body scrolls and the list just
        // grows to fit. Either way, scrolling moves the sentinel within the viewport — so
        // rooting here works in both, and rooting at the list would only work in one.
        { rootMargin: '400px' },
      );
      more.observe(sentinel);
    }

    async function renderFooter(): Promise<void> {
      const s = (await getApi('clips/stats')) as Stats;
      clear(footer);
      const meter = el('div', 'clip-stats', `${s.count} items · ${humanBytes(s.bytes)} · ${s.favorites} ★`);
      const exportB = iconButton(DOWNLOAD, { title: 'Export JSON', className: 'clip-foot-act', onClick: doExport });
      const importB = iconButton(UPLOAD, { title: 'Import JSON', className: 'clip-foot-act', onClick: doImport });
      const clearB = el('button', 'clip-foot-act ghost', 'Clear…');
      clearB.type = 'button';
      clearB.addEventListener('click', doClear);
      footer.append(meter, el('div', 'clip-foot-spacer'), exportB, importB, clearB);
    }

    async function doExport(): Promise<void> {
      const data = await getApi('clips/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'kimtos-clipboard.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function doImport(): void {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          const { imported } = (await jsonApi('POST', 'clips/import', data)) as { imported: number };
          flash(`Imported ${imported} clip(s)`);
          void load();
        } catch {
          flash('Import failed — not a valid clipboard file');
        }
      });
      input.click();
    }

    async function doClear(): Promise<void> {
      const ok = await confirmDialog('Clear all clipboard items except your favorites? This cannot be undone.', {
        owner: root,
        confirmLabel: 'Clear',
      });
      if (!ok) return;
      const { removed } = (await jsonApi('POST', 'clips/clear', { scope: 'non-favorites' })) as { removed: number };
      flash(`Cleared ${removed} clip(s)`);
      void load();
    }

    let flashTimer: number | undefined;
    function flash(msg: string): void {
      let note = root.querySelector('.clip-flash') as HTMLElement | null;
      if (!note) {
        note = el('div', 'clip-flash');
        root.append(note);
      }
      note.textContent = msg;
      note.classList.add('show');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => note?.classList.remove('show'), 1400);
    }

    // Live refresh: our own edits (dataStore.onChange) + captures from the SW
    // (chrome.storage CHANGED_KEY) + returning to the window.
    const offData = dataStore.onChange(() => void renderList());
    const offClips = onClipsChanged(() => void load());
    const onFocus = (): void => void load();
    window.addEventListener('focus', onFocus);

    // One-off (#948): correct the stored type of clips the old classifier missed
    // (4/8-digit hex, the modern colour functions), then paint. Guarded by a stored
    // classifier version, so on every later open it is a single kv read. A failure
    // must never block the first paint — the pass just retries on the next open.
    void reclassifyClips()
      .catch(() => 0)
      .then(() => load());

    return () => {
      offData();
      offClips();
      window.removeEventListener('focus', onFocus);
      window.clearTimeout(flashTimer);
      window.clearTimeout(searchTimer);
      more?.disconnect();
    };
  },
};
