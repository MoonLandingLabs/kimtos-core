// NotaBoard — an infinite whiteboard for notes, sketches, and quick diagrams
// (Notability-style), fully on-device. The left sidebar lists your boards; the
// main area is a pen/shape/text canvas. Drawing + the scene engine live in
// engine.js; board CRUD lives in notaboard.local.js (IndexedDB). This file is
// the UI: the boards sidebar, the tool/properties toolbar, and autosave.

import { resolvedTheme } from '../../lib/theme.js';
import './notaboard.css';
import { getApi, jsonApi } from '../../lib/api.js';
import { createListWidget } from '../../components/widgetCard.js';
import { dataStore } from '../../lib/dataStore.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { createResizer } from '../../components/resizer.js';
import { createPopover } from '../../components/popover.js';
import { confirmDialog } from '../../components/confirm.js';
import { promptDialog } from '../../components/promptDialog.js';
import { openContextMenu } from '../../components/contextMenu.js';
import { el } from '../../lib/dom.js';
import { downloadBlob, safeFilename } from '../../lib/download.js';
import { TRASH, PLUS, BURGER, DOWNLOAD, PENCIL, COPY, iconButton } from '../../components/icons.js';
import { createBoard } from './engine.js';
import appMeta from './meta.js';

const ACCENT = appMeta.accent;
const NARROW = 720; // below this, the boards sidebar becomes an overlay

// Tool palette. `key` is the engine tool id; icons are inline SVGs.
const I = (body: string, sw = 1.7): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TOOLS = [
  { key: 'select', name: 'Select  (V)', icon: I('<path d="M5 3l5.8 16 2.2-6.6L19.8 10z"/>') },
  { key: 'pen', name: 'Pen  (P)', icon: I('<path d="M3 21l3.8-1 11-11a2 2 0 0 0-3-3l-11 11z"/><path d="M14 6l3 3"/>') },
  {
    key: 'highlighter',
    name: 'Highlighter  (H)',
    icon: I('<path d="M4 20h5"/><path d="M14 4l6 6-8 8H7l-2-2z"/><path d="M11 7l6 6"/>'),
  },
  {
    key: 'eraser',
    name: 'Eraser  (E)',
    icon: I('<path d="M4 15l7-7 6 6-5 5H7z"/><path d="M9 21h11"/><path d="M11 8l6 6"/>'),
  },
  { key: 'line', name: 'Line  (L)', icon: I('<path d="M5 19L19 5"/>') },
  { key: 'arrow', name: 'Arrow  (A)', icon: I('<path d="M5 19L19 5"/><path d="M11 5h8v8"/>') },
  { key: 'rect', name: 'Rectangle  (R)', icon: I('<rect x="4" y="6" width="16" height="12" rx="2"/>') },
  { key: 'ellipse', name: 'Ellipse  (O)', icon: I('<ellipse cx="12" cy="12" rx="8" ry="6.5"/>') },
  { key: 'text', name: 'Text  (T)', icon: I('<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>') },
  {
    key: 'note',
    name: 'Sticky note  (N)',
    icon: I('<path d="M5 4h14v10l-5 5H5z"/><path d="M14 19v-5h5"/>'),
  },
];

const PEN_COLORS = ['#1f2937', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];
const SIZES = [
  { v: 2, name: 'Thin', r: 2.5 },
  { v: 4, name: 'Medium', r: 4 },
  { v: 8, name: 'Thick', r: 6 },
];
const PAPERS = [
  { v: 'grid', name: 'Grid' },
  { v: 'dots', name: 'Dots' },
  { v: 'lines', name: 'Lines' },
  { v: 'plain', name: 'Plain' },
];

// Drawing tools that carry a colour/thickness popover (Notability-style), and
// which palette they use ('pen' presets, or the sticky-note pastels).
const STYLE_POP: Record<string, string> = {
  pen: 'pen',
  highlighter: 'pen',
  line: 'pen',
  arrow: 'pen',
  rect: 'pen',
  ellipse: 'pen',
  text: 'pen',
  note: 'note',
};

const IMAGE_ICON = I(
  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
);
const UNDO_ICON = I('<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/>');
const REDO_ICON = I('<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/>');
const FIT_ICON = I(
  '<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>',
);
const FRONT_ICON = I('<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M3 9v10a2 2 0 0 0 2 2h10"/>');
// Sliders icon for the page-setup popover (paper · theme · navigator).
const PAGE_ICON = I(
  '<path d="M4 6h8M16 6h4"/><circle cx="14" cy="6" r="2"/><path d="M4 12h2M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h10M18 18h2"/><circle cx="16" cy="18" r="2"/>',
);
const BACK_ICON = I('<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M21 9v10a2 2 0 0 1-2 2H9"/>');

const fmtDate = (ts?: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Set by the home widget so the next open jumps straight to a board.
let pendingBoardId: string | null = null;

type Board = ReturnType<typeof createBoard>;
type BoardElements = Parameters<Board['setElements']>[0];
interface BoardMeta {
  id: string;
  title?: string;
  updated?: number;
  thumb?: string;
  [key: string]: unknown;
}
interface BoardRecord {
  id: string;
  title?: string;
  updated?: number;
  paper?: string;
  theme?: string;
  elements?: unknown[];
  thumb?: string;
  [key: string]: unknown;
}

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'A whiteboard for notes, sketches and quick diagrams',
  tip: 'Draw with the pen, drop shapes, text or sticky notes, and paste images. Each board autosaves. Hold Space and drag to pan; ⌘/Ctrl+scroll to zoom.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tools.
  tools: [
    {
      name: 'list_boards',
      description: 'List whiteboards (with their id).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { boards } = (await getApi('boards')) as { boards?: BoardRecord[] };
        const list = (boards || []).map((b) => `${b.id} · ${b.title}`).join('\n') || '(none)';
        return { ok: true, result: list, summary: `${boards?.length || 0} board(s)` };
      },
    },
    {
      name: 'create_board',
      description: 'Create a new (empty) whiteboard with a title.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      run: async (args: Record<string, unknown>) => {
        const b = (await jsonApi('POST', 'boards', {
          title: String(args.title || 'Untitled board'),
          theme: resolvedTheme(),
        })) as BoardRecord;
        return { ok: true, result: `Created board "${b.title}".`, summary: `created "${b.title}"` };
      },
    },
    {
      name: 'get_board',
      description: 'Get one whiteboard by id: its title, paper style, and how many elements it holds.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const b = (await getApi(`boards/${String(args.id)}`)) as BoardRecord;
        const count = Array.isArray(b.elements) ? b.elements.length : 0;
        return {
          ok: true,
          result: `"${b.title}" — ${count} element(s), ${b.paper || 'grid'} paper.`,
          summary: `"${b.title}" (${count} elements)`,
        };
      },
    },
    {
      name: 'rename_board',
      description: 'Rename a whiteboard (id from list_boards).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' } },
        required: ['id', 'title'],
      },
      run: async (args: Record<string, unknown>) => {
        const b = (await jsonApi('PATCH', `boards/${String(args.id)}`, {
          title: String(args.title || ''),
        })) as BoardRecord;
        return { ok: true, result: `Renamed to "${b.title}".`, summary: `renamed to "${b.title}"` };
      },
    },
    {
      name: 'delete_board',
      description: 'Delete a whiteboard (id from list_boards).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `boards/${String(args.id)}`);
        return { ok: true, result: 'Board deleted.', summary: 'deleted a board' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall).
  dataLabel: 'whiteboards',
  hasData: () => dataStore.hasAny('boards'),
  async clearData() {
    // Remove every board's inserted images, then the boards themselves.
    await dataStore.clearBlobsByPrefix('notaboard/');
    await dataStore.clearCollection('boards');
  },

  // Home card: your most recent boards.
  widgetLabel: 'Pin boards',
  widgetHint: 'Show your recent whiteboards on the home',
  async widget(ctx: { openApp: (id: string) => void }): Promise<HTMLElement | null> {
    let boards: BoardRecord[];
    try {
      boards = ((await getApi('boards')) as { boards?: BoardRecord[] }).boards || [];
    } catch {
      return null;
    }
    if (!boards.length) return null;

    return createListWidget({
      title: 'NotaBoard',
      accent: ACCENT,
      count: boards.length,
      onOpen: () => ctx.openApp('notaboard'),
      items: boards.map((b) => ({
        label: b.title || 'Untitled board',
        title: b.title || 'Untitled board',
        onClick: () => {
          pendingBoardId = b.id;
          ctx.openApp('notaboard');
        },
      })),
      more: {
        label: '+ New board',
        onClick: () => {
          pendingBoardId = 'new';
          ctx.openApp('notaboard');
        },
      },
    });
  },

  render(body: HTMLElement) {
    let boards: BoardMeta[] = [];
    let currentId: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let narrow = false;
    let board: Board | null = null; // the engine instance

    // --- layout shell ---
    const layout = el('div', 'notaboard-layout');
    const sidebar = el('aside', 'nb-sidebar');
    let sidebarWidth = 248;
    sidebar.style.width = `${sidebarWidth}px`;
    const resizer = createResizer({
      layout,
      pane: sidebar,
      min: 200,
      reserve: 460,
      enabled: () => !narrow,
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    const main = el('div', 'nb-main');
    layout.append(sidebar, resizer, main);
    body.replaceChildren(layout);

    const toggleSidebar = (): void => void layout.classList.toggle('collapsed');

    // Sidebar collapses into an overlay on narrow windows.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const isNarrow = w > 0 && w < NARROW;
      if (isNarrow === narrow) return;
      narrow = isNarrow;
      layout.classList.toggle('is-narrow', narrow);
      layout.classList.toggle('collapsed', narrow);
      sidebar.style.width = narrow ? '' : `${sidebarWidth}px`;
    });
    ro.observe(layout);
    layout.addEventListener('click', (e) => {
      if (!narrow || layout.classList.contains('collapsed')) return;
      const t = e.target as Element | null;
      if (t?.closest('.nb-sidebar') || t?.closest('.nb-burger')) return;
      layout.classList.add('collapsed');
    });

    // --- sidebar (boards list) ---
    const bulk = createBulkSelect({
      noun: 'board',
      remove: (b) => deleteBoardCommit(b.id),
      onChange: () => drawSidebar(),
    });

    const sideHead = el('div', 'nb-sidebar-head');
    sideHead.append(el('span', 'nb-sidebar-title', 'Boards'));
    const newBtn = iconButton(PLUS, { title: 'New board', className: 'nb-new', onClick: () => createBoard_() });
    sideHead.append(newBtn);
    const sideList = el('div', 'nb-board-list');
    sidebar.replaceChildren(sideHead, sideList);

    function drawSidebar() {
      const visible = bulk.filterVisible(boards) as BoardMeta[];
      const blocks = [];
      if (visible.length || bulk.isSelecting()) blocks.push(bulk.controls(visible));
      sideHead.replaceChildren(el('span', 'nb-sidebar-title', 'Boards'), newBtn);

      sideList.replaceChildren();
      if (blocks.length) sideList.append(...blocks);
      if (!visible.length) {
        sideList.append(el('p', 'nb-side-empty', 'No boards yet. Create one with ＋.'));
        return;
      }
      for (const b of visible) sideList.append(boardCard(b));
    }

    function boardCard(b: BoardMeta): HTMLElement {
      const selecting = bulk.isSelecting();
      const card = el(
        'div',
        'nb-board-card' + (b.id === currentId ? ' is-active' : '') + (bulk.isChecked(b.id) ? ' is-selected' : ''),
      );
      bulk.bindRow(card, b.id);

      const thumb = el('div', 'nb-board-thumb');
      if (b.thumb) {
        const img = el('img');
        img.src = b.thumb;
        img.alt = '';
        thumb.append(img);
      } else {
        thumb.classList.add('is-empty');
      }
      const meta = el('div', 'nb-board-meta');
      meta.append(
        el('span', 'nb-board-title', b.title || 'Untitled board'),
        el('span', 'nb-board-date', fmtDate(b.updated)),
      );
      card.append(thumb, meta);

      if (selecting) {
        const cb = el('input', 'nb-board-check');
        cb.type = 'checkbox';
        cb.checked = bulk.isChecked(b.id);
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
          bulk.setChecked(b.id, cb.checked);
          drawSidebar();
        });
        card.prepend(cb);
        card.addEventListener('click', () => {
          bulk.setChecked(b.id, !bulk.isChecked(b.id));
          drawSidebar();
        });
        return card;
      }

      card.addEventListener('click', () => openBoard(b.id));
      card.addEventListener('dblclick', (e) => {
        e.preventDefault();
        renameBoard(b);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          { label: 'Rename', icon: PENCIL, onClick: () => renameBoard(b) },
          { label: 'Duplicate', icon: COPY, onClick: () => duplicateBoard(b) },
          { separator: true },
          { label: 'Delete', icon: TRASH, danger: true, onClick: () => deleteBoard(b) },
        ]);
      });
      return card;
    }

    // --- toolbar ---
    // Hidden until a board is mounted (buildToolbar fills it): with no board it would
    // otherwise render as a stray empty bar over the first-run placeholder (#256).
    const toolbar = el('div', 'nb-toolbar');
    toolbar.hidden = true;
    const stage = el('div', 'nb-stage');
    main.replaceChildren(toolbar, stage);

    // One reusable popover (style palette / page-setup), anchored within the bar.
    const popover = createPopover({ host: toolbar, className: 'nb-popover' });

    // A single slim bar (Notability-style): just the tools and a few actions.
    // Colour and thickness are NOT shown inline — they live in a popover that
    // drops down under a drawing tool when you tap it (again) while it's active.
    function buildToolbar() {
      toolbar.replaceChildren();
      popover.close();

      // Boards sidebar toggle (narrow windows only).
      toolbar.append(
        iconButton(BURGER, { title: 'Toggle boards', className: 'nb-act nb-burger', onClick: toggleSidebar }),
      );

      const makeTool = (t: { key: string; name: string; icon: string }): HTMLButtonElement => {
        const styled = !!STYLE_POP[t.key];
        const btn = el('button', 'nb-tool' + (styled ? ' has-style' : ''));
        btn.type = 'button';
        btn.title = t.name;
        btn.setAttribute('aria-label', t.name);
        btn.dataset.tool = t.key;
        btn.innerHTML = t.icon;
        if (styled) btn.append(el('span', 'nb-tool-ink')); // shows the tool's current colour
        btn.addEventListener('click', () => {
          const wasActive = board?.getTool() === t.key;
          board?.setTool(t.key);
          // Tapping an already-active drawing tool again opens its style popover.
          if (styled && wasActive) popover.toggle(btn, (pop) => buildStyle(pop, t.key));
          else popover.close();
        });
        return btn;
      };
      const byKey = (k: string) => TOOLS.find((t) => t.key === k)!;
      toolbar.append(makeTool(byKey('select')), el('span', 'nb-sep'));
      ['pen', 'highlighter', 'eraser'].forEach((k) => toolbar.append(makeTool(byKey(k))));
      toolbar.append(el('span', 'nb-sep'));
      ['line', 'arrow', 'rect', 'ellipse'].forEach((k) => toolbar.append(makeTool(byKey(k))));
      toolbar.append(el('span', 'nb-sep'));
      ['text', 'note'].forEach((k) => toolbar.append(makeTool(byKey(k))));
      const imgBtn = el('button', 'nb-tool');
      imgBtn.type = 'button';
      imgBtn.title = 'Insert image';
      imgBtn.setAttribute('aria-label', 'Insert image');
      imgBtn.innerHTML = IMAGE_ICON;
      imgBtn.addEventListener('click', () => {
        popover.close();
        fileInput.click();
      });
      toolbar.append(imgBtn);

      // --- right-aligned actions ---
      const right = el('div', 'nb-bar-right');

      undoBtn = iconButton(UNDO_ICON, { title: 'Undo (⌘/Ctrl+Z)', className: 'nb-act', onClick: () => board?.undo() });
      redoBtn = iconButton(REDO_ICON, {
        title: 'Redo (⌘/Ctrl+Shift+Z)',
        className: 'nb-act',
        onClick: () => board?.redo(),
      });
      right.append(undoBtn, redoBtn, el('span', 'nb-sep'));

      frontBtn = iconButton(FRONT_ICON, {
        title: 'Bring to front',
        className: 'nb-act',
        onClick: () => board?.bringToFront(),
      });
      backBtn = iconButton(BACK_ICON, {
        title: 'Send to back',
        className: 'nb-act',
        onClick: () => board?.sendToBack(),
      });
      delBtn = iconButton(TRASH, {
        title: 'Delete selection (Del)',
        className: 'nb-act nb-danger',
        onClick: () => board?.deleteSelection(),
      });
      right.append(frontBtn, backBtn, delBtn, el('span', 'nb-sep'));

      const zoomOut = iconButton(I('<circle cx="11" cy="11" r="7"/><path d="M8 11h6"/><path d="M21 21l-4.3-4.3"/>'), {
        title: 'Zoom out',
        className: 'nb-act',
        onClick: () => board?.zoomOut(),
      });
      zoomLabel = el('button', 'nb-zoom-label', '100%');
      zoomLabel.type = 'button';
      zoomLabel.title = 'Reset zoom to 100%';
      zoomLabel.addEventListener('click', () => board?.zoomReset());
      const zoomIn = iconButton(
        I('<circle cx="11" cy="11" r="7"/><path d="M11 8v6"/><path d="M8 11h6"/><path d="M21 21l-4.3-4.3"/>'),
        { title: 'Zoom in', className: 'nb-act', onClick: () => board?.zoomIn() },
      );
      const fit = iconButton(FIT_ICON, {
        title: 'Fit to content',
        className: 'nb-act',
        onClick: () => board?.zoomToFit(),
      });
      right.append(zoomOut, zoomLabel, zoomIn, fit, el('span', 'nb-sep'));

      pageBtn = iconButton(PAGE_ICON, {
        title: 'Page setup (paper · theme · navigator)',
        className: 'nb-act',
        onClick: () => popover.toggle(pageBtn!, buildPage),
      });
      const exportBtn = iconButton(DOWNLOAD, { title: 'Export as PNG', className: 'nb-act', onClick: exportPng });
      right.append(pageBtn, exportBtn);

      toolbar.append(right);
      syncToolbar();
    }

    let undoBtn: HTMLButtonElement | undefined;
    let redoBtn: HTMLButtonElement | undefined;
    let frontBtn: HTMLButtonElement | undefined;
    let backBtn: HTMLButtonElement | undefined;

    // --- full screen ---
    //
    // The CONTROL is the window's, not ours: every app window carries one in its header (#1251).
    // This app used to draw its own and drive the Fullscreen API itself, which meant reaching out
    // of its own root for the shell's window element to do it.
    //
    // What stays is the REACTION, because it is this app's alone: entering full screen collapses
    // the boards sidebar so the canvas gets the space, and the burger reopens it.
    //
    // Asked by containment rather than by the shell's class name — the board needs to know whether
    // it is on the screen, not how windows are labelled.
    const isFullscreen = () => !!document.fullscreenElement?.contains(body);
    const onFsChange = () => {
      if (isFullscreen()) layout.classList.add('collapsed');
      else if (!narrow) layout.classList.remove('collapsed');
    }; // the stage resizes itself via its ResizeObserver
    document.addEventListener('fullscreenchange', onFsChange);
    let delBtn: HTMLButtonElement | undefined;
    let zoomLabel: HTMLButtonElement | undefined;
    let pageBtn: HTMLButtonElement | undefined;

    // Reflect engine state (active tool, each tool's colour, undo/redo and
    // selection availability) onto the slim bar; keep an open palette in sync.
    function syncToolbar() {
      if (!board) return;
      const tool = board.getTool();
      const st = board.getStyle();
      toolbar.querySelectorAll<HTMLElement>('.nb-tool[data-tool]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.tool === tool);
      });
      // Each drawing tool shows its current colour as a small ink underline.
      toolbar.querySelectorAll<HTMLElement>('.nb-tool.has-style').forEach((b) => {
        const ink = b.querySelector<HTMLElement>('.nb-tool-ink');
        if (ink) ink.style.background = b.dataset.tool === 'note' ? st.noteColor : st.color;
      });
      if (undoBtn) undoBtn.disabled = !board.canUndo();
      if (redoBtn) redoBtn.disabled = !board.canRedo();
      const hasSel = board.hasSelection();
      [frontBtn, backBtn, delBtn].forEach((b) => {
        if (b) b.disabled = !hasSel;
      });
      // Close a stale style popover if the active tool moved away from its anchor.
      const anchor = popover.currentAnchor() as HTMLElement | null;
      if (anchor && anchor.dataset.tool && anchor.dataset.tool !== tool) popover.close();
      popover.refresh();
    }

    // --- popover content builders (Notability-style: colour/thickness under a
    // drawing tool, and a page-setup menu under the sliders button). The shared
    // `popover` component owns positioning, lifecycle, and dismissal — these just
    // fill the panel and return a refresh() fn. ---
    function buildStyle(pop: HTMLElement, key: string): () => void {
      const bd = board!;
      const isNote = STYLE_POP[key] === 'note';

      pop.append(el('div', 'nb-pop-label', isNote ? 'Note color' : 'Color'));
      const colorRow = el('div', 'nb-pop-row');
      (isNote ? NOTE_COLORS : PEN_COLORS).forEach((c) => {
        const sw = el('button', 'nb-swatch' + (c === '#ffffff' ? ' is-light' : ''));
        sw.type = 'button';
        sw.style.background = c;
        sw.dataset.color = c;
        sw.title = c;
        sw.addEventListener('click', () => {
          if (isNote) bd.setNoteColor(c);
          else bd.setColor(c);
          syncToolbar();
        });
        colorRow.append(sw);
      });
      if (!isNote) {
        const custom = el('label', 'nb-swatch nb-swatch-custom');
        custom.title = 'Custom color';
        const ci = el('input', 'nb-color-input');
        ci.type = 'color';
        ci.value = bd.getStyle().color;
        ci.addEventListener('input', () => {
          bd.setColor(ci.value);
          syncToolbar();
        });
        custom.append(ci);
        colorRow.append(custom);
      }
      pop.append(colorRow);

      // Thickness (drawing/shape tools; not sticky notes).
      if (!isNote) {
        pop.append(el('div', 'nb-pop-label', 'Thickness'));
        const sizeRow = el('div', 'nb-pop-row');
        SIZES.forEach((s) => {
          const b = el('button', 'nb-psize');
          b.type = 'button';
          b.title = s.name;
          b.dataset.size = String(s.v);
          const bar = el('span', 'nb-psize-bar');
          bar.style.height = `${s.v + 1}px`;
          b.append(bar);
          b.addEventListener('click', () => {
            bd.setSize(s.v);
            syncToolbar();
          });
          sizeRow.append(b);
        });
        pop.append(sizeRow);
      }

      // Fill (rectangles / ellipses).
      if (key === 'rect' || key === 'ellipse') {
        pop.append(el('div', 'nb-pop-label', 'Shape'));
        const fillRow = el('div', 'nb-pop-row');
        const fillBtn = el('button', 'nb-toggle nb-fill', 'Filled');
        fillBtn.type = 'button';
        fillBtn.addEventListener('click', () => {
          bd.setFill(!bd.getStyle().fill);
          syncToolbar();
        });
        fillRow.append(fillBtn);
        pop.append(fillRow);
      }

      // Re-sync active states; the popover component calls this on open + refresh.
      return () => {
        const s = bd.getStyle();
        const cur = (isNote ? s.noteColor : s.color || '').toLowerCase();
        pop
          .querySelectorAll<HTMLElement>('.nb-swatch[data-color]')
          .forEach((x) => x.classList.toggle('is-active', (x.dataset.color || '').toLowerCase() === cur));
        pop
          .querySelectorAll<HTMLElement>('.nb-psize')
          .forEach((x) => x.classList.toggle('is-active', Number(x.dataset.size) === s.size));
        pop.querySelectorAll('.nb-fill').forEach((x) => x.classList.toggle('is-active', !!s.fill));
      };
    }

    function buildPage(pop: HTMLElement): void {
      const bd = board!;
      const chips = (
        label: string,
        items: [string, string][],
        current: () => string,
        onPick: (v: string) => void,
      ): void => {
        pop.append(el('div', 'nb-pop-label', label));
        const row = el('div', 'nb-pop-row');
        items.forEach(([v, lbl]) => {
          const b = el('button', 'nb-chip' + (v === current() ? ' is-active' : ''), lbl);
          b.type = 'button';
          b.dataset.v = v;
          b.addEventListener('click', () => {
            onPick(v);
            row
              .querySelectorAll<HTMLElement>('.nb-chip')
              .forEach((x) => x.classList.toggle('is-active', x.dataset.v === current()));
          });
          row.append(b);
        });
        pop.append(row);
      };
      chips(
        'Paper',
        PAPERS.map((p) => [p.v, p.name]),
        () => bd.getPaper(),
        (v) => {
          bd.setPaper(v);
          scheduleSave();
        },
      );
      chips(
        'Theme',
        [
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        () => bd.getTheme(),
        (v) => {
          bd.setTheme(v);
          scheduleSave();
          syncToolbar();
        },
      );
      pop.append(el('div', 'nb-pop-label', 'Navigator'));
      const navRow = el('div', 'nb-pop-row');
      const navBtn = el(
        'button',
        'nb-toggle' + (bd.isMinimapOn() ? ' is-active' : ''),
        bd.isMinimapOn() ? 'Shown' : 'Hidden',
      );
      navBtn.type = 'button';
      navBtn.addEventListener('click', () => {
        bd.setMinimap(!bd.isMinimapOn());
        navBtn.classList.toggle('is-active', bd.isMinimapOn());
        navBtn.textContent = bd.isMinimapOn() ? 'Shown' : 'Hidden';
      });
      navRow.append(navBtn);
      pop.append(navRow);
    }

    // --- image insert (button + paste) ---
    const fileInput = el('input', 'nb-file-input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) await insertImage(file);
    });
    main.append(fileInput);

    async function insertImage(file: File): Promise<void> {
      if (!currentId || !board) return;
      try {
        const dims = await imageDims(file);
        const blobKey = `notaboard/${currentId}/${dataStore.uid()}`;
        await dataStore.putBlob(blobKey, file);
        const url = (await dataStore.blobUrl(blobKey)) ?? undefined;
        board.addImageElement({ blobKey, url, w: dims.w, h: dims.h });
      } catch {
        /* unsupported image — ignore */
      }
    }

    const onPaste = (e: ClipboardEvent): void => {
      if (!board || !currentId) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          insertImage(file);
        }
      }
    };
    stage.addEventListener('paste', onPaste);

    // Right-click on the board: element actions if one is under the cursor,
    // otherwise board-wide actions. Replaces the browser's default menu.
    const onContextMenu = (e: MouseEvent): void => {
      if (!board || !currentId) return;
      const bd = board;
      e.preventDefault();
      if (bd.selectAtPoint(e.clientX, e.clientY)) {
        syncToolbar();
        openContextMenu(e.clientX, e.clientY, [
          { label: 'Bring to front', onClick: () => bd.bringToFront() },
          { label: 'Send to back', onClick: () => bd.sendToBack() },
          { label: 'Duplicate', icon: COPY, onClick: () => bd.duplicateSelection() },
          { separator: true },
          { label: 'Delete', icon: TRASH, danger: true, onClick: () => bd.deleteSelection() },
        ]);
      } else {
        openContextMenu(e.clientX, e.clientY, [
          { label: 'Select all', onClick: () => bd.selectAll() },
          { label: 'Fit to content', onClick: () => bd.zoomToFit() },
          { separator: true },
          {
            label: 'Clear board',
            icon: TRASH,
            danger: true,
            onClick: async () => {
              if (await confirmDialog('Clear the whole board? This removes every item.')) bd.clearBoard();
            },
          },
        ]);
      }
    };
    stage.addEventListener('contextmenu', onContextMenu);

    async function exportPng(): Promise<void> {
      if (!board) return;
      const blob = await board.exportPNG();
      if (!blob) return;
      downloadBlob(blob, `${safeFilename(currentTitle() ?? '', 'board')}.png`);
    }

    const currentTitle = (): string | undefined => boards.find((b) => b.id === currentId)?.title;

    // --- board lifecycle ---
    function ensureEngine(): void {
      if (board) return;
      stage.replaceChildren(); // drop any empty-state placeholder before the canvas mounts
      stage.classList.remove('is-empty');
      const bd = createBoard({
        host: stage,
        onChange: () => {
          scheduleSave();
          syncToolbar();
        },
        onSelectionChange: () => syncToolbar(),
        resolveImage: (blobKey: string) => dataStore.blobUrl(blobKey),
      });
      board = bd;
      bd.onToolChange(() => syncToolbar());
      bd.onViewChange(() => {
        if (zoomLabel) zoomLabel.textContent = `${Math.round(bd.getZoom() * 100)}%`;
      });
      buildToolbar();
      toolbar.hidden = false;
    }

    async function openBoard(id: string): Promise<void> {
      if (id === currentId) {
        if (narrow) layout.classList.add('collapsed');
        return;
      }
      await flushSave();
      let rec: BoardRecord;
      try {
        rec = (await getApi(`boards/${id}`)) as BoardRecord;
      } catch {
        return;
      }
      currentId = id;
      ensureEngine();
      const bd = board!;
      bd.setPaper(rec.paper || 'grid');
      bd.setTheme(rec.theme || 'dark');
      bd.setElements((rec.elements || []) as BoardElements);
      bd.setTool('pen');
      stage.classList.remove('is-empty');
      titleInput.value = rec.title || '';
      syncToolbar();
      if (zoomLabel) zoomLabel.textContent = `${Math.round(bd.getZoom() * 100)}%`;
      drawSidebar();
      if (narrow) layout.classList.add('collapsed');
      requestAnimationFrame(() => bd.focus());
    }

    async function createBoard_(): Promise<void> {
      const name = await promptDialog({
        title: 'New board',
        label: 'Board name',
        placeholder: 'Untitled board',
        confirmLabel: 'Create',
      });
      if (name == null) return; // cancelled
      await flushSave();
      let rec;
      try {
        rec = (await jsonApi('POST', 'boards', { title: name, theme: resolvedTheme() })) as BoardRecord;
      } catch {
        return;
      }
      boards.unshift({ id: rec.id, title: rec.title, updated: rec.updated, thumb: '' });
      drawSidebar();
      await openBoard(rec.id);
    }

    async function renameBoard(b: BoardMeta): Promise<void> {
      const name = await promptDialog({
        title: 'Rename board',
        label: 'Board name',
        value: b.title || '',
        confirmLabel: 'Rename',
      });
      if (name == null) return;
      const updated = await (jsonApi('PATCH', `boards/${b.id}`, { title: name }) as Promise<BoardRecord>).catch(
        () => null,
      );
      if (!updated) return;
      b.title = updated.title;
      if (b.id === currentId) titleInput.value = updated.title || '';
      drawSidebar();
    }

    // Duplicate a board (its scene + paper + theme) under a new "(copy)" name.
    async function duplicateBoard(b: BoardMeta): Promise<void> {
      let src: BoardRecord;
      try {
        src = (await getApi(`boards/${b.id}`)) as BoardRecord;
      } catch {
        return;
      }
      let rec: BoardRecord;
      try {
        rec = (await jsonApi('POST', 'boards', {
          title: `${src.title || 'Untitled board'} (copy)`,
          elements: src.elements || [],
          paper: src.paper,
          theme: src.theme,
        })) as BoardRecord;
      } catch {
        return;
      }
      boards.unshift({ id: rec.id, title: rec.title, updated: rec.updated, thumb: src.thumb || '' });
      drawSidebar();
      await openBoard(rec.id);
    }

    // Delete a single board (right-click menu). Goes through the shared multi-select so
    // it gets the same confirm AND the same undo window as the batch delete (#724).
    function deleteBoard(b: BoardMeta): void {
      void bulk.deleteOne(b, {
        confirmMessage: `Delete "${b.title || 'Untitled board'}"?`,
        undoMessage: `"${b.title || 'Untitled board'}" deleted`,
      });
    }

    // This is the `remove` the shared multi-select commits with, so it must THROW when the
    // delete fails: the undo toast is what tells the user, and it repaints the board back
    // (#288). It used to swallow the error, drop the board from the list anyway, and report
    // success for a board that was still in the database.
    async function deleteBoardCommit(id: string): Promise<void> {
      await jsonApi('DELETE', `boards/${id}`);
      boards = boards.filter((b) => b.id !== id);
      if (id === currentId) {
        currentId = null;
        if (board) board.setElements([]);
        stage.classList.add('is-empty');
        titleInput.value = '';
        showPlaceholderOrFirst();
      }
      drawSidebar();
    }

    // --- board title (in the toolbar header strip above the canvas) ---
    const titleBar = el('div', 'nb-titlebar');
    const titleInput = el('input', 'nb-title-input');
    titleInput.placeholder = 'Untitled board';
    titleInput.addEventListener('input', () => {
      const b = boards.find((x) => x.id === currentId);
      if (b) b.title = titleInput.value;
      scheduleSave();
    });
    titleInput.addEventListener('change', () => {
      drawSidebar();
    });
    titleBar.append(titleInput);
    main.insertBefore(titleBar, stage);

    // --- autosave (debounced; persists scene + paper + a fresh thumbnail) ---
    function scheduleSave(): void {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 700);
    }
    async function flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await save();
      }
    }
    async function save() {
      saveTimer = null;
      if (!currentId || !board) return;
      const thumb = board.exportThumbnail();
      const payload = {
        title: titleInput.value,
        elements: board.getElements(),
        paper: board.getPaper(),
        theme: board.getTheme(),
        thumb,
      };
      const updated = await (jsonApi('PATCH', `boards/${currentId}`, payload) as Promise<BoardRecord>).catch(
        () => null,
      );
      if (!updated) return;
      const b = boards.find((x) => x.id === currentId);
      if (b) {
        b.updated = updated.updated;
        b.thumb = thumb;
        b.title = updated.title;
        // Refresh just this card's thumbnail/date without a full re-render
        // (which would steal focus from the title input while typing).
        const card = sideList.querySelector<HTMLElement>(`.nb-board-card[data-bulk-id="${currentId}"]`);
        if (card) refreshCard(card, b);
      }
    }
    function refreshCard(card: HTMLElement, b: BoardMeta): void {
      const thumbEl = card.querySelector('.nb-board-thumb');
      if (thumbEl && b.thumb) {
        thumbEl.classList.remove('is-empty');
        let img = thumbEl.querySelector('img');
        if (!img) {
          img = el('img');
          img.alt = '';
          thumbEl.replaceChildren(img);
        }
        img.src = b.thumb;
      }
      const t = card.querySelector('.nb-board-title');
      if (t) t.textContent = b.title || 'Untitled board';
      const d = card.querySelector('.nb-board-date');
      if (d) d.textContent = fmtDate(b.updated);
    }

    // --- empty / first-run placeholder ---
    function showPlaceholderOrFirst() {
      if (boards.length) {
        openBoard(boards[0].id);
      } else {
        renderEmpty();
      }
    }
    function renderEmpty() {
      // No board open — tear down the engine (its canvas is about to be replaced
      // by the placeholder) so the next create re-mounts a fresh one.
      if (board) {
        board.destroy();
        board = null;
      }
      currentId = null;
      toolbar.hidden = true; // no board → no toolbar (see #256)
      stage.classList.add('is-empty');
      const empty = el('div', 'nb-empty');
      empty.append(
        el('div', 'nb-empty-art', ''),
        el('h3', 'nb-empty-title', 'Your whiteboard, on your device'),
        el('p', 'nb-empty-sub', 'Sketch ideas, jot notes, draw quick diagrams. Nothing leaves your browser.'),
      );
      const cta = el('button', 'button-primary', 'Create your first board');
      cta.addEventListener('click', () => createBoard_());
      empty.append(cta);
      stage.replaceChildren(empty);
    }

    // --- init ---
    async function init() {
      try {
        boards = ((await getApi('boards')) as { boards?: BoardMeta[] }).boards || [];
      } catch {
        boards = [];
      }
      drawSidebar();
      const wanted = pendingBoardId;
      pendingBoardId = null;
      if (wanted === 'new') {
        await createBoard_();
      } else if (wanted && boards.some((b) => b.id === wanted)) {
        await openBoard(wanted);
      } else if (boards.length) {
        await openBoard(boards[0].id);
      } else {
        renderEmpty();
      }
    }
    init();

    // Teardown (appsController calls this on close): flush, drop listeners.
    return () => {
      flushSave();
      popover.close();
      ro.disconnect();
      stage.removeEventListener('paste', onPaste);
      stage.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('fullscreenchange', onFsChange);
      // Leaving full screen is the WINDOW's job now, not this app's (#1251). Closing or minimizing
      // hands the display back; a teardown that does NOT close the window hands it back through
      // `setFullscreenEnabled(false)` instead. A second exit here would be the duplication that
      // control was moved out of the app to end.
      if (board) board.destroy();
      board = null;
    };
  },
};

// Read an image file's natural dimensions (for placing it at a sane size).
function imageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}
