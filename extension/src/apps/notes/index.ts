// notes — markdown notes, Notion-style. Notes are organized into collections
// (a notebook, e.g. per book), each holding one or more Markdown pages. The
// sidebar is a tree: each collection expands/collapses to reveal its pages, next
// to an editor with an optional live preview. CRUD lives in notes.local.js.

import './notes.css';
import type { Token } from 'marked';
import { marked } from '../../lib/markdown.js';
import { diffBlocks, linksKey } from './previewDiff.js';
import { continueList } from './listContinuation.js';
import { enhanceTaskBoxes, toggleTaskAt } from './taskToggle.js';
import { execEdit } from '../../lib/editCommand.js';
import { buildBookSection, bookSectionHtml, mdHeading } from './bookSection.js';
import { createListWidget } from '../../components/widgetCard.js';
import { STORAGE_KEYS } from '@kimtos/config/ui';
import { printHtml } from './print.js';
import { getApi, jsonApi } from '../../lib/api.js';
import { dataStore } from '../../lib/dataStore.js';
import { NOTE_MAX_CHARS } from '../../lib/limits.js';
import { confirmDialog } from '../../components/confirm.js';
import { promptDialog } from '../../components/promptDialog.js';
import { pickerDialog } from '../../components/pickerDialog.js';
import { infoDialog } from '../../components/infoDialog.js';
import { showUndoToast } from '../../components/undoToast.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { openContextMenu, type ContextMenuItem } from '../../components/contextMenu.js';
import { createResizer } from '../../components/resizer.js';
import { el, escapeHtml, ownerDoc } from '../../lib/dom.js';
import { downloadBlob, safeFilename } from '../../lib/download.js';
import {
  TRASH,
  PLUS,
  BURGER,
  DOWNLOAD,
  FOLDER,
  PENCIL,
  INFO,
  BOOK,
  BACK,
  SEARCH,
  EYE,
  iconButton,
} from '../../components/icons.js';
import appMeta from './meta.js';

interface Collection {
  id: string;
  name?: string;
  updated?: number;
  pageCount?: number;
  [key: string]: unknown;
}
interface PageMeta {
  id: string;
  title?: string;
  updated?: number;
  [key: string]: unknown;
}
interface Page {
  id: string;
  title?: string;
  content?: string;
  collectionId: string;
  updated?: number;
  [key: string]: unknown;
}
interface InternalLink {
  collectionSlug: string | null;
  pageSlug: string;
}
type Md = string;
const parseMd = (src: string): Md => marked.parse(src) as string;

const SIDEBAR_DOCK = 900;
const SPLIT_MIN = 700;

// Normalize a title/name for internal links: lowercase, spaces & dashes → "_".
const slug = (s: string | undefined): string =>
  (s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

// Set by the home widget so the next open jumps to a collection / starts a new one.
let pendingCollectionId: string | null = null;
let pendingNewCollection = false;

// Sidebar width, drag-resizable; persists across opens within the session.
let sidebarWidth = 300;
// Editor pane width in Split view (null = even 50/50 until the user drags).
let editorSplitWidth: number | null = null;

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Markdown notes, organized into collections',
  tip: 'Tap Select, then drag across collections (or tick pages) to delete several at once. Right-click any item for rename, move, and more.',
  accent: appMeta.accent,
  order: appMeta.order,
  popout: true, // can be popped out into an always-on-top floating window

  // KimtAI agent tools.
  tools: [
    {
      name: 'list_collections',
      description: 'List note collections with their id and page count.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const list =
          (collections || []).map((c) => `${c.id} · ${c.name} (${c.pageCount} pages)`).join('\n') || '(none)';
        return { ok: true, result: list, summary: `${collections?.length || 0} collection(s)` };
      },
    },
    {
      name: 'create_collection',
      description: 'Create a note collection.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: async (args: Record<string, unknown>) => {
        const c = (await jsonApi('POST', 'collections', { name: String(args.name || 'Notes') })) as Collection;
        return { ok: true, result: `Created collection "${c.name}".`, summary: `created "${c.name}"` };
      },
    },
    {
      name: 'get_collection',
      description: 'Get one collection by id: its name plus the list of note ids and titles it holds.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const col = (collections || []).find((c) => c.id === args.id);
        if (!col) return { ok: false, result: 'No collection with that id.', summary: 'not found' };
        const { pages } = (await getApi(`collections/${col.id}/pages`)) as { pages?: PageMeta[] };
        const list = (pages || []).map((p) => `- ${p.id} · ${p.title}`).join('\n') || '(empty)';
        return { ok: true, result: `# ${col.name}\n${list}`, summary: `"${col.name}" (${pages?.length || 0} notes)` };
      },
    },
    {
      name: 'rename_collection',
      description: 'Rename a collection (id from list_collections).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      run: async (args: Record<string, unknown>) => {
        const c = (await jsonApi('PATCH', `collections/${String(args.id)}`, {
          name: String(args.name || ''),
        })) as Collection;
        return { ok: true, result: `Renamed to "${c.name}".`, summary: `renamed to "${c.name}"` };
      },
    },
    {
      name: 'delete_collection',
      description: 'Delete a collection and all its notes (id from list_collections).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `collections/${String(args.id)}`);
        return { ok: true, result: 'Collection deleted.', summary: 'deleted a collection' };
      },
    },
    {
      name: 'create_note',
      description:
        'Save a Markdown note (content optional). Goes into the named collection (created if missing), else "Notes".',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, content: { type: 'string' }, collection: { type: 'string' } },
        required: ['title'],
      },
      run: async (args: Record<string, unknown>) => {
        const name = String(args.collection || 'Notes').trim() || 'Notes';
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const found = (collections || []).find((c) => (c.name || '').toLowerCase() === name.toLowerCase());
        const col = found ?? ((await jsonApi('POST', 'collections', { name })) as Collection);
        const page = (await jsonApi('POST', `collections/${col.id}/pages`, {
          title: String(args.title || 'Untitled'),
          content: String(args.content || ''),
        })) as Page;
        return { ok: true, result: `Saved note "${page.title}" in "${name}".`, summary: `saved "${page.title}"` };
      },
    },
    {
      name: 'list_notes',
      description: 'List notes (with their id) grouped by collection.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const out: string[] = [];
        for (const c of collections || []) {
          const { pages } = (await getApi(`collections/${c.id}/pages`)) as { pages?: PageMeta[] };
          out.push(`# ${c.name}\n${(pages || []).map((p) => `- ${p.id} · ${p.title}`).join('\n') || '(empty)'}`);
        }
        return {
          ok: true,
          result: out.join('\n\n') || '(no notes)',
          summary: `${collections?.length || 0} collection(s)`,
        };
      },
    },
    {
      name: 'read_note',
      description: 'Read a note’s full content (id from list_notes/search_notes).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const p = (await getApi(`pages/${String(args.id)}`)) as Page;
        return { ok: true, result: `# ${p.title}\n\n${p.content}`, summary: `read "${p.title}"` };
      },
    },
    {
      name: 'update_note',
      description: 'Update a note’s title and/or content (id from list_notes).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' } },
        required: ['id'],
      },
      run: async (args: Record<string, unknown>) => {
        const patch: Record<string, unknown> = {};
        if (args.title != null) patch.title = String(args.title);
        if (args.content != null) patch.content = String(args.content);
        const p = (await jsonApi('PATCH', `pages/${String(args.id)}`, patch)) as Page;
        return { ok: true, result: `Updated "${p.title}".`, summary: `updated "${p.title}"` };
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a note (id from list_notes).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `pages/${String(args.id)}`);
        return { ok: true, result: 'Note deleted.', summary: 'deleted a note' };
      },
    },
    {
      name: 'move_note',
      description: 'Move a note (id from list_notes) into another collection (by name; created if missing).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, collection: { type: 'string' } },
        required: ['id', 'collection'],
      },
      run: async (args: Record<string, unknown>) => {
        const name = String(args.collection || '').trim();
        if (!name) return { ok: false, result: 'A target collection name is required.', summary: 'no collection' };
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const found = (collections || []).find((c) => (c.name || '').toLowerCase() === name.toLowerCase());
        const col = found ?? ((await jsonApi('POST', 'collections', { name })) as Collection);
        const p = (await jsonApi('PATCH', `pages/${String(args.id)}`, { collectionId: col.id })) as Page;
        return { ok: true, result: `Moved "${p.title}" to "${name}".`, summary: `moved to "${name}"` };
      },
    },
    {
      name: 'search_notes',
      description: 'Find notes whose title or content contains the query.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (args: Record<string, unknown>) => {
        const q = String(args.query || '').toLowerCase();
        const { collections } = (await getApi('collections')) as { collections?: Collection[] };
        const hits: string[] = [];
        for (const c of collections || []) {
          const { pages } = (await getApi(`collections/${c.id}/pages`)) as { pages?: PageMeta[] };
          for (const p of pages || []) {
            const full = (await getApi(`pages/${p.id}`)) as Page;
            const text = `${full.title}\n${full.content}`;
            if (text.toLowerCase().includes(q)) {
              const content = full.content || '';
              const i = content.toLowerCase().indexOf(q);
              const snippet = i >= 0 ? content.slice(Math.max(0, i - 30), i + 60) : content.slice(0, 90);
              hits.push(`- ${full.id} · "${full.title}" (${c.name}): …${snippet.replace(/\s+/g, ' ').trim()}…`);
            }
          }
        }
        return {
          ok: true,
          result: hits.length
            ? `Matches for "${String(args.query)}":\n${hits.join('\n')}`
            : `No notes match "${String(args.query)}".`,
          summary: `${hits.length} match(es)`,
        };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall).
  dataLabel: 'notes & collections',
  hasData: () => dataStore.hasAny('collections', 'pages', 'notes'),
  async clearData() {
    await dataStore.clearCollection('pages');
    await dataStore.clearCollection('collections');
    await dataStore.clearCollection('notes'); // legacy pre-collections notes
    await dataStore.kv.del(STORAGE_KEYS.notesMigrated);
  },

  // No `settings` block for the floating window: `popout: true` above is what declares
  // them. They come from POPOUT_SETTINGS (lib/pip.ts) and are merged in for every
  // pop-out app, so Clipboard and Retouch get the same controls instead of Notes being
  // the only app that hand-wrote them (#197).

  // Home card: your most recently worked-on collections (up to 5).
  widgetLabel: 'Pin notes',
  widgetHint: 'Show your recent notes on the home',
  async widget(ctx: { openApp: (id: string) => void }): Promise<HTMLElement | null> {
    let collections: Collection[];
    try {
      collections = ((await getApi('collections')) as { collections?: Collection[] }).collections || [];
    } catch {
      return null;
    }
    if (!collections.length) return null;

    return createListWidget({
      title: 'Notes',
      accent: '#a78bfa',
      count: collections.length,
      onOpen: () => ctx.openApp('notes'),
      items: collections.map((col) => ({
        label: col.name || 'Untitled',
        title: `${col.name} · ${col.pageCount} page${col.pageCount === 1 ? '' : 's'}`,
        onClick: () => {
          pendingCollectionId = col.id;
          ctx.openApp('notes');
        },
      })),
      more: {
        label: '+ New collection',
        onClick: () => {
          pendingNewCollection = true;
          ctx.openApp('notes');
        },
      },
    });
  },

  render(body: HTMLElement, ctx: { session?: unknown; saveSession?: (s: unknown) => void } = {}) {
    // Come back to the note the user had open (#1172). The collection is remembered alongside the
    // page because the page may not be in whichever collection would otherwise open first.
    const restored = (ctx.session as { collectionId?: string; pageId?: string } | null) ?? null;
    const rememberPage = (collectionId: string | null, pageId: string | null): void =>
      ctx.saveSession?.({ collectionId, pageId });
    let collections: Collection[] = [];
    const pagesByCol = new Map<string, PageMeta[]>();
    const expanded = new Set<string>();
    let current: Page | null = null;
    let view = 'edit'; // 'edit' | 'split' | 'preview'
    let userView = 'edit';
    let narrow = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let bookStack: { colId: string | null; scrollTop: number }[] = [];
    let currentBookColId: string | null = null;
    let bookContent: HTMLElement | null = null;

    const layout = el('div', 'doc-layout');
    const sidebar = el('aside', 'doc-sidebar');
    sidebar.style.width = `${sidebarWidth}px`;
    const resizer = createResizer({
      layout,
      pane: sidebar,
      reserve: 360,
      enabled: () => !narrow,
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    const main = el('div', 'doc-main');
    layout.append(sidebar, resizer, main);
    body.replaceChildren(layout);

    const toggleSidebar = (): void => {
      layout.classList.toggle('collapsed');
      refreshPlaceholder();
    };

    // Undo toast for deletes (30s) — shared component, consistent across apps.
    // `owner: layout` everywhere below: Notes can be popped out into a floating
    // window, and an overlay defaults to the new-tab page — where the user would
    // never see it (#85). `layout` is what popOut() actually moves.
    const showUndo = (message: string, onUndo: () => Promise<void> | void): void => {
      showUndoToast(message, { onUndo, duration: 30000, owner: layout });
    };

    // Edit a title via the shared prompt dialog; resolves to the value or null.
    const promptTitle = (label: string, value: string): Promise<string | null> =>
      promptDialog({ title: label, value, owner: layout });

    // --- editor (built once, kept stable so the textarea doesn't lose focus) ---
    const editor = el('div', 'doc-editor');
    editor.dataset.view = view;

    const toolbar = el('div', 'doc-toolbar');
    const burger = iconButton(BURGER, { title: 'Toggle collections', onClick: toggleSidebar, className: 'doc-burger' });
    const viewToggle = el('div', 'tabs doc-view-toggle');
    const editTab = el('button', 'tab', 'Edit');
    const splitTab = el('button', 'tab', 'Split');
    const previewTab = el('button', 'tab', 'Preview');
    viewToggle.append(editTab, splitTab, previewTab);
    const info = iconButton(INFO, { title: 'Help & shortcuts', onClick: showHelp, className: 'doc-info' });
    // Compact stand-in for the three-tab group: an app window mounts at 720px, which is
    // narrower than SIDEBAR_DOCK, so the tabs are hidden and previewing was unreachable
    // unless you maximized the window (#622). CSS shows exactly one of the two.
    const previewToggle = iconButton(EYE, {
      title: 'Preview',
      onClick: () => setUserView(view === 'preview' ? 'edit' : 'preview'),
      className: 'doc-preview-toggle',
    });
    const findToggle = iconButton(SEARCH, {
      title: 'Find & replace (⌘/Ctrl+F)',
      onClick: () => toggleFind(),
      className: 'doc-find-toggle',
    });
    const status = el('span', 'doc-status');
    const count = el('span', 'doc-count');
    toolbar.append(burger, viewToggle, info, previewToggle, findToggle, status, count);

    const titleBar = el('div', 'doc-title-bar');
    const titleText = el('h2', 'doc-title-text');
    titleBar.append(titleText);
    const setTitleText = (): void => {
      titleText.textContent = current && current.title !== 'Untitled' ? (current.title ?? '') : 'Untitled';
    };

    // --- find & replace bar ---
    const findBar = el('div', 'doc-find');
    findBar.hidden = true;
    const findInput = el('input', 'input doc-find-input');
    findInput.type = 'text';
    findInput.placeholder = 'Find';
    const findCount = el('span', 'doc-find-count', '0/0');
    const caseBtn = el('button', 'doc-find-btn', 'Aa');
    caseBtn.type = 'button';
    caseBtn.title = 'Match case';
    const prevBtn = el('button', 'doc-find-btn', '↑');
    prevBtn.type = 'button';
    prevBtn.title = 'Previous (⇧Enter)';
    const nextBtn = el('button', 'doc-find-btn', '↓');
    nextBtn.type = 'button';
    nextBtn.title = 'Next (Enter)';
    const replaceInput = el('input', 'input doc-find-input');
    replaceInput.type = 'text';
    replaceInput.placeholder = 'Replace';
    const replaceBtn = el('button', 'doc-find-btn doc-find-text', 'Replace');
    replaceBtn.type = 'button';
    const replaceAllBtn = el('button', 'doc-find-btn doc-find-text', 'All');
    replaceAllBtn.type = 'button';
    replaceAllBtn.title = 'Replace all';
    const findClose = el('button', 'close-x doc-find-close', '✕');
    findClose.type = 'button';
    findClose.title = 'Close (Esc)';
    const findRow = el('div', 'doc-find-row');
    findRow.append(findInput, findCount, caseBtn, prevBtn, nextBtn);
    const replaceRow = el('div', 'doc-find-row');
    replaceRow.append(replaceInput, replaceBtn, replaceAllBtn, findClose);
    findBar.append(findRow, replaceRow);

    const area = el('div', 'doc-editor-area');
    const sourceWrap = el('div', 'doc-source-wrap');
    const highlights = el('div', 'doc-highlights');
    highlights.setAttribute('aria-hidden', 'true');
    const caretMirror = el('div', 'doc-caret-mirror');
    caretMirror.setAttribute('aria-hidden', 'true');
    const source = el('textarea', 'doc-source');
    source.placeholder = 'Write Markdown here…';
    source.spellcheck = false;
    // The cap is declared once in lib/limits.ts and enforced by notes.local.ts; the editor
    // reads the same number so the counter cannot promise room the save will reject.
    source.maxLength = NOTE_MAX_CHARS;
    sourceWrap.append(highlights, caretMirror, source);

    const updateCount = (): void => {
      const n = source.value.length;
      count.textContent = `${n.toLocaleString()} / ${NOTE_MAX_CHARS.toLocaleString()}`;
      count.classList.toggle('is-over', n >= NOTE_MAX_CHARS);
    };
    const preview = el('div', 'md-preview doc-preview');
    const editorResizer = createResizer({
      layout: area,
      pane: sourceWrap,
      min: 260,
      reserve: 260,
      enabled: () => view === 'split' && !narrow,
      onResize: (w) => {
        editorSplitWidth = w;
        sourceWrap.style.flex = '0 0 auto';
      },
    });
    editorResizer.classList.add('doc-split-resizer');
    area.append(sourceWrap, editorResizer, preview);

    editor.append(toolbar, findBar, titleBar, area);

    function applySplitLayout(): void {
      if (view === 'split' && !narrow && editorSplitWidth != null) {
        sourceWrap.style.flex = '0 0 auto';
        sourceWrap.style.width = `${editorSplitWidth}px`;
      } else {
        sourceWrap.style.flex = '';
        sourceWrap.style.width = '';
      }
    }

    function setView(next: string): void {
      view = next;
      editor.dataset.view = view;
      editTab.classList.toggle('is-active', view === 'edit');
      splitTab.classList.toggle('is-active', view === 'split');
      previewTab.classList.toggle('is-active', view === 'preview');
      // The compact switch names the mode it takes you TO, not the one you are in.
      const toPreview = view !== 'preview';
      previewToggle.innerHTML = toPreview ? EYE : PENCIL;
      previewToggle.title = toPreview ? 'Preview' : 'Edit';
      previewToggle.setAttribute('aria-label', previewToggle.title);
      previewToggle.classList.toggle('is-active', !toPreview);
      applySplitLayout();
    }

    // The user's own pick, which `applyWidth` may narrow to 'edit' when there is no
    // room for two panes — so it is remembered separately from the live `view`.
    function setUserView(next: string): void {
      userView = next;
      setView(next);
      if (next !== 'edit') renderPreview();
      if (next !== 'preview') requestAnimationFrame(autoGrow);
    }
    editTab.addEventListener('click', () => setUserView('edit'));
    splitTab.addEventListener('click', () => setUserView('split'));
    previewTab.addEventListener('click', () => setUserView('preview'));
    setView(view);

    const applyWidth = (w: number): void => {
      if (w <= 0) return;

      const overlay = w < SIDEBAR_DOCK;
      if (overlay !== narrow) {
        narrow = overlay;
        layout.classList.toggle('is-narrow', narrow);
        if (narrow) {
          layout.classList.add('collapsed');
          sidebar.style.width = '';
        } else {
          layout.classList.remove('collapsed');
          sidebar.style.width = `${sidebarWidth}px`;
        }
        refreshPlaceholder();
      }

      const want = userView === 'split' && w < SPLIT_MIN ? 'edit' : userView;
      if (want !== view) {
        setView(want);
        renderPreview();
      }
    };
    const ro = new ResizeObserver((entries) => {
      applyWidth(entries[0].contentRect.width);
      autoGrow();
    });
    ro.observe(layout);
    const wrapRo = new ResizeObserver(() => scheduleSync(true));
    wrapRo.observe(sourceWrap);

    layout.addEventListener('click', (e) => {
      if (!narrow || layout.classList.contains('collapsed')) return;
      const target = e.target as Element | null;
      // The controls that OPEN the sidebar must not be treated as a click outside
      // it, or they would re-collapse it the moment they opened it.
      if (target?.closest('.doc-sidebar') || target?.closest('.doc-burger') || target?.closest('.doc-browse')) return;
      layout.classList.add('collapsed');
      refreshPlaceholder();
    });

    let previewTimer: ReturnType<typeof setTimeout> | null = null;

    // --- incremental preview -------------------------------------------------
    // Re-parsing and re-`innerHTML`-ing the WHOLE page for every edit is what made
    // Split view lag: measured on a 49k-character page, `marked.parse` costs 37ms
    // and the resulting swap builds 3,341 nodes, so 25 keystrokes cost 1,319ms of
    // blocked main thread (#838). It also threw the reader's scroll position away
    // on every render.
    //
    // Instead, lex the page into its top-level blocks (9.5ms) and re-render only
    // the blocks whose source text actually changed — a single edited paragraph
    // costs ~0.02ms to parse and replaces one node. `marked.parser([token])` per
    // block produces output identical to parsing the whole document, as long as
    // the lexer's link-reference table travels with it.
    interface PreviewBlock {
      raw: string;
      count: number; // how many DOM nodes this block rendered to
    }
    type LexedTokens = Token[] & { links?: Record<string, { href: string | null; title: string | null }> };
    let previewBlocks: PreviewBlock[] = [];
    let previewLinksKey = '';
    const blockHtml = new Map<string, string>();

    const renderBlock = (token: Token, links: LexedTokens['links']): string => {
      const hit = blockHtml.get(token.raw);
      if (hit != null) return hit;
      const one = [token] as LexedTokens;
      one.links = links;
      const html = marked.parser(one) as string;
      // The cache is per open page and only grows with distinct block text; cap it
      // so a long editing session can't retain an unbounded pile of old blocks.
      if (blockHtml.size > 4000) blockHtml.clear();
      blockHtml.set(token.raw, html);
      return html;
    };

    // Making a task box clickable is `enhanceTaskBoxes` (taskToggle.ts), called per block
    // from the render loop below. It lives there because it is one half of a mapping whose
    // other half is `toggleTaskAt`, and only Notes has that mapping: the same `.md-preview`
    // renders KimtAI's replies and KimtFS' file previews, where there is no source to write
    // back to and a tickable box would be a lie.
    //
    // Set by a checkbox click, consumed by the render it triggers: the index of the box
    // whose replacement should take focus. Null whenever the render was not caused by one.
    let refocusTaskIndex: number | null = null;

    // ONE delegated listener, bound once to the preview itself. Binding to the inputs
    // would not survive: editing re-renders the block they live in, and the fresh nodes
    // would have no handler.
    preview.addEventListener('click', (e) => {
      const box = (e.target as HTMLElement | null)?.closest?.('input.doc-task') as HTMLInputElement | null;
      if (!box) return;
      // The index among the rendered boxes IS the index into the source's task markers —
      // see taskToggle.ts, where that correspondence is asserted against marked itself.
      const index = [...preview.querySelectorAll('input.doc-task')].indexOf(box);
      const edit = toggleTaskAt(source.value, index);
      // Nothing to write — the source changed under the click. Refuse the tick rather than
      // leaving a box showing a state the document does not agree with.
      //
      // The second condition is a cheap consistency check on the mapping itself. The click
      // has already flipped this box, and the marker it resolved to is about to be flipped
      // the same way, so the two must agree on the result. If they do not, this index is
      // not describing this box, and writing would edit a line the user did not click.
      if (!edit || box.checked !== (edit.text === '[x]')) {
        e.preventDefault();
        return;
      }
      // Otherwise let the box tick immediately and write the source behind it. The repaint
      // is debounced (schedulePreview), so suppressing the native toggle here would leave
      // the box visibly unchanged for the length of that debounce on every click.
      //
      // That repaint also REPLACES this very input — the block it lives in is re-rendered
      // from its new source text — so a keyboard user working down a checklist would lose
      // focus to <body> a fraction of a second after each tick. Remember which box it was,
      // and put focus back on its replacement.
      refocusTaskIndex = index;
      applyReplacement(edit.start, edit.end, edit.text);
      afterEdit();
    });

    const resetPreview = (): void => {
      previewBlocks = [];
      previewLinksKey = '';
      blockHtml.clear();
      preview.replaceChildren();
    };

    const renderPreview = (): void => {
      // Claimed once, whatever this render goes on to do — an early return must not leave
      // it set for some later, unrelated render to steal focus on.
      const refocus = refocusTaskIndex;
      refocusTaskIndex = null;
      if (view === 'edit') return;
      // Held rather than re-read: the task mapping resolves offsets into the text the tokens
      // were lexed FROM, which on an empty page is the placeholder and not `source.value`.
      const text = source.value || '*Nothing to preview yet.*';
      const tokens = marked.lexer(text) as LexedTokens;
      const key = linksKey(tokens.links);
      if (key !== previewLinksKey) {
        previewBlocks = [];
        blockHtml.clear();
        preview.replaceChildren();
        previewLinksKey = key;
      }

      // Diff the block list by common prefix and suffix, so inserting or deleting
      // a block shifts nothing else — only the run between them is rebuilt.
      const next = tokens.map((t) => t.raw);
      const prev = previewBlocks;
      const { lo, prevEnd, nextEnd, same } = diffBlocks(
        prev.map((b) => b.raw),
        next,
      );
      if (same) return;

      let before = 0;
      for (let i = 0; i < lo; i += 1) before += prev[i].count;
      let removed = 0;
      for (let i = lo; i < prevEnd; i += 1) removed += prev[i].count;

      // Build the new run detached, enhance its links there, then move it in — the
      // click handlers live on the <a> nodes and survive the move.
      const staging = el('div');
      const rebuilt: PreviewBlock[] = [];
      // Where the first rebuilt block starts in `text`, which is what the task mapping keys
      // on. Summed the same way `taskToggle` sums it, so both sides mean the same offset.
      let blockAt = 0;
      for (let i = 0; i < lo; i += 1) blockAt += tokens[i].raw.length;
      for (let i = lo; i < nextEnd; i += 1) {
        const at = staging.childNodes.length;
        staging.insertAdjacentHTML('beforeend', renderBlock(tokens[i], tokens.links));
        rebuilt.push({ raw: next[i], count: staging.childNodes.length - at });
        // Per block, over the nodes it just rendered — and on the DETACHED staging div, for
        // the same reason `enhanceLinks` runs there. The verdict depends only on the block
        // and where it sits, so a block that is NOT rebuilt keeps the nodes it already has
        // and the answer it already got.
        enhanceTaskBoxes([...staging.childNodes].slice(at), tokens[i], text, blockAt);
        blockAt += tokens[i].raw.length;
      }
      enhanceLinks(staging, current?.collectionId);

      for (let i = 0; i < removed; i += 1) preview.childNodes[before].remove();
      const frag = document.createDocumentFragment();
      frag.append(...staging.childNodes);
      preview.insertBefore(frag, preview.childNodes[before] ?? null);
      previewBlocks = [...prev.slice(0, lo), ...rebuilt, ...prev.slice(prevEnd)];

      // A tick replaced the box that had focus; give it back to its replacement, so a
      // keyboard user can carry on down the checklist.
      //
      // Only if focus is still where the tick left it. This render is debounced, and in
      // Split view the user can have clicked into the textarea and started typing in the
      // meantime — restoring blindly would then yank them out of the field mid-word, which
      // is the focus-stealing failure the editor is careful about everywhere else (#217).
      // The removed input leaves focus on the body, so that is the other case to accept.
      const active = ownerDoc(preview).activeElement;
      if (refocus != null && (active === null || active === ownerDoc(preview).body || preview.contains(active))) {
        preview.querySelectorAll<HTMLInputElement>('input.doc-task')[refocus]?.focus();
      }
    };

    function parseInternalLink(href: string): InternalLink | null {
      const m = href.match(/^([^:/?#]+):(.+)$/);
      if (!m) return null;
      const [, prefix, rest] = m;
      if (rest.startsWith('//')) return null; // https://, etc.
      if (prefix === 'this') return { collectionSlug: null, pageSlug: slug(rest) };
      const cslug = slug(prefix);
      if (collections.some((c) => slug(c.name) === cslug)) return { collectionSlug: cslug, pageSlug: slug(rest) };
      return null;
    }

    async function resolveInternalLink(
      { collectionSlug, pageSlug }: InternalLink,
      baseColId?: string,
    ): Promise<{ col: Collection; page: PageMeta } | null> {
      const col =
        collectionSlug == null
          ? collections.find((c) => c.id === (baseColId ?? current?.collectionId))
          : collections.find((c) => slug(c.name) === collectionSlug);
      if (!col) {
        status.textContent = 'Linked collection not found.';
        return null;
      }
      if (!pagesByCol.has(col.id)) await loadPages(col.id);
      const page = (pagesByCol.get(col.id) || []).find((p) => slug(p.title) === pageSlug);
      if (!page) {
        status.textContent = 'Linked page not found.';
        return null;
      }
      return { col, page };
    }

    async function openInternalLink(internal: InternalLink, baseColId?: string): Promise<void> {
      const found = await resolveInternalLink(internal, baseColId);
      if (!found) return;
      expanded.add(found.col.id);
      await openPage(found.page.id);
    }

    async function openInternalLinkInBook(internal: InternalLink, baseColId?: string): Promise<void> {
      const found = await resolveInternalLink(internal, baseColId);
      if (!found) return;
      bookStack.push({ colId: currentBookColId, scrollTop: bookContent?.scrollTop || 0 });
      await openBookView(found.col.id, found.page.id);
    }

    function enhanceLinks(
      container: HTMLElement,
      baseColId?: string,
      onInternal?: (internal: InternalLink, baseColId?: string) => void,
    ): void {
      container.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const internal = parseInternalLink(href);
        if (internal) {
          a.classList.add('doc-link');
          a.removeAttribute('target');
          a.addEventListener('click', (e) => {
            e.preventDefault();
            (onInternal || openInternalLink)(internal, baseColId);
          });
          return;
        }
        if (href && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(href)) {
          a.setAttribute('href', `https://${href}`);
        }
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
    }

    function showHelp(): void {
      void infoDialog({
        owner: layout,
        title: 'Notes — help',
        html:
          '<h4>Collections &amp; pages</h4>' +
          '<ul>' +
          '<li><b>＋</b> in the sidebar header creates a collection; <b>New page</b> adds a page inside one.</li>' +
          '<li>Click a collection to expand/collapse it; click a page to open it.</li>' +
          '<li>Right-click a <b>collection</b>: New page, Export as Book, Rename, Download (.zip), Export as PDF, Delete.</li>' +
          '<li>Right-click a <b>page</b>: New page, Rename, Download (.md), Export as PDF, Move to collection…, Delete.</li>' +
          '<li><b>Move a page</b> between collections by dragging it onto another collection, or via its right-click menu.</li>' +
          '<li>Drag the divider to resize the sidebar; the ☰ button toggles it.</li>' +
          '<li>Deleting a page or collection can be undone for 30 seconds.</li>' +
          '</ul>' +
          '<h4>Editing</h4>' +
          '<ul>' +
          '<li>Write Markdown (GitHub-flavored): headings, lists, tables, links, and fenced code with syntax highlighting.</li>' +
          '<li>Switch panes with <b>Edit</b> / <b>Split</b> / <b>Preview</b>; in Split view, drag the divider to resize them.</li>' +
          '<li>In a narrow window the tabs give way to a single toggle next to the search button, which flips between writing and preview.</li>' +
          '<li>Edits save automatically.</li>' +
          '<li><code>⌘/Ctrl+Z</code> undoes and <code>⌘⇧Z / Ctrl+Y</code> redoes — including Replace.</li>' +
          '</ul>' +
          '<h4>Find &amp; replace</h4>' +
          '<ul>' +
          '<li><code>⌘/Ctrl+F</code> opens it; every match is highlighted in yellow.</li>' +
          '<li><code>Enter</code> / <code>⇧Enter</code> jump to the next / previous match; <b>Aa</b> toggles match case.</li>' +
          '<li><b>Replace</b> changes the current match, <b>All</b> replaces them all; <code>Esc</code> closes.</li>' +
          '</ul>' +
          '<h4>Internal links</h4>' +
          '<p>Link to another page with a Markdown link:</p>' +
          '<ul><li>Same collection: <code>[text](this:page_name)</code></li>' +
          '<li>Another collection: <code>[text](collection_name:page_name)</code></li></ul>' +
          '<p>Names are normalized — spaces and dashes become <code>_</code> and case is ignored, so “Page Title” → <code>page_title</code>.</p>' +
          '<h4>Export as Book</h4>' +
          '<p>Reads a whole collection as one continuous document. Internal links navigate within the book; use ← to go back. The ⬇ icon exports the book to PDF.</p>' +
          '<h4>Export as PDF</h4>' +
          '<p>From a page or collection’s right-click menu (or the Book view). It opens your print dialog — choose <b>Save as PDF</b>. Everything stays on your device.</p>',
      });
    }

    function enterBookView(colId: string): Promise<void> {
      bookStack = [];
      return openBookView(colId);
    }

    async function openBookView(colId: string, focusPageId?: string, scrollTop?: number): Promise<void> {
      await flushSave();
      currentBookColId = colId;
      const col = collections.find((c) => c.id === colId);
      if (!pagesByCol.has(colId)) await loadPages(colId);
      const list = pagesByCol.get(colId) || [];
      const fulls = (
        await Promise.all(list.map((p) => (getApi(`pages/${p.id}`) as Promise<Page>).catch(() => null)))
      ).filter(Boolean) as Page[];
      const ordered = fulls.reverse(); // pages are newest-first; read oldest-first

      const book = el('div', 'doc-book');
      const bar = el('div', 'doc-book-bar');
      const back = el('button', 'icon-button');
      back.innerHTML = BACK;
      back.title = bookStack.length ? 'Back' : 'Back to editor';
      back.setAttribute('aria-label', back.title);
      back.addEventListener('click', () => {
        if (bookStack.length) {
          const prev = bookStack.pop()!;
          openBookView(prev.colId ?? colId, undefined, prev.scrollTop);
        } else {
          exitBookView();
        }
      });
      const exportBtn = iconButton(DOWNLOAD, {
        title: 'Export as PDF',
        onClick: () => exportCollectionPdf(colId),
        className: 'doc-book-export',
      });
      bar.append(back, el('span', 'doc-book-title', col?.name || 'Book'), exportBtn);

      const content = el('div', 'doc-book-content md-preview');
      bookContent = content;
      for (const page of ordered) {
        const section = buildBookSection(page, parseMd);
        enhanceLinks(section, colId, openInternalLinkInBook);
        content.append(section);
      }
      if (!ordered.length) content.append(el('p', 'placeholder-lead', 'This collection has no pages yet.'));

      book.append(bar, content);
      layout.classList.add('is-reading');
      main.replaceChildren(book);
      if (focusPageId) {
        const target = content.querySelector(`.doc-book-page[data-id="${focusPageId}"]`);
        if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
      } else if (scrollTop != null) {
        requestAnimationFrame(() => {
          content.scrollTop = scrollTop;
        });
      }
    }

    function exitBookView(): void {
      bookStack = [];
      currentBookColId = null;
      bookContent = null;
      layout.classList.remove('is-reading');
      if (current) main.replaceChildren(editor);
      else showPlaceholder();
    }
    const schedulePreview = (): void => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 200);
    };

    const scheduleSave = (): void => {
      status.textContent = 'Saving…';
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 600);
    };

    async function save(): Promise<void> {
      if (!current) return;
      saveTimer = null;
      const page = current;
      try {
        const updated = (await jsonApi('PATCH', `pages/${page.id}`, { content: source.value })) as Page;
        if (current === page) {
          current = { ...current, ...updated };
          status.textContent = 'Saved';
        }
        const entry = pagesByCol.get(page.collectionId)?.find((p) => p.id === page.id);
        if (entry) entry.updated = updated.updated;
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      }
    }

    async function renamePage(page: Page | null = current, colId = current?.collectionId): Promise<void> {
      if (!page) return;
      const name = await promptTitle('Page title', page.title === 'Untitled' ? '' : (page.title ?? ''));
      if (name == null) return;
      if (current?.id === page.id) await flushSave();
      let updated: Page;
      try {
        updated = (await jsonApi('PATCH', `pages/${page.id}`, { title: name || 'Untitled' })) as Page;
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      const entry = (colId ? pagesByCol.get(colId) || [] : []).find((p) => p.id === page.id);
      if (entry) {
        entry.title = updated.title;
        entry.updated = updated.updated;
      }
      if (current?.id === page.id) {
        current = { ...current, ...updated };
        setTitleText();
      }
      const item = sidebar.querySelector(`.doc-page-item[data-id="${page.id}"] .doc-page-title`);
      if (item) item.textContent = updated.title || 'Untitled';
    }

    async function deletePage(
      pageInfo: PageMeta | Page | null = current,
      colId = current?.collectionId,
    ): Promise<void> {
      if (!pageInfo || !colId) return;
      if (!(await confirmDialog('Delete this page?', { owner: layout }))) return;
      const isCurrent = current?.id === pageInfo.id;
      let snapshot: { title?: string; content: string };
      if (isCurrent && current) {
        snapshot = { title: current.title, content: source.value };
      } else {
        try {
          const full = (await getApi(`pages/${pageInfo.id}`)) as Page;
          snapshot = { title: full.title, content: full.content || '' };
        } catch {
          snapshot = { title: pageInfo.title, content: '' };
        }
      }
      await jsonApi('DELETE', `pages/${pageInfo.id}`);
      const remaining = (pagesByCol.get(colId) || []).filter((p) => p.id !== pageInfo.id);
      pagesByCol.set(colId, remaining);
      if (isCurrent) {
        current = null;
        drawSidebar();
        if (remaining.length) await openPage(remaining[0].id);
        else showPlaceholder();
      } else {
        drawSidebar();
      }
      showUndo('Page deleted', async () => {
        const restored = (await jsonApi('POST', `collections/${colId}/pages`, snapshot)) as PageMeta;
        pagesByCol.set(colId, [
          { id: restored.id, title: restored.title, updated: restored.updated },
          ...(pagesByCol.get(colId) || []),
        ]);
        expanded.add(colId);
        await openPage(restored.id);
      });
    }

    async function movePage(page: PageMeta, fromColId: string, toColId: string): Promise<void> {
      if (!page || !toColId || fromColId === toColId) return;
      if (current?.id === page.id) await flushSave();
      let updated: Page;
      try {
        updated = (await jsonApi('PATCH', `pages/${page.id}`, { collectionId: toColId })) as Page;
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      applyMove(page.id, fromColId, toColId, updated);
      const toName = collections.find((c) => c.id === toColId)?.name || 'collection';
      showUndo(`Moved to "${toName}"`, async () => {
        let back: Page;
        try {
          back = (await jsonApi('PATCH', `pages/${page.id}`, { collectionId: fromColId })) as Page;
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : String(err);
          return;
        }
        applyMove(page.id, toColId, fromColId, back);
      });
    }

    function applyMove(id: string, fromId: string, toId: string, updated?: Page): void {
      const fromList = pagesByCol.get(fromId);
      const entry: PageMeta = fromList?.find((p) => p.id === id) || { id, title: updated?.title || 'Untitled' };
      if (updated?.title != null) entry.title = updated.title;
      if (updated?.updated != null) entry.updated = updated.updated;
      if (fromList)
        pagesByCol.set(
          fromId,
          fromList.filter((p) => p.id !== id),
        );
      if (pagesByCol.has(toId)) pagesByCol.set(toId, [entry, ...(pagesByCol.get(toId) || [])]);
      const fromCol = collections.find((c) => c.id === fromId);
      const toCol = collections.find((c) => c.id === toId);
      if (fromCol && fromCol.pageCount != null) fromCol.pageCount = Math.max(0, fromCol.pageCount - 1);
      if (toCol && toCol.pageCount != null) toCol.pageCount += 1;
      if (current?.id === id) current = { ...current, collectionId: toId };
      expanded.add(toId);
      drawSidebar();
    }

    async function promptMovePage(page: PageMeta, fromColId: string): Promise<void> {
      const others = collections.filter((c) => c.id !== fromColId);
      if (!others.length) {
        status.textContent = 'There’s no other collection to move this page to.';
        return;
      }
      const toId = await pickCollection('Move page to…', others);
      if (toId != null) await movePage(page, fromColId, toId);
    }

    const pickCollection = (label: string, cols: Collection[]): Promise<string | null> =>
      pickerDialog({
        owner: layout,
        title: label,
        items: cols.map((c) => ({ id: c.id, label: c.name || 'Untitled', icon: FOLDER })),
      });

    async function flushSave(): Promise<void> {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await save();
      }
    }

    // Only the wrapper-scrolls mode needs a full-height textarea; `is-finding` is
    // what actually switches that on, so gate on it rather than on the bar being
    // open. (They used to be assumed identical — they are not while the overlay is
    // suspended for typing, below.)
    function autoGrow(): void {
      if (!sourceWrap.classList.contains('is-finding')) return;
      source.style.height = 'auto';
      source.style.height = `${source.scrollHeight}px`;
    }

    function keepCaretInView(): void {
      if (sourceWrap.scrollHeight <= sourceWrap.clientHeight) return;
      const pos = source.selectionEnd;
      caretMirror.textContent = source.value.slice(0, pos);
      const marker = el('span');
      marker.textContent = '​'; // zero-width space
      caretMirror.append(marker);
      const lh = marker.offsetHeight || 22;
      const top = marker.offsetTop;
      const viewTop = sourceWrap.scrollTop;
      const viewBottom = viewTop + sourceWrap.clientHeight;
      if (top < viewTop + lh) sourceWrap.scrollTop = Math.max(0, top - lh);
      else if (top + lh > viewBottom) sourceWrap.scrollTop = top - sourceWrap.clientHeight + lh * 2;
    }

    let syncFrame = 0;
    let pendingGrow = false;
    function scheduleSync(grow?: boolean): void {
      if (grow) pendingGrow = true;
      if (syncFrame) return;
      syncFrame = requestAnimationFrame(() => {
        syncFrame = 0;
        if (pendingGrow) {
          pendingGrow = false;
          autoGrow();
          if (sourceWrap.classList.contains('is-finding')) computeMatches(true);
        }
        keepCaretInView();
      });
    }

    // --- find overlay: suspended while the user types ------------------------
    // With Find open, every keystroke used to redo four whole-document jobs: grow
    // the textarea (a forced layout of a text control 64,000px tall), rescan the
    // page for matches, rebuild a ~50KB escaped-HTML highlight backdrop, and slice
    // a whole page (up to NOTE_MAX_CHARS) into the caret mirror for two more forced layouts.
    // Measured on a 49k page: 1,028ms of blocked main thread for 25 keystrokes
    // (#838).
    //
    // None of it is needed while typing — an edit invalidates the match offsets
    // anyway. So editing the source suspends the overlay (the textarea goes back to
    // scrolling itself natively, which is the fast path, and all four jobs
    // early-return) and it comes back once the edit settles, or the moment anything
    // actually reads the match state.
    let findRefresh: ReturnType<typeof setTimeout> | null = null;

    function suspendFindOverlay(): void {
      if (findBar.hidden || !sourceWrap.classList.contains('is-finding')) return;
      sourceWrap.classList.remove('is-finding');
      source.style.height = '';
      highlights.textContent = '';
    }

    // Put the overlay back without recomputing — for callers that recompute anyway.
    function activateFindOverlay(): void {
      if (findRefresh) {
        clearTimeout(findRefresh);
        findRefresh = null;
      }
      if (findBar.hidden || sourceWrap.classList.contains('is-finding')) return;
      sourceWrap.classList.add('is-finding');
      autoGrow();
    }

    // Anything that READS the match offsets must call this first — after an edit
    // they are stale, and acting on them would highlight (or replace) the wrong
    // range.
    function resumeFindOverlay(): void {
      const suspended = !findBar.hidden && !sourceWrap.classList.contains('is-finding');
      activateFindOverlay();
      if (suspended) computeMatches(true);
    }

    const scheduleFindRefresh = (): void => {
      if (findBar.hidden) return;
      if (findRefresh) clearTimeout(findRefresh);
      findRefresh = setTimeout(resumeFindOverlay, 250);
    };

    source.addEventListener('input', () => {
      updateCount();
      suspendFindOverlay();
      scheduleFindRefresh();
      scheduleSync(true);
      schedulePreview();
      scheduleSave();
    });
    // Enter continues a Markdown list, and ends it on an item you have not typed into.
    // Every guard here is about NOT stealing a keystroke that meant something else:
    // a modifier, an IME still composing a character, or a selection the user is about to
    // replace. Shift+Enter is left alone deliberately, as the way to get a plain newline.
    source.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (source.selectionStart !== source.selectionEnd) return;
      const next = continueList(source.value, source.selectionStart);
      if (!next) return; // not a list line — Enter keeps its native behaviour
      e.preventDefault();
      applyReplacement(next.start, next.end, next.text);
      afterEdit();
    });
    source.addEventListener('keyup', (e) => {
      if (
        e.key.startsWith('Arrow') ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        scheduleSync(false);
      }
    });

    // --- find & replace (operates on the textarea) ---
    let matches: number[] = [];
    let matchIndex = -1;
    let caseSensitive = false;
    const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const MAX_MARKS = 600;
    function renderHighlights(): void {
      if (findBar.hidden || !matches.length) {
        highlights.textContent = '';
        return;
      }
      const text = source.value;
      const qlen = findInput.value.length;
      let lo = 0;
      let hi = matches.length;
      if (hi > MAX_MARKS) {
        lo = Math.max(0, Math.min(matchIndex - (MAX_MARKS >> 1), matches.length - MAX_MARKS));
        hi = lo + MAX_MARKS;
      }
      let html = '';
      let last = 0;
      for (let i = lo; i < hi; i += 1) {
        const start = matches[i];
        html += escapeHtml(text.slice(last, start));
        const cls = i === matchIndex ? 'doc-hl is-current' : 'doc-hl';
        html += `<mark class="${cls}">${escapeHtml(text.slice(start, start + qlen))}</mark>`;
        last = start + qlen;
      }
      html += escapeHtml(text.slice(last));
      highlights.innerHTML = `${html}\n`;
    }

    function updateFindCount(): void {
      findCount.textContent = matches.length ? `${matchIndex + 1}/${matches.length}` : '0/0';
      const none = !matches.length;
      prevBtn.disabled = none;
      nextBtn.disabled = none;
      replaceBtn.disabled = none;
      replaceAllBtn.disabled = !findInput.value;
    }

    function revealRange(start: number, end: number): void {
      source.setSelectionRange(start, end);
      const mark = highlights.querySelector('.doc-hl.is-current') as HTMLElement | null;
      if (!mark) return;
      const target = mark.offsetTop - sourceWrap.clientHeight / 2 + mark.offsetHeight / 2;
      sourceWrap.scrollTop = Math.max(0, target);
    }

    function computeMatches(keepIndex = false): void {
      const q = findInput.value;
      const prevStart = matchIndex >= 0 ? matches[matchIndex] : -1;
      matches = [];
      if (q) {
        const re = new RegExp(escapeRe(q), caseSensitive ? 'g' : 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(source.value)) !== null) {
          matches.push(m.index);
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
      if (keepIndex && prevStart >= 0 && matches.length) {
        const at = matches.indexOf(prevStart);
        matchIndex = at >= 0 ? at : Math.min(Math.max(matchIndex, 0), matches.length - 1);
      } else {
        matchIndex = matches.length ? 0 : -1;
      }
      updateFindCount();
      renderHighlights();
    }

    function runFind(): void {
      activateFindOverlay(); // computeMatches() below does the recompute
      computeMatches();
      if (matches.length) {
        const start = matches[matchIndex];
        revealRange(start, start + findInput.value.length);
      }
    }

    function gotoMatch(dir: number): void {
      resumeFindOverlay(); // the offsets below must not be stale from an edit
      if (!matches.length) return;
      matchIndex = (matchIndex + dir + matches.length) % matches.length;
      updateFindCount();
      renderHighlights();
      const start = matches[matchIndex];
      revealRange(start, start + findInput.value.length);
    }

    function afterEdit(): void {
      // applyReplacement fires `input`, which suspends the overlay — put it back, and
      // RECOMPUTE while doing so.
      //
      // This used to call `activateFindOverlay`, which un-suspends without recomputing,
      // on the stated understanding that the caller would recompute anyway. Replace and
      // Replace-all did. But un-suspending is also what makes a later `resumeFindOverlay`
      // decide it has nothing to do, so any caller that did NOT recompute left the match
      // offsets pointing into the pre-edit text with the overlay looking live — and the
      // next Replace would then overwrite an unrelated range of the note. That is a
      // contract no caller should have to know: recompute here, for everyone.
      resumeFindOverlay();
      autoGrow();
      updateCount();
      schedulePreview();
      scheduleSave();
    }

    // The one writer into the editor. Everything that edits the text on the user's behalf
    // — replace, replace all, list continuation, ticking a checkbox — goes through it, so
    // they all keep native undo and all repaint the same way.
    //
    // It goes through the shared `execEdit` rather than calling `execCommand` itself
    // because replacing a range with '' is a DELETION: `insertText` with an empty string
    // is a no-op in Chrome, so an empty replacement silently did nothing on the
    // execCommand path and only worked on the fallback. That is the whole reason
    // `editCommandFor` exists (lib/editCommand.ts).
    function applyReplacement(start: number, end: number, text: string): void {
      const prevFocus = document.activeElement as HTMLElement | null;
      source.focus();
      source.setSelectionRange(start, end);
      // `execCommand` edits whatever is FOCUSED, so it is only safe once the focus really
      // landed on the textarea. In Preview-only view `.doc-source-wrap` is `display: none`,
      // so `focus()` above is a no-op and the command would otherwise be aimed at whatever
      // else held focus. The fallback below is correct in that mode; it just does not join
      // the native undo stack, which a hidden editor has no visible undo for anyway.
      if (document.activeElement !== source || !execEdit(text)) {
        source.setRangeText(text, start, end, 'end');
        source.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (prevFocus && prevFocus !== source && prevFocus.focus) prevFocus.focus();
    }

    function replaceCurrent(): void {
      resumeFindOverlay();
      if (!matches.length) return;
      const start = matches[matchIndex];
      const end = start + findInput.value.length;
      applyReplacement(start, end, replaceInput.value);
      afterEdit();
      computeMatches();
      if (matches.length) {
        let i = matches.findIndex((p) => p >= start);
        if (i < 0) i = 0;
        matchIndex = i;
        updateFindCount();
        renderHighlights();
        revealRange(matches[matchIndex], matches[matchIndex] + findInput.value.length);
      }
    }

    async function replaceAll(): Promise<void> {
      resumeFindOverlay();
      if (!findInput.value || !matches.length || replaceAllBtn.classList.contains('is-loading')) return;
      const n = matches.length;
      replaceAllBtn.classList.add('is-loading');
      replaceAllBtn.disabled = true;
      replaceAllBtn.innerHTML = '<span class="btn-spinner"></span>';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const re = new RegExp(escapeRe(findInput.value), caseSensitive ? 'g' : 'gi');
        const replaced = source.value.replace(re, () => replaceInput.value);
        applyReplacement(0, source.value.length, replaced);
        afterEdit();
        computeMatches();
        status.textContent = `Replaced ${n} match${n === 1 ? '' : 'es'}`;
      } finally {
        replaceAllBtn.classList.remove('is-loading');
        replaceAllBtn.textContent = 'All';
        updateFindCount();
      }
    }

    function toggleFind(forceOpen?: boolean): void {
      const open = !!(forceOpen ?? findBar.hidden);
      if (findRefresh) {
        clearTimeout(findRefresh);
        findRefresh = null;
      }
      findBar.hidden = !open;
      findToggle.classList.toggle('is-active', open);
      sourceWrap.classList.toggle('is-finding', open);
      if (!open) {
        renderHighlights();
        source.style.height = '';
        source.focus();
        return;
      }
      autoGrow();
      const sel = source.value.slice(source.selectionStart, source.selectionEnd);
      if (sel && !sel.includes('\n')) findInput.value = sel;
      computeMatches();
      if (matches.length) {
        const s = matches[matchIndex];
        revealRange(s, s + findInput.value.length);
      }
      findInput.focus();
      findInput.select();
    }

    caseBtn.addEventListener('click', () => {
      caseSensitive = !caseSensitive;
      caseBtn.classList.toggle('is-active', caseSensitive);
      runFind();
    });
    prevBtn.addEventListener('click', () => gotoMatch(-1));
    nextBtn.addEventListener('click', () => gotoMatch(1));
    replaceBtn.addEventListener('click', replaceCurrent);
    replaceAllBtn.addEventListener('click', replaceAll);
    findClose.addEventListener('click', () => toggleFind(false));
    findInput.addEventListener('input', runFind);
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        gotoMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleFind(false);
      }
    });
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleFind(false);
      }
    });
    editor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleFind(true);
      }
    });

    // --- sidebar (a tree of collections → pages) ---
    type BulkItem = {
      id: string;
      type: 'collection' | 'page';
      realId: string;
      colId?: string;
    };
    const CK = (id: string): string => `c:${id}`;
    const PK = (id: string): string => `p:${id}`;
    // These are the `remove` the shared multi-select commits with, so they must THROW when
    // the store delete fails: the undo toast is what says so, and the repaint brings the row
    // back (#288). No swallow is needed for a double-delete either — the routes are
    // idempotent, so an id that is already gone (a page deleted by its own collection's
    // cascade in the same batch) resolves ok. Swallowing everything hid real failures: the
    // row vanished, the user was told it was deleted, and the item was back after a reload
    // (#947). The caches are only touched AFTER the store commit succeeds.
    const removePageCommit = async (id: string, colId: string): Promise<void> => {
      await jsonApi('DELETE', `pages/${id}`);
      const arr = pagesByCol.get(colId);
      if (arr)
        pagesByCol.set(
          colId,
          arr.filter((p) => p.id !== id),
        );
      const col = collections.find((c) => c.id === colId);
      if (col && typeof col.pageCount === 'number') col.pageCount = Math.max(0, col.pageCount - 1);
      if (current?.id === id) {
        current = null;
        showPlaceholder();
      }
    };
    const removeCollectionCommit = async (id: string): Promise<void> => {
      await jsonApi('DELETE', `collections/${id}`);
      collections = collections.filter((c) => c.id !== id);
      pagesByCol.delete(id);
      expanded.delete(id);
      if (current?.collectionId === id) {
        current = null;
        showPlaceholder();
      }
    };
    const bulk = createBulkSelect({
      owner: layout,
      noun: 'item',
      remove: (entry) => {
        const e = entry as unknown as BulkItem;
        return e.type === 'collection' ? removeCollectionCommit(e.realId) : removePageCommit(e.realId, e.colId!);
      },
      onChange: () => drawSidebar(),
    });
    const visibleItems = (): BulkItem[] => {
      const items: BulkItem[] = [];
      for (const col of collections) {
        if (bulk.isPending(CK(col.id))) continue;
        items.push({ id: CK(col.id), type: 'collection', realId: col.id });
        if (!expanded.has(col.id)) continue;
        for (const p of pagesByCol.get(col.id) || []) {
          if (!bulk.isPending(PK(p.id))) items.push({ id: PK(p.id), type: 'page', realId: p.id, colId: col.id });
        }
      }
      return items;
    };

    let dragPageId: string | null = null;
    let dragFromCol: string | null = null;
    const clearDropTargets = (): void =>
      sidebar.querySelectorAll('.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));

    function pageRow(page: PageMeta, colId: string): HTMLElement {
      if (bulk.isSelecting()) {
        const key = PK(page.id);
        const viaCol = bulk.isChecked(CK(colId));
        const checked = viaCol || bulk.isChecked(key);
        const item = el('div', 'doc-page-item doc-page-select' + (checked ? ' is-selected' : ''));
        const cb = el('input', 'doc-page-check');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.disabled = viaCol;
        const toggle = (): void => {
          if (viaCol) return;
          bulk.setChecked(key, !bulk.isChecked(key));
          drawSidebar();
        };
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', toggle);
        item.append(cb, el('span', 'doc-page-title', page.title || 'Untitled'));
        if (!viaCol) item.addEventListener('click', toggle);
        return item;
      }

      const item = el('div', 'doc-page-item' + (page.id === current?.id ? ' is-active' : ''));
      item.dataset.id = page.id;
      item.draggable = true;

      const open = el('button', 'doc-page-open');
      open.title = 'Click to open · drag to another collection · right-click for options';
      open.append(el('span', 'doc-page-title', page.title || 'Untitled'));
      open.addEventListener('click', () => {
        openPage(page.id);
        if (narrow) layout.classList.add('collapsed');
      });
      item.append(open);

      item.addEventListener('dragstart', (e) => {
        dragPageId = page.id;
        dragFromCol = colId;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', page.title || 'page');
        }
        item.classList.add('is-dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
        clearDropTargets();
        dragPageId = null;
        dragFromCol = null;
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items: ContextMenuItem[] = [
          // A sibling page in the same collection — the same action the collection's
          // menu offers, so it is reachable from whichever row you right-clicked (#621).
          { label: 'New page', icon: PLUS, onClick: () => newPage(colId) },
          { separator: true },
          { label: 'Rename', icon: PENCIL, onClick: () => renamePage(page as Page, colId) },
          { label: 'Download (.md)', icon: DOWNLOAD, onClick: () => downloadPage(page.id) },
          { label: 'Export as PDF', icon: DOWNLOAD, onClick: () => exportPagePdf(page.id) },
        ];
        if (collections.length > 1)
          items.push({ label: 'Move to collection…', icon: FOLDER, onClick: () => promptMovePage(page, colId) });
        items.push(
          { separator: true },
          { label: 'Delete', icon: TRASH, danger: true, onClick: () => deletePage(page, colId) },
        );
        openContextMenu(e.clientX, e.clientY, items, { owner: layout });
      });
      return item;
    }

    function makeDropTarget(node: HTMLElement, colId: string): void {
      node.addEventListener('dragover', (e) => {
        if (!dragPageId || dragFromCol === colId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        node.classList.add('is-drop-target');
      });
      node.addEventListener('dragleave', (e) => {
        if (!node.contains(e.relatedTarget as Node | null)) node.classList.remove('is-drop-target');
      });
      node.addEventListener('drop', (e) => {
        if (!dragPageId || dragFromCol === colId) return;
        e.preventDefault();
        node.classList.remove('is-drop-target');
        const id = dragPageId;
        const from = dragFromCol;
        if (!from) return;
        const entry = (pagesByCol.get(from) || []).find((p) => p.id === id) || { id };
        movePage(entry, from, colId);
      });
    }

    function collectionEl(col: Collection): HTMLElement {
      const isOpen = expanded.has(col.id);
      const hasCurrent = current?.collectionId === col.id;
      const selecting = bulk.isSelecting();
      const ckey = CK(col.id);
      const colEl = el('div', 'doc-collection' + (isOpen ? ' is-expanded' : '') + (hasCurrent ? ' is-active' : ''));

      const row = el('div', 'doc-collection-row' + (selecting && bulk.isChecked(ckey) ? ' is-selected' : ''));
      if (selecting) {
        const cb = el('input', 'doc-collection-check');
        cb.type = 'checkbox';
        cb.checked = bulk.isChecked(ckey);
        const toggle = (): void => {
          bulk.setChecked(ckey, !bulk.isChecked(ckey));
          for (const p of pagesByCol.get(col.id) || []) bulk.setChecked(PK(p.id), false);
          drawSidebar();
        };
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', toggle);
        row.append(cb);
        bulk.bindRow(row, ckey);
      }
      const icon = el('span', 'doc-collection-icon');
      icon.innerHTML = FOLDER;
      const pageCount = pagesByCol.get(col.id)?.length ?? col.pageCount;

      const open = el('button', 'doc-collection-open');
      open.title = 'Click to open · right-click for options';
      open.append(
        icon,
        el('span', 'doc-collection-name', col.name || 'Untitled'),
        el('span', 'doc-collection-count', String(pageCount)),
      );
      open.addEventListener('click', () => toggleExpand(col.id));
      row.append(open);

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(
          e.clientX,
          e.clientY,
          [
            { label: 'New page', icon: PLUS, onClick: () => newPage(col.id) },
            { separator: true },
            { label: 'Export as Book', icon: BOOK, onClick: () => enterBookView(col.id) },
            { label: 'Rename', icon: PENCIL, onClick: () => renameCollection(col) },
            { label: 'Download (.zip)', icon: DOWNLOAD, onClick: () => downloadCollection(col.id) },
            { label: 'Export as PDF', icon: DOWNLOAD, onClick: () => exportCollectionPdf(col.id) },
            { separator: true },
            { label: 'Delete', icon: TRASH, danger: true, onClick: () => deleteCollection(col.id) },
          ],
          { owner: layout },
        );
      });

      colEl.append(row);
      makeDropTarget(colEl, col.id);

      if (isOpen) {
        const pagesList = el('div', 'doc-page-list');
        for (const page of (pagesByCol.get(col.id) || []).filter((p) => !bulk.isPending(PK(p.id))))
          pagesList.append(pageRow(page, col.id));
        if (!bulk.isSelecting()) {
          const addPage = el('button', 'doc-add-page');
          addPage.innerHTML = `${PLUS}<span>New page</span>`;
          addPage.addEventListener('click', () => newPage(col.id));
          pagesList.append(addPage);
        }
        colEl.append(pagesList);
      }
      return colEl;
    }

    function drawSidebar(): void {
      const head = el('div', 'doc-sidebar-head');
      head.append(el('span', 'doc-sidebar-title', 'Notes'));
      const addCol = iconButton(PLUS, { title: 'New collection', onClick: newCollection, className: 'doc-new' });
      head.append(addCol);

      const list = el('div', 'doc-collection-list');
      list.dataset.bulkList = '';
      for (const col of collections.filter((c) => !bulk.isPending(CK(c.id)))) list.append(collectionEl(col));
      const items = visibleItems();
      const children: HTMLElement[] = [head];
      if (items.length || bulk.isSelecting()) children.push(bulk.controls(items));
      children.push(list);
      sidebar.replaceChildren(...children);
    }

    async function renameCollection(col: Collection): Promise<void> {
      const name = await promptTitle('Collection name', col.name || '');
      if (name == null) return;
      try {
        await jsonApi('PATCH', `collections/${col.id}`, { name: name || 'Untitled collection' });
        col.name = name || 'Untitled collection';
        drawSidebar();
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      }
    }

    async function downloadPage(id: string): Promise<void> {
      let title: string | undefined;
      let content: string;
      if (current && current.id === id) {
        title = current.title || 'Untitled';
        content = source.value;
      } else {
        try {
          const page = (await getApi(`pages/${id}`)) as Page;
          title = page.title;
          content = page.content || '';
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : String(err);
          return;
        }
      }
      const safe = safeFilename(title ?? '', 'page');
      downloadBlob(new Blob([mdHeading(title) + content], { type: 'text/markdown' }), `${safe}.md`);
    }

    async function downloadCollection(colId: string): Promise<void> {
      const col = collections.find((c) => c.id === colId);
      await flushSave();
      if (!pagesByCol.has(colId)) await loadPages(colId);
      const pageList = pagesByCol.get(colId) || [];
      if (!pageList.length) {
        status.textContent = 'This collection has no pages to download.';
        return;
      }
      const folder = safeFilename(col?.name ?? '', 'collection');
      const used = new Set<string>();
      const files: { name: string; data: string }[] = [];
      for (const p of pageList) {
        const page =
          current && current.id === p.id
            ? { title: current.title || 'Untitled', content: source.value }
            : ((await getApi(`pages/${p.id}`)) as Page);
        const title = page.title || 'Untitled';
        const base = safeFilename(title, 'page');
        let name = base;
        let i = 2;
        while (used.has(name.toLowerCase())) name = `${base}-${i++}`;
        used.add(name.toLowerCase());
        files.push({ name: `${folder}/${name}.md`, data: mdHeading(title) + (page.content || '') });
      }
      const { zipStore } = await import('../../lib/zip.js');
      downloadBlob(zipStore(files), `${folder}.zip`);
    }

    async function exportPagePdf(id: string): Promise<void> {
      let title: string | undefined;
      let content: string;
      if (current && current.id === id) {
        title = current.title || 'Untitled';
        content = source.value;
      } else {
        try {
          const page = (await getApi(`pages/${id}`)) as Page;
          title = page.title;
          content = page.content || '';
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : String(err);
          return;
        }
      }
      printHtml(title || 'Untitled', bookSectionHtml({ title, content }, parseMd));
    }

    async function exportCollectionPdf(colId: string): Promise<void> {
      const col = collections.find((c) => c.id === colId);
      await flushSave();
      if (!pagesByCol.has(colId)) await loadPages(colId);
      const list = pagesByCol.get(colId) || [];
      if (!list.length) {
        status.textContent = 'This collection has no pages to export.';
        return;
      }
      const fulls = (
        await Promise.all(list.map((p) => (getApi(`pages/${p.id}`) as Promise<Page>).catch(() => null)))
      ).filter(Boolean) as Page[];
      const ordered = fulls.reverse();
      const inner = ordered
        .map((p) => `<section class="doc-print-page">${bookSectionHtml(p, parseMd)}</section>`)
        .join('');
      printHtml(col?.name || 'Collection', inner);
    }

    // --- data ---
    async function loadPages(colId: string): Promise<void> {
      try {
        pagesByCol.set(colId, ((await getApi(`collections/${colId}/pages`)) as { pages?: PageMeta[] }).pages || []);
      } catch {
        pagesByCol.set(colId, []);
      }
    }

    async function toggleExpand(colId: string): Promise<void> {
      if (expanded.has(colId)) {
        expanded.delete(colId);
        drawSidebar();
        return;
      }
      expanded.add(colId);
      if (!pagesByCol.has(colId)) await loadPages(colId);
      drawSidebar();
    }

    async function openPage(id: string): Promise<void> {
      await flushSave();
      try {
        current = (await getApi(`pages/${id}`)) as Page;
      } catch (err) {
        main.replaceChildren(el('p', 'app-error', err instanceof Error ? err.message : String(err)));
        return;
      }
      expanded.add(current.collectionId);
      rememberPage(current.collectionId, current.id);
      setTitleText();
      source.value = current.content || '';
      updateCount();
      // A different page shares no blocks with the last one, so start its preview
      // (and its block cache) clean rather than diffing across the switch.
      resetPreview();
      if (!findBar.hidden) computeMatches();
      renderPreview();
      status.textContent = '';
      drawSidebar();
      main.replaceChildren(editor);
      requestAnimationFrame(() => {
        if (findBar.hidden) source.style.height = '';
        else autoGrow();
        sourceWrap.scrollTop = 0;
        source.scrollTop = 0;
      });
    }

    async function newPage(colId: string): Promise<void> {
      await flushSave();
      const title = await promptTitle('Name your page', '');
      if (title == null) return;
      // The right-click menus reach a collection that was never expanded, so its pages
      // may not be cached yet — prepending to an absent list would hide them (#621).
      if (!pagesByCol.has(colId)) await loadPages(colId);
      const page = (await jsonApi('POST', `collections/${colId}/pages`, {
        title: title || 'Untitled',
        content: '',
      })) as Page;
      pagesByCol.set(colId, [
        { id: page.id, title: page.title, updated: page.updated },
        ...(pagesByCol.get(colId) || []),
      ]);
      expanded.add(colId);
      current = page;
      drawSidebar();
      await openPage(page.id);
      requestAnimationFrame(() => source.focus());
    }

    async function newCollection(): Promise<void> {
      await flushSave();
      const name = await promptTitle('Name your collection', '');
      if (name == null) return;
      const col = (await jsonApi('POST', 'collections', { name: name || 'New collection' })) as Collection;
      collections = [{ id: col.id, name: col.name, updated: col.updated, pageCount: 0 }, ...collections];
      pagesByCol.set(col.id, []);
      expanded.add(col.id);
      current = null;
      drawSidebar();
      showPlaceholder();
    }

    async function deleteCollection(id: string): Promise<void> {
      const col = collections.find((c) => c.id === id);
      if (!(await confirmDialog(`Delete "${col?.name || 'this collection'}" and all its pages?`, { owner: layout })))
        return;
      await flushSave();
      if (!pagesByCol.has(id)) await loadPages(id);
      const snapshot = await Promise.all(
        (pagesByCol.get(id) || []).map((p) => (getApi(`pages/${p.id}`) as Promise<Page>).catch(() => null)),
      );
      await jsonApi('DELETE', `collections/${id}`);
      collections = collections.filter((c) => c.id !== id);
      pagesByCol.delete(id);
      expanded.delete(id);
      if (current?.collectionId === id) current = null;
      drawSidebar();
      if (current) main.replaceChildren(editor);
      else if (collections.length) showPlaceholder();
      else showEmpty();
      showUndo(`Deleted "${col?.name || 'collection'}"`, async () => {
        const newCol = (await jsonApi('POST', 'collections', {
          name: col?.name || 'Untitled collection',
        })) as Collection;
        for (const page of [...snapshot].reverse()) {
          if (page)
            await jsonApi('POST', `collections/${newCol.id}/pages`, { title: page.title, content: page.content });
        }
        await loadCollections();
      });
    }

    function showEmpty(): void {
      const wrap = el('div', 'doc-empty');
      wrap.append(el('p', 'placeholder-lead', 'No collections yet. Create one for a book or topic.'));
      const create = el('button', 'button-primary', 'New collection');
      create.addEventListener('click', newCollection);
      wrap.append(create);
      main.replaceChildren(wrap);
    }

    // The hamburger that reopens a collapsed sidebar lives in the editor toolbar,
    // which is only mounted while a page is open. So with no page open AND the
    // sidebar collapsed — which every window under SIDEBAR_DOCK is, including the
    // 720px one every app mounts at — the placeholder told the user to open a page
    // from a sidebar they had no way to reach (#912). Carry the affordance here.
    function showPlaceholder(): void {
      const collapsed = layout.classList.contains('collapsed');
      const wrap = el('div', 'doc-empty doc-placeholder');
      wrap.append(
        el(
          'p',
          'placeholder-lead',
          collapsed
            ? 'Browse your collections to open a page, or add one to a collection.'
            : 'Open a page from the sidebar, or add one to a collection.',
        ),
      );
      if (collapsed) {
        const browse = el('button', 'button-primary doc-browse', 'Browse collections');
        browse.addEventListener('click', toggleSidebar);
        wrap.append(browse);
      }
      main.replaceChildren(wrap);
    }

    // The placeholder's wording and its Browse button depend on whether the
    // sidebar is showing, so repaint it whenever that changes under it (resizing
    // the window across SIDEBAR_DOCK, or toggling the sidebar by hand).
    function refreshPlaceholder(): void {
      if (main.firstElementChild?.classList.contains('doc-placeholder')) showPlaceholder();
    }

    async function loadCollections(): Promise<void> {
      try {
        collections = ((await getApi('collections')) as { collections?: Collection[] }).collections || [];
      } catch (err) {
        main.replaceChildren(el('p', 'app-error', err instanceof Error ? err.message : String(err)));
        return;
      }
      if (!collections.length) {
        drawSidebar();
        showEmpty();
      } else {
        // A handoff wins over the session (the user just asked for that collection); otherwise
        // reopen where they were, falling back to the first collection when it is gone.
        let openCol = pendingCollectionId ?? restored?.collectionId ?? null;
        pendingCollectionId = null;
        if (!openCol || !collections.some((c) => c.id === openCol)) openCol = collections[0].id;
        expanded.add(openCol);
        await loadPages(openCol);
        drawSidebar();
        const pages = pagesByCol.get(openCol) || [];
        // The remembered page, if it is still there — otherwise the first, exactly as before.
        const target = pages.find((p) => p.id === restored?.pageId) ?? pages[0];
        if (target) await openPage(target.id);
        else showPlaceholder();
      }
      if (pendingNewCollection) {
        pendingNewCollection = false;
        await newCollection();
      }
    }

    loadCollections();

    return () => {
      ro.disconnect();
      wrapRo.disconnect();
      if (saveTimer) clearTimeout(saveTimer);
      if (previewTimer) clearTimeout(previewTimer);
      if (findRefresh) clearTimeout(findRefresh);
      cancelAnimationFrame(syncFrame);
    };
  },
};
