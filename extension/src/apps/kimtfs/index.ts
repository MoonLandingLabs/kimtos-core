// KimtFS — a private on-device file system. A single-pane file explorer: a path bar, a
// listing (columns or grid) with search, sort and keyboard, and a file editor/preview,
// plus right-click context menus. It had a folder-tree sidebar beside it until #271, which
// was a second, worse way to do the navigation the listing already does. Everything is
// stored in the shared IndexedDB via kimtfs.local.ts (`kimtfs-nodes` records +
// `kimtfs:<id>` blobs), so AnubisDB maps it under KimtFS automatically.

import './kimtfs.css';
import { getApi, jsonApi, callApi, fileUrl } from '../../lib/api.js';
import { el, clear, escapeHtml } from '../../lib/dom.js';
import { openContextMenu, type ContextMenuItem } from '../../components/contextMenu.js';
import { confirmDialog } from '../../components/confirm.js';
import { infoDialog } from '../../components/infoDialog.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { createEmptyState } from '../../components/emptyState.js';
import { promptDialog } from '../../components/promptDialog.js';
import { showUndoToast } from '../../components/undoToast.js';
import { createAudioPlayer } from '../../components/audioPlayer.js';
import { createVideoPlayer } from '../../components/videoPlayer.js';
import {
  iconButton,
  BACK,
  FOLDER,
  LIST_VIEW,
  SORT,
  GRID_VIEW,
  PLUS,
  UPLOAD,
  TRASH,
  PENCIL,
  DOWNLOAD,
  OPEN,
  INFO,
  BOOK,
  ARCHIVE,
} from '../../components/icons.js';
import appMeta from './meta.js';
import { setAccent } from '../../lib/accent.js';
import { getAppValue, setAppConfig } from '../../lib/appConfig.js';
import { fileGlyphSvg } from '@kimtos/icons';
import { detectKind, formatJson, hexDump, isTextual, renderPdf, type ViewKind } from './viewer.js';
import { renderMarkdownInto, highlightCode } from '../../lib/markdown.js';
import { MAX_TEXT } from './kimtfs.local.js';
import { buildZip, type ZipEntry } from './zip.js';
import {
  openArchive,
  archiveBaseName,
  canExtract,
  isCompressedArchive,
  planExtraction,
  UnsupportedArchiveError,
  type OpenedArchive,
} from './archive.js';
import { showSnackbar } from '../../components/snackbar.js';
import { kindLabel, sortNodes, searchTree, fmtWhen, type SortKey, type SortDir, type SizeOf } from './listing.js';

const ACCENT = appMeta.accent;
const APP_ID = appMeta.id;

interface Node {
  id: string;
  parentId: string;
  type: 'folder' | 'file';
  name: string;
  kind?: 'text' | 'blob';
  size?: number;
  mime?: string;
  updatedAt?: number;
  text?: string;
  [key: string]: unknown;
}

// List or grid. ONE default, read by the settings schema below and by viewMode() — two copies
// of the word "list" would be two things to keep in step (#219).
type ViewMode = 'list' | 'grid';
const DEFAULT_VIEW: ViewMode = 'list';

const viewMode = (): ViewMode => (getAppValue(APP_ID, 'view', DEFAULT_VIEW) as ViewMode) ?? DEFAULT_VIEW;

// The sort, on the same footing as the view. It used to be a pair of plain `let`s in the
// render closure, so it reset to Name-ascending on every reload while the list/grid choice
// made in the same toolbar survived — two neighbouring preferences disagreeing about whether
// they were worth remembering (#253).
//
// ONE sort for the app, not one per folder. Finder remembers a sort per directory, but that
// needs a store keyed by node id and a rule for what a new folder inherits; a single choice
// is what this listing's size calls for, and it is the mechanism the app already has.
const DEFAULT_SORT: SortKey = 'name';
const DEFAULT_DIR: SortDir = 'asc';
const sortMode = (): SortKey => (getAppValue(APP_ID, 'sort', DEFAULT_SORT) as SortKey) ?? DEFAULT_SORT;
const sortDirection = (): SortDir => (getAppValue(APP_ID, 'sortDir', DEFAULT_DIR) as SortDir) ?? DEFAULT_DIR;

// A row's icon. The kind comes from the viewer's detectKind() — the SAME classification the
// viewer switches on to decide how to open the file — so the icon and the preview can never
// disagree about what a file is, and teaching KimtFS a new extension is one edit, not two
// (#220).
//
// The types do the enforcing: fileGlyphSvg takes a FileKind, so this line only compiles while
// every ViewKind has a glyph. Add an eleventh kind to the viewer and forget to draw it, and
// the typecheck fails here instead of a row silently rendering a blank icon.
const nodeGlyph = (node: Node): string =>
  fileGlyphSvg(node.type === 'folder' ? 'folder' : detectKind(node.name, node.mime));

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

const debounce = <T extends (...a: never[]) => void>(fn: T, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

export default {
  id: appMeta.id,
  name: appMeta.name,
  accent: ACCENT,
  order: appMeta.order,
  // xl, like the other two-pane apps (Notes, NotaBoard). KimtFS was the only app of 19
  // that declared no size at all, so it fell back to the 'md' default — a two-pane explorer
  // opening SMALLER than single-pane apps like Tabs (#188).
  tip: 'Create folders and files, or Upload any file — it all saves on your device and shows up in AnubisDB. Right-click an item to rename, download, or delete.',

  // Declaring the view here is what persists it AND what puts it in Settings ▸ Apps — the
  // toolbar toggle just writes to the same store, so the two cannot disagree (#219).
  settings: [
    {
      key: 'view',
      label: 'View',
      hint: 'How the explorer lists your files. The grid shows a bigger icon per file type; the list shows size, kind and date. The toolbar toggles it too.',
      type: 'select',
      default: DEFAULT_VIEW,
      options: [
        { value: 'list', label: 'List' },
        { value: 'grid', label: 'Grid' },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      hint: 'How the explorer orders a folder. The toolbar Sort menu writes the same setting, so the two cannot disagree.',
      type: 'select',
      default: DEFAULT_SORT,
      options: [
        { value: 'name', label: 'Name' },
        { value: 'size', label: 'Size' },
        { value: 'kind', label: 'Kind' },
        { value: 'modified', label: 'Date modified' },
      ],
    },
    {
      key: 'sortDir',
      label: 'Sort order',
      type: 'select',
      default: DEFAULT_DIR,
      options: [
        { value: 'asc', label: 'Ascending' },
        { value: 'desc', label: 'Descending' },
      ],
    },
  ],

  render(body: HTMLElement, ctx: { openApp?: (id: string) => void } = {}) {
    const openApp = ctx.openApp;
    let nodes: Node[] = [];
    let openId: string | null = null;
    // The themed media player mounted in the preview, if any — the audio waveform player or the
    // video player. Either owns a live <audio>/<video> plus its own listeners (a ResizeObserver
    // and rAF for audio), so it MUST be destroyed when the preview is torn down — navigating
    // away, deleting the file, or closing the window — or it leaks and keeps playing. Only
    // `destroy()` is called here, so the two players' differing shapes share this one slot.
    let activePlayer: { destroy: () => void } | null = null;
    const tearDownPreview = (): void => {
      activePlayer?.destroy();
      activePlayer = null;
    };
    // SELECTION, as its own concept. It used to be a side effect of expanding a folder:
    // clicking a folder both "selected" it and toggled it open, clicking a FILE changed
    // nothing, there was no way back to the root, and the highlight marked the OPEN FILE —
    // so where a new file would land was invisible and usually wrong (#188).
    //
    // '' is the root, and the root is selectable.
    let selectedId = '';
    // The folder the LIST is showing. Selection and location are different things: you can
    // select a folder (so the next New lands in it) without going into it, exactly as in Finder.
    let browseId = '';
    let sortKey: SortKey = sortMode();
    let sortDir: SortDir = sortDirection();
    let query = ''; // the search box; searches the browsed folder and everything under it
    let cursor = 0; // the keyboard's row in the list
    let dragId: string | null = null; // the node being dragged
    const pending = new Set<string>(); // soft-deleted (hidden until the undo toast commits)

    const byId = (id: string): Node | undefined => nodes.find((n) => n.id === id);

    // Where a new file/folder/upload lands: the selected folder, or the selected file's
    // parent ("create beside this"), or the root. This is the answer the path bar shows.
    function createParent(): string {
      if (!selectedId) return '';
      const n = byId(selectedId);
      if (!n) return '';
      return n.type === 'folder' ? n.id : (n.parentId ?? '');
    }

    // The chain of folders from the root down to `id`, for the path bar.
    function trail(id: string): Node[] {
      const out: Node[] = [];
      let cur = byId(id);
      while (cur) {
        out.unshift(cur);
        cur = cur.parentId ? byId(cur.parentId) : undefined;
      }
      return out;
    }

    // Move a node into a folder. The data model always supported this (`parentId`, and the
    // PATCH route already refuses to move a folder into its own subtree) — nothing in the UI
    // ever reached it (#188).
    async function move(id: string, parentId: string): Promise<void> {
      const node = byId(id);
      if (!node || (node.parentId ?? '') === parentId) return;
      // Refuse client-side too, so the user gets no jarring error for an obvious mistake.
      if (node.type === 'folder' && (id === parentId || descendantIds(id).includes(parentId))) return;
      await jsonApi('PATCH', `kimtfs/nodes/${id}`, { parentId });
      await reload();
    }

    // Wire a row (or the root) as a drop target: it accepts a dragged node, and files
    // dragged in from the desktop.
    function asDropTarget(elm: HTMLElement, folderId: string): void {
      elm.addEventListener('dragover', (e) => {
        e.preventDefault(); // without this the drop never fires
        e.stopPropagation();
        elm.classList.add('is-drop');
        if (e.dataTransfer) e.dataTransfer.dropEffect = dragId ? 'move' : 'copy';
      });
      elm.addEventListener('dragleave', () => elm.classList.remove('is-drop'));
      elm.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        elm.classList.remove('is-drop');

        // From the desktop: the bytes go straight into IndexedDB, never over a network.
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) {
          void uploadFiles(files, folderId);
          return;
        }
        // From inside the tree: a move.
        const id = dragId || e.dataTransfer?.getData('text/plain') || '';
        dragId = null;
        if (id) void move(id, folderId);
      });
    }

    // Select a node. `browse` also GOES INTO it (the crumbs, a double-click in the
    // list) — which closes any open file, so clicking a folder always takes you back to a
    // listing. A plain select (a single click on a list row) only moves the highlight.
    function select(id: string, browse = false): void {
      selectedId = id;
      if (browse) {
        const n = id ? byId(id) : null;
        if (!id || n?.type === 'folder') {
          browseId = id;
          openId = null;
          cursor = 0;
          query = '';
        }
      }
      renderPath();
      if (browse) void renderMain();
    }

    // What the list shows: a search hit list, or the contents of the browsed folder, sorted.
    const listRows = (): Node[] =>
      query.trim()
        ? sortNodes(
            searchTree(nodes, browseId, query).filter((n) => !pending.has(n.id) && !bulk.isPending(n.id)),
            sortKey,
            sortDir,
            sizeOf,
          )
        : sortNodes(childrenOf(browseId), sortKey, sortDir, sizeOf);
    const childrenOf = (id: string): Node[] =>
      nodes
        // Hide anything mid-undo — from a single delete (`pending`) OR a batch one
        // (bulkSelect keeps its own pending set). Miss the second and a batch-deleted row
        // sits there looking alive until the toast commits.
        .filter((n) => n.parentId === id && !pending.has(n.id) && !bulk.isPending(n.id))
        .sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.name.localeCompare(b.name));
    const descendantIds = (id: string): string[] => {
      const out: string[] = [];
      const walk = (pid: string) => {
        for (const c of nodes.filter((n) => n.parentId === pid)) {
          out.push(c.id);
          if (c.type === 'folder') walk(c.id);
        }
      };
      walk(id);
      return out;
    };

    // A folder's size is the sum of everything inside it — what the list's Size column
    // shows for a folder instead of a bare dash (#620). Files carry their own `size`;
    // folders carry none, so a folder without this reads as sizeless.
    const folderSize = (id: string): number => descendantIds(id).reduce((n, cid) => n + (byId(cid)?.size || 0), 0);

    // ONE definition of a node's effective size, shared by the Size column and the Size
    // sort so they can never disagree (#645): a file's own size, a folder's aggregate.
    const sizeOf: SizeOf = (n) => (n.type === 'folder' ? folderSize(n.id) : n.size || 0);

    // ── layout: one pane, the explorer ─────────────────────────────────────
    // There WAS a 240px folder-tree sidebar here, with a resizer and a burger to hide it. It
    // went (#271): the explorer moved into this pane — a real listing with a path bar, search,
    // sort, a grid and per-type icons — so the tree was a second, worse way to do the same
    // navigation. What only the tree could do was moved here first, not dropped: multi-select
    // and batch delete now live in the list, and the path bar takes drops so a file can still
    // be dragged OUT of a folder.
    const layout = el('div', 'kimtfs');
    setAccent(layout, ACCENT);
    const main = el('div', 'kimtfs-main');
    // The path bar tracks the SELECTION, not the open file, because its job is to answer
    // "where will my next file land?" — which was previously unanswerable (#188).
    const pathBar = el('div', 'kimtfs-path');
    const mainBody = el('div', 'kimtfs-main-body');
    // The status bar is Finder's: how many items you are looking at, and how much room is left.
    const statusBar = el('div', 'kimtfs-statusbar');
    main.append(pathBar, mainBody, statusBar);
    layout.append(main);
    body.replaceChildren(layout);

    async function load(): Promise<void> {
      const r = (await getApi('kimtfs/nodes')) as { nodes: Node[] };
      nodes = r.nodes;
    }
    async function reload(): Promise<void> {
      await load();
      // a deleted/renamed ancestor changes the trail, and a deleted selection must not
      // leave the path bar pointing at something that no longer exists
      if (selectedId && !byId(selectedId)) selectedId = '';
      // and a deleted folder must not leave the list stranded inside something that is gone
      if (browseId && !byId(browseId)) browseId = '';
      renderPath();
      void renderMain();
    }

    // Multi-select + batch delete (convention 2). A file manager where you delete files one
    // at a time, each with its own undo toast, is the most obviously missing thing in the app
    // (#188). createBulkSelect gives the Select/Done toggle, select-all, "Delete (N)", ONE
    // confirm, ONE undo, and mouse drag-to-select — none of it hand-rolled.
    const bulk = createBulkSelect({
      owner: layout,
      noun: 'item',
      // Commits ONE delete. The route cascades, so deleting a folder takes its subtree with
      // it; a child selected alongside its parent is simply already gone, and the route
      // answers ok for a node that no longer exists.
      remove: async (entry) => {
        await jsonApi('DELETE', `kimtfs/nodes/${entry.id}`);
      },
      onChange: () => {
        void reload();
      },
    });

    // ── path bar ─────────────────────────────────────────────────────────
    // Root > Documents > Music, each segment clickable. The last segment is where a new
    // file goes; a selected FILE shows its parent chain plus itself, and new items land
    // beside it. Each crumb also TAKES A DROP, which is how a file gets back out of a
    // folder now that the tree is gone (#271).
    function renderPath(): void {
      clear(pathBar);
      const crumbs: { id: string; name: string }[] = [
        { id: '', name: 'KimtFS' },
        ...trail(selectedId).map((n) => ({ id: n.id, name: n.name })),
      ];

      crumbs.forEach((c, i) => {
        if (i) pathBar.append(el('span', 'kimtfs-crumb-sep', '›'));
        const b = el('button', `kimtfs-crumb${i === crumbs.length - 1 ? ' is-current' : ''}`) as HTMLButtonElement;
        b.type = 'button';
        b.textContent = c.name;
        b.addEventListener('click', () => select(c.id, true));
        // Drop a file on a crumb to move it THERE. This is how you get a file back OUT of a
        // folder: the list only accepts drops onto folders inside the folder you are already
        // looking at, so before this the only way "up" was the sidebar's root row — and the
        // sidebar is gone (#271). Finder's path bar takes drops for exactly this reason.
        asDropTarget(b, c.id);
        pathBar.append(b);
      });

      // Say plainly where the next New lands — the whole point of the bar.
      const target = createParent();
      const targetName = target ? (byId(target)?.name ?? 'KimtFS') : 'KimtFS';
      pathBar.append(el('span', 'kimtfs-path-hint', `New items go to ${targetName}`));
    }

    // ── context menus ────────────────────────────────────────────────────
    function rootMenuItems(parentId = ''): ContextMenuItem[] {
      return [
        { label: 'New file', icon: PLUS, onClick: () => createFile(parentId) },
        { label: 'New folder', icon: FOLDER, onClick: () => createFolder(parentId) },
        { label: 'Upload files…', icon: UPLOAD, onClick: () => pickUpload(parentId) },
      ];
    }
    function nodeMenuItems(node: Node): ContextMenuItem[] {
      const items: ContextMenuItem[] = [];
      if (node.type === 'folder') {
        items.push(
          { label: 'New file', icon: PLUS, onClick: () => createFile(node.id) },
          { label: 'New folder', icon: FOLDER, onClick: () => createFolder(node.id) },
          { label: 'Upload here…', icon: UPLOAD, onClick: () => pickUpload(node.id) },
        );
      } else {
        items.push({ label: 'Open', icon: OPEN, onClick: () => openFile(node.id) });
        if (node.kind === 'blob') items.push({ label: 'Download', icon: DOWNLOAD, onClick: () => download(node) });
        // A real file manager unpacks from the menu, without opening anything first — but only
        // for a format we can honestly open offline (zip, tar, gz, tgz). A `.7z`/`.rar` is still
        // an archive to the viewer, which says so; it just has no Extract action here.
        if (canExtract(node.name)) {
          const base = archiveBaseName(node.name) || 'Archive';
          items.push(
            { label: 'Extract Here', icon: ARCHIVE, onClick: () => void extract(node, 'here') },
            { label: `Extract to “${base}”/`, icon: ARCHIVE, onClick: () => void extract(node, 'folder') },
          );
        }
      }
      // Compressing an already-compressed file is pointless — deflate can't shrink it, so
      // it just wraps it in a bigger container. Offer it for folders and ordinary files
      // (a bare .tar included: it is uncompressed, so zipping it genuinely helps).
      if (!(node.type === 'file' && isCompressedArchive(node.name))) {
        items.push({ label: 'Compress to ZIP', icon: BOOK, onClick: () => void compress(node) });
      }
      items.push(
        { separator: true },
        { label: 'Get Info', icon: INFO, onClick: () => properties(node) },
        { label: 'Rename…', icon: PENCIL, onClick: () => rename(node) },
        { label: 'Delete', icon: TRASH, danger: true, onClick: () => void remove(node) },
      );
      return items;
    }
    function newMenu(e: MouseEvent, parentId: string): void {
      openContextMenu(e.clientX, e.clientY, [
        { label: 'New file', icon: PLUS, onClick: () => createFile(parentId) },
        { label: 'New folder', icon: FOLDER, onClick: () => createFolder(parentId) },
      ]);
    }

    // ── actions ────────────────────────────────────────────────────────────
    async function createFolder(parentId: string): Promise<void> {
      const name = await promptDialog({ title: 'New folder', value: 'New folder' });
      if (name == null) return;
      const made = (await jsonApi('POST', 'kimtfs/folders', { parentId, name })) as Node;
      await reload();
      if (made?.id) select(made.id); // select what you just made — the next New lands inside it
    }
    async function createFile(parentId: string): Promise<void> {
      const name = await promptDialog({ title: 'New file', value: 'Untitled.txt' });
      if (name == null) return;
      const file = (await jsonApi('POST', 'kimtfs/files', { parentId, name })) as Node;
      await load();
      openFile(file.id);
    }
    // The one upload path — the file picker and a drop from the desktop both land here.
    // The bytes go straight into this browser's IndexedDB. They are never sent anywhere:
    // there is no upload endpoint, because there is no server.
    async function uploadFiles(files: File[], parentId: string): Promise<void> {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('parentId', parentId);
        await callApi('kimtfs/upload', fd);
      }
      await reload();
    }

    function pickUpload(parentId: string): void {
      const input = el('input', '') as HTMLInputElement;
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', async () => {
        await uploadFiles(Array.from(input.files || []), parentId);
      });
      input.click();
    }
    async function rename(node: Node): Promise<void> {
      const name = await promptDialog({ title: 'Rename', value: node.name });
      if (name == null || !name.trim() || name === node.name) return;
      await jsonApi('PATCH', `kimtfs/nodes/${node.id}`, { name });
      await load();
      if (openId === node.id) renderMain();
    }
    function download(node: Node): void {
      (async () => {
        const url = (await fileUrl(`kimtfs/blob/${node.id}`)) as string | null;
        if (!url) return;
        const a = el('a', '') as HTMLAnchorElement;
        a.href = url;
        a.download = node.name;
        a.click();
      })();
    }
    // ASK FIRST, then soft-delete with an undo.
    //
    // This used to delete on the spot and rely on a 6-second toast: right-click a folder,
    // Delete, and the entire subtree was gone unless you noticed the toast in time. It is a
    // recursive delete on the local-first file system — those bytes are in this browser and
    // nowhere else, so a miss is permanent. Every other app confirms before a destructive
    // delete (Notes, AnubisDB, Clipboard, KimtAI); this one did not (#188).
    //
    // Convention 2: ONE confirm, then ONE undo. The undo stays — it catches the "yes, but
    // not that one" mistake the confirm cannot.
    async function remove(node: Node): Promise<void> {
      const ids = [node.id, ...(node.type === 'folder' ? descendantIds(node.id) : [])];
      const extra = ids.length - 1;
      const what =
        node.type === 'folder' && extra > 0
          ? `Delete “${node.name}” and the ${extra} item${extra === 1 ? '' : 's'} inside it?`
          : `Delete “${node.name}”?`;
      if (!(await confirmDialog(`${what} This cannot be undone once the undo window passes.`, { owner: layout })))
        return;

      // EVERY change to `pending` is followed by a repaint, and the real delete is followed by
      // a reload. The listing filters `pending` out, so without the repaint the data was right
      // and the screen was stale: the row you just deleted sat there until you reopened the app
      // (#274). The batch-delete path has always done this (bulkSelect's onChange -> reload);
      // single delete was the odd one out.
      ids.forEach((id) => pending.add(id));
      // The viewer must close FIRST if it is showing the file being deleted — then the list
      // underneath it repaints.
      if (openId && ids.includes(openId)) openId = null;
      void renderMain();

      showUndoToast(`Deleted “${node.name}”`, {
        duration: 6000,
        onUndo: () => {
          ids.forEach((id) => pending.delete(id));
          void renderMain(); // put the row back on screen, not just in the set
        },
        onCommit: async () => {
          if (!pending.has(node.id)) return;
          ids.forEach((id) => pending.delete(id));
          await jsonApi('DELETE', `kimtfs/nodes/${node.id}`); // cascades server-side
          // RELOAD, not just repaint. Clearing `pending` un-hides the row, and the in-memory
          // `nodes` array still holds the node we just deleted — so the next repaint from any
          // unrelated click would put a file that NO LONGER EXISTS back on the screen.
          await reload();
        },
        // If the delete throws, the file is still there — say so, and put its row back (#288).
        commitErrorMessage: `“${node.name}” couldn't be deleted. It is still here.`,
        onCommitError: () => {
          ids.forEach((id) => pending.delete(id));
          void reload();
        },
      });
    }

    // Show an uploaded file — whatever it is. Everything renders from the bytes already in
    // IndexedDB. Nothing is fetched, nothing leaves the device.
    async function renderBlob(host: HTMLElement, node: Node, url: string | null): Promise<void> {
      const kind: ViewKind = detectKind(node.name, node.mime || '');

      if (url && kind === 'image') {
        const img = el('img', 'kimtfs-img') as HTMLImageElement;
        img.src = url;
        host.append(img);
        return;
      }
      if (url && kind === 'audio') {
        // The same themed waveform player Denoise and Voice Studio use — not the raw
        // browser <audio controls> pill, which ignored the theme. Torn down on navigation.
        const player = createAudioPlayer(url);
        activePlayer = player;
        host.append(player.el);
        return;
      }
      if (url && kind === 'video') {
        // The same themed player vidrec uses — its own play/pause, seek, time and fullscreen —
        // not the raw browser <video controls>, which ignored the theme. Torn down on navigation.
        const player = createVideoPlayer(url);
        activePlayer = player;
        host.append(player.el);
        return;
      }
      if (!url) {
        host.append(el('p', 'kimtfs-filemeta', 'The bytes for this file are missing.'));
        return;
      }

      // The object URL points at the blob already in IndexedDB — reading it back is a local
      // read, not a network request.
      const blob = await (await fetch(url)).blob();

      if (kind === 'pdf') {
        const pages = el('div', 'kimtfs-pdf');
        host.append(pages);
        try {
          await renderPdf(pages, await blob.arrayBuffer());
        } catch {
          pages.append(el('p', 'kimtfs-filemeta', "This PDF couldn't be rendered. Download it to open it elsewhere."));
        }
        return;
      }

      // Only the files too big to EDIT land here — renderMain opens a textual upload in the
      // editor instead, so this stays the read-only path for the rest.
      if (isTextual(kind)) {
        host.append(textView(kind, await blob.text(), node.name));
        return;
      }

      if (kind === 'archive') {
        await renderArchive(host, node, new Uint8Array(await blob.arrayBuffer()));
        return;
      }

      // Unknown type: a hex dump beats an icon. You can see the magic bytes, or that the
      // file is empty, or that it is really text in disguise.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      host.append(
        el('p', 'kimtfs-filemeta', `${node.mime || 'Unknown type'} · ${fmtBytes(node.size || 0)}`),
        el('pre', 'kimtfs-hex', hexDump(bytes)),
      );
    }

    // A syntax-coloured code block. The highlighter is the app's ONE highlighter — the same
    // highlight.js instance and palette that renders a fenced block inside a Markdown file
    // (lib/markdown.ts), so a `.ts` file and the same code in a note look identical and a
    // language is registered in one place. Its output is escaped by highlight.js, which is
    // what makes assigning it to innerHTML safe on an untrusted file (#651).
    // `lang` is a language name or a bare file extension — highlight.js resolves both.
    function codeBlock(text: string, lang: string): HTMLElement {
      const pre = el('pre', 'kimtfs-code');
      pre.innerHTML = highlightCode(text, lang);
      return pre;
    }

    // The language to colour a file in: its extension, which is the same thing detectKind()
    // classifies it by, so the icon, the viewer and the colouring can never disagree.
    const langOf = (name: string): string => (name.split('.').pop() ?? '').toLowerCase();

    // A read view for anything textual. JSON is pretty-printed — and an INVALID .json shows
    // the parse error, because that is usually why you opened it.
    function textView(kind: ViewKind, text: string, name = ''): HTMLElement {
      const wrap = el('div', 'kimtfs-textview');
      if (kind === 'json') {
        const r = formatJson(text);
        if (r.ok) {
          wrap.append(codeBlock(r.text, 'json'));
          return wrap;
        }
        wrap.append(el('p', 'kimtfs-json-err', `Invalid JSON: ${r.error}`), codeBlock(text, 'json'));
        return wrap;
      }
      // Markdown renders through the shared SAFE renderer — the same one KimtAI uses, so
      // there is one Markdown implementation, not two. A file is untrusted input, so this
      // path escapes raw HTML and neutralises unsafe link/image URLs (see lib/markdown.ts).
      // The raw source is still one Edit click away.
      if (kind === 'markdown') {
        const md = el('div', 'md-preview');
        renderMarkdownInto(md, text);
        wrap.append(md);
        return wrap;
      }
      wrap.append(kind === 'text' ? el('pre', 'kimtfs-plain', text) : codeBlock(text, langOf(name)));
      return wrap;
    }

    // ── main: the column list ──────────────────────────────────────────────
    // The view a file manager is actually made of. The main pane used to hold one sentence
    // ("Select a file to view or edit it") until you opened a file, so the app's whole surface
    // was a 240px tree: no columns, no sizes, no dates, no sorting, no search (#188).
    const COLUMNS: { key: SortKey; label: string }[] = [
      { key: 'name', label: 'Name' },
      { key: 'size', label: 'Size' },
      { key: 'kind', label: 'Kind' },
      { key: 'modified', label: 'Modified' },
    ];

    // The sort, for a view that has no column header to click. The grid has no columns, so
    // without this there is no way to sort in it at all — you had to switch to the list, sort,
    // and switch back (#237).
    //
    // Built FROM `COLUMNS` and dispatching TO `sortBy` — the same list the header renders and
    // the same call the header makes. A private list of sort options would drift the moment a
    // column was added, and private sort logic would let the menu and the header disagree
    // about what sorting means. Choosing the active field reverses it here exactly as clicking
    // the active column does there, because it is the same function.
    function openSortMenu(e: MouseEvent): void {
      const mark = (key: SortKey): string => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      openContextMenu(
        e.clientX,
        e.clientY,
        COLUMNS.map((c) => ({
          label: `${c.label}${mark(c.key)}`,
          onClick: () => sortBy(c.key),
        })),
      );
    }

    function sortBy(key: SortKey): void {
      // Clicking the active column reverses it; a new column starts ascending — except the
      // two where "most" is the interesting end, which is what every file manager does.
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = key;
        sortDir = key === 'size' || key === 'modified' ? 'desc' : 'asc';
      }
      // Same store the Settings ▸ Apps controls write, so the toolbar and Settings can never
      // hold different answers — and the choice outlives the session (#253).
      void setAppConfig(APP_ID, 'sort', sortKey);
      void setAppConfig(APP_ID, 'sortDir', sortDir);
      void renderMain();
    }

    function renderList(toolbar: HTMLElement): void {
      const here = browseId ? byId(browseId) : undefined;

      if (browseId) {
        toolbar.append(
          iconButton(BACK, {
            title: 'Up one folder',
            onClick: () => select(here?.parentId ?? '', true),
            className: 'kimtfs-ib',
          }),
        );
      }
      toolbar.append(el('span', 'kimtfs-tb-title', here?.name ?? 'KimtFS'), el('span', 'kimtfs-tb-spacer'));

      // Search — the app had none. It looks through this folder AND everything under it.
      const search = el('input', 'kimtfs-search') as HTMLInputElement;
      search.type = 'search';
      search.placeholder = here ? `Search ${here.name}` : 'Search KimtFS';
      search.value = query;
      // Typing repaints the ROWS, never the toolbar. It used to call renderMain(), which
      // starts with clear(mainBody) and rebuilds this very input from scratch — so ~200ms
      // after each keystroke the element you were typing into was destroyed. Focus went to
      // <body> and every character after the first was swallowed: you could type exactly one
      // letter, ever (#217). Restoring focus afterwards would only paper over it; a query
      // change was never a structural change, so it must not touch the chrome.
      const onQuery = debounce(() => {
        cursor = 0;
        paintRows();
      }, 200);
      search.addEventListener('input', () => {
        query = search.value;
        onQuery();
      });
      toolbar.append(search);
      toolbar.append(
        iconButton(PLUS, {
          title: 'New…',
          onClick: (e) => newMenu(e as MouseEvent, createParent()),
          className: 'kimtfs-ib',
        }),
        // In BOTH views: the list keeps its clickable column header (that is the gesture people
        // reach for), and the grid finally has a sort at all.
        iconButton(SORT, {
          title: 'Sort',
          onClick: (e) => openSortMenu(e as MouseEvent),
          className: 'kimtfs-ib',
        }),
        iconButton(viewMode() === 'grid' ? LIST_VIEW : GRID_VIEW, {
          title: viewMode() === 'grid' ? 'List view' : 'Grid view',
          onClick: () => {
            void setViewMode(viewMode() === 'grid' ? 'list' : 'grid');
          },
          className: 'kimtfs-ib',
        }),
        iconButton(UPLOAD, {
          title: 'Upload files',
          onClick: () => pickUpload(createParent()),
          className: 'kimtfs-ib',
        }),
      );
      mainBody.append(toolbar);

      // The list is a drop target: dropping into the folder you are LOOKING at is the obvious
      // gesture.
      const listEl = el('div', 'kimtfs-list');
      listEl.tabIndex = 0; // so it can take the keyboard
      asDropTarget(listEl, browseId);

      // The rows the list is currently SHOWING. The keyboard handler is bound once, below,
      // so it has to read the rows as they are now — bind it to the array from the first
      // paint and the arrow keys would walk the pre-search list after a filter.
      let rows: Node[] = [];

      function paintRows(): void {
        rows = listRows();
        clear(listEl);
        const grid = viewMode() === 'grid';
        listEl.classList.toggle('is-grid', grid);

        // Multi-select + batch delete (convention 2), which used to hang off the SIDEBAR and
        // would have died with it (#271). The bar acts on the rows actually on screen — which
        // now correctly means "this folder, or the current search hits", because listRows() is
        // what the view is painted from. The tree could only ever offer its own expanded rows.
        listEl.append(bulk.controls(bulk.filterVisible(rows)));

        // The sort controls live in the column header, and a grid has no columns. Your sort is
        // remembered, so switching back to the list restores it (#219).
        if (!grid) {
          const head = el('div', 'kimtfs-lrow kimtfs-lhead');
          for (const c of COLUMNS) {
            const th = el('button', `kimtfs-lcell kimtfs-l-${c.key}${sortKey === c.key ? ' is-sorted' : ''}`);
            (th as HTMLButtonElement).type = 'button';
            th.textContent = c.label;
            if (sortKey === c.key) th.append(el('span', 'kimtfs-sortmark', sortDir === 'asc' ? '▲' : '▼'));
            th.addEventListener('click', () => sortBy(c.key));
            head.append(th);
          }
          listEl.append(head);
        }

        if (!rows.length) {
          // A search with no hits has nothing to offer but different words; an empty
          // folder has a way out, so it gets the button that opens the same New menu as
          // the toolbar's + (createParent() keeps it pointing at the folder you are in).
          listEl.append(
            query.trim()
              ? createEmptyState({
                  icon: fileGlyphSvg('text'),
                  title: `Nothing matches “${query.trim()}”`,
                  message: 'Try a shorter search, or clear it to see everything in this folder.',
                })
              : createEmptyState({
                  icon: fileGlyphSvg('folder'),
                  title: 'This folder is empty',
                  message: 'Create a file or folder to get started — or drop files straight in.',
                  actionLabel: 'New file or folder',
                  onAction: (e) => newMenu(e, createParent()),
                }),
          );
        }

        cursor = Math.min(cursor, Math.max(0, rows.length - 1));
        if (grid) {
          const tiles = el('div', 'kimtfs-grid');
          rows.forEach((n, i) => tiles.append(gridTile(n, i === cursor)));
          listEl.append(tiles);
        } else {
          rows.forEach((n, i) => listEl.append(listRow(n, i === cursor)));
        }
        // The arrow keys are useless if the row they land on is below the fold.
        requestAnimationFrame(() => listEl.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' }));

        void updateStatus(rows.length);
      }

      listEl.addEventListener('keydown', (e) => onListKey(e, rows));
      listEl.addEventListener('contextmenu', (e) => {
        if (e.target !== listEl) return;
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, rootMenuItems(browseId));
      });

      paintRows();
      mainBody.append(listEl);
    }

    // Everything an item DOES, wherever it is drawn. A row and a grid tile are the same thing
    // in two shapes: both drag, both take a drop when they are a folder, both select on click,
    // open on double-click, and offer the same menu on right-click. Copying that into the tile
    // builder would be a second copy of the interaction, and the two would drift the first time
    // one of them was touched (#219). The builders below differ only in MARKUP.
    function wireItem(item: HTMLElement, node: Node): void {
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        dragId = node.id;
        e.dataTransfer?.setData('text/plain', node.id);
        item.classList.add('is-dragging');
      });
      item.addEventListener('dragend', () => {
        dragId = null;
        item.classList.remove('is-dragging');
      });
      if (node.type === 'folder') asDropTarget(item, node.id);

      // Single click selects, double click opens — the file-manager gesture. (The sidebar
      // keeps its single-click-to-open, because a tree row is a shortcut, not a listing.)
      item.addEventListener('click', () => {
        cursor = listRows().findIndex((n) => n.id === node.id);
        select(node.id);
        void renderMain();
      });
      item.addEventListener('dblclick', () => activate(node));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        select(node.id);
        openContextMenu(e.clientX, e.clientY, nodeMenuItems(node));
      });
    }

    /** The classes every item carries, so selection reads identically in both views. */
    const itemState = (node: Node, isCursor: boolean): string =>
      [node.id === selectedId ? 'is-selected' : '', isCursor ? 'is-cursor' : ''].filter(Boolean).join(' ');

    /** The tick-box, in Select mode. Both views get one: a grid is a list, and convention 2
     *  does not exempt it. `bindRow` is what makes drag-to-select work. */
    function bulkBox(item: HTMLElement, node: Node): HTMLElement | null {
      bulk.bindRow(item, node.id); // press-and-drag across items to select a run of them
      if (!bulk.isSelecting()) return null;
      const cb = Object.assign(el('input', 'kimtfs-cb'), { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = bulk.isChecked(node.id);
      cb.addEventListener('click', (e) => e.stopPropagation()); // ticking is not selecting
      cb.addEventListener('change', () => {
        bulk.setChecked(node.id, cb.checked);
        void renderMain(); // the same repaint the row builders use elsewhere
      });
      return cb;
    }

    function listRow(node: Node, isCursor: boolean): HTMLElement {
      const row = el('div', `kimtfs-lrow ${itemState(node, isCursor)}`.trim());

      const name = el('div', 'kimtfs-lcell kimtfs-l-name');
      const cb = bulkBox(row, node);
      if (cb) name.append(cb);
      const ic = el('span', 'kimtfs-ic');
      ic.innerHTML = nodeGlyph(node);
      name.append(ic, el('span', 'kimtfs-name', node.name));
      // In a search, a bare name is ambiguous — three files called report.txt look identical.
      // Say which folder each one is in.
      if (query.trim()) {
        const where = trail(node.parentId)
          .map((n) => n.name)
          .join(' › ');
        name.append(el('span', 'kimtfs-lwhere', where || 'KimtFS'));
      }
      row.append(
        name,
        el('div', 'kimtfs-lcell kimtfs-l-size', fmtBytes(sizeOf(node))),
        el('div', 'kimtfs-lcell kimtfs-l-kind', kindLabel(node)),
        el('div', 'kimtfs-lcell kimtfs-l-modified', fmtWhen(node.updatedAt)),
      );

      wireItem(row, node);
      return row;
    }

    // The same item as a tile: the type glyph big enough to actually read, and the name under
    // it. Nothing about what it DOES lives here — that is wireItem's job.
    function gridTile(node: Node, isCursor: boolean): HTMLElement {
      const tile = el('div', `kimtfs-tile ${itemState(node, isCursor)}`.trim());
      tile.title = node.name;

      const cb = bulkBox(tile, node);
      if (cb) tile.append(cb);
      const ic = el('span', 'kimtfs-tile-ic');
      ic.innerHTML = nodeGlyph(node);
      tile.append(ic, el('span', 'kimtfs-tile-name', node.name));

      wireItem(tile, node);
      return tile;
    }

    // Enter / double-click: a folder is somewhere you go, a file is something you open.
    function activate(node: Node): void {
      if (node.type === 'folder') {
        select(node.id, true);
      } else {
        select(node.id);
        openFile(node.id);
      }
    }

    // A file manager you cannot drive from the keyboard is a toy. Arrows move, Enter opens,
    // Backspace goes up a level, Delete deletes (through the same confirm as everything else).
    function onListKey(e: KeyboardEvent, rows: Node[]): void {
      const step = (d: number): void => {
        e.preventDefault();
        cursor = Math.min(Math.max(0, cursor + d), Math.max(0, rows.length - 1));
        const at = rows[cursor];
        if (at) select(at.id);
        void renderMain();
      };
      const node = rows[cursor];
      // The cursor is an INDEX, so the same step works in both views. A grid reads
      // left-to-right, so Left/Right walk it there the way Up/Down walk the list (#219).
      if (e.key === 'ArrowDown') step(1);
      else if (e.key === 'ArrowUp') step(-1);
      else if (e.key === 'ArrowRight' && viewMode() === 'grid') step(1);
      else if (e.key === 'ArrowLeft' && viewMode() === 'grid') step(-1);
      else if (e.key === 'Enter' && node) {
        e.preventDefault();
        activate(node);
      } else if (e.key === 'Delete' && node) {
        e.preventDefault();
        void remove(node);
      } else if (e.key === 'Backspace' && browseId) {
        e.preventDefault();
        select(byId(browseId)?.parentId ?? '', true);
      }
    }

    // ── archives ───────────────────────────────────────────────────────────
    // Compressing and extracting are what every file manager does, and for a local-first app
    // they are also the way a folder of files gets OUT in one piece. It all happens in this
    // tab: the bytes are already in IndexedDB, the browser's own deflate does the work, and
    // the finished archive is saved back as an ordinary file. Nothing is uploaded to be zipped.

    // Read a node's bytes, whichever way it stores them.
    async function bytesOf(node: Node): Promise<Uint8Array> {
      if (node.kind === 'text') return new TextEncoder().encode(String(node.text ?? ''));
      const url = (await fileUrl(`kimtfs/blob/${node.id}`)) as string | null;
      if (!url) return new Uint8Array(0);
      return new Uint8Array(await (await fetch(url)).arrayBuffer());
    }

    // Flatten a subtree into archive entries. An empty folder gets a directory entry of its
    // own, or it would simply cease to exist on the way through the zip.
    async function entriesFor(node: Node, prefix = ''): Promise<ZipEntry[]> {
      if (node.type === 'file') return [{ path: `${prefix}${node.name}`, data: await bytesOf(node) }];
      const kids = nodes.filter((n) => n.parentId === node.id && !pending.has(n.id));
      const here = `${prefix}${node.name}/`;
      if (!kids.length) return [{ path: here, data: new Uint8Array(0) }];
      const out: ZipEntry[] = [];
      for (const k of kids) out.push(...(await entriesFor(k, here)));
      return out;
    }

    async function compress(node: Node): Promise<void> {
      showSnackbar(`Compressing “${node.name}”…`);
      try {
        const entries = await entriesFor(node);
        const zip = await buildZip(entries);
        const base = node.type === 'folder' ? node.name : node.name.replace(/\.[^.]+$/, '');
        const parentId = node.parentId ?? '';
        // Straight back in through the ordinary upload route — a generated archive is just a
        // file, and gets the same storage, the same viewer and the same Download button.
        const fd = new FormData();
        fd.append('file', new File([zip as BlobPart], `${base}.zip`, { type: 'application/zip' }));
        fd.append('parentId', parentId);
        await callApi('kimtfs/upload', fd);
        await reload();
        showSnackbar(`Compressed to “${base}.zip” (${fmtBytes(zip.length)})`);
      } catch (err) {
        console.error('KimtFS: compressing failed', err);
        showSnackbar('That could not be compressed.');
      }
    }

    // Where an extraction lands. 'folder' recreates the archive in a new `<name>` folder beside
    // it (the safe default, then selects it); 'here' unpacks straight into the archive's parent.
    type ExtractDest = 'folder' | 'here';

    // Unpack an archive. Extraction is the one place a bad archive can write junk — or, via a
    // `../` entry path, write OUTSIDE where the user asked (zip-slip) — into the file system. So
    // every entry path is checked with isSafeEntryPath before anything is written, each entry's
    // bytes are CRC-verified (zip) as they inflate, and 'here' auto-renames a name that collides
    // with an existing sibling rather than overwriting the user's file. One implementation drives
    // both the context menu and the archive viewer's Extract button.
    async function extract(node: Node, dest: ExtractDest): Promise<void> {
      showSnackbar(`Extracting “${node.name}”…`);
      try {
        const bytes = await bytesOf(node);
        let archive: OpenedArchive;
        try {
          archive = await openArchive(node.name, bytes);
        } catch (err) {
          if (err instanceof UnsupportedArchiveError) {
            showSnackbar(err.message);
            return;
          }
          throw err;
        }

        const parentId = node.parentId ?? '';
        const base = archiveBaseName(node.name) || 'Archive';
        // 'folder' opens a fresh `<name>` to unpack into; 'here' unpacks into the parent itself.
        const rootId =
          dest === 'folder'
            ? ((await jsonApi('POST', 'kimtfs/folders', { parentId, name: base })) as Node).id
            : parentId;

        // The plan resolves the whole tree up front — the zip-slip guard and the collision policy
        // both live in planExtraction, so this loop only has to make folders and upload files. For
        // 'here', the destination already has children, so seed the collision check with them; the
        // freshly made 'folder' is empty.
        const existing = dest === 'here' ? nodes.filter((n) => (n.parentId ?? '') === rootId).map((n) => n.name) : [];
        const plan = planExtraction(archive.items, existing);

        // Resolved dir path -> its folder id, filled top-down as the plan creates folders.
        const folderId = new Map<string, string>([['', rootId]]);
        const parentOf = (path: string): { parent: string; name: string } => {
          const cut = path.lastIndexOf('/');
          return cut < 0 ? { parent: '', name: path } : { parent: path.slice(0, cut), name: path.slice(cut + 1) };
        };

        let count = 0;
        for (const op of plan) {
          const { parent, name } = parentOf(op.path);
          if (op.kind === 'dir') {
            const made = (await jsonApi('POST', 'kimtfs/folders', { parentId: folderId.get(parent)!, name })) as Node;
            folderId.set(op.path, made.id);
            continue;
          }
          const data = await archive.read(op.item);
          const fd = new FormData();
          fd.append('file', new File([data as BlobPart], name));
          fd.append('parentId', folderId.get(parent)!);
          await callApi('kimtfs/upload', fd);
          count++;
        }

        await reload();
        if (dest === 'folder') {
          select(rootId, true);
          showSnackbar(`Extracted ${count} item${count === 1 ? '' : 's'} to “${base}”`);
        } else {
          showSnackbar(`Extracted ${count} item${count === 1 ? '' : 's'} here`);
        }
      } catch (err) {
        console.error('KimtFS: extracting failed', err);
        showSnackbar(err instanceof Error ? err.message : 'That archive could not be extracted.');
      }
    }

    // What you see when you open an archive: what is inside it, before you commit to unpacking it.
    // (zip and tar are listed from their directory/headers alone — nothing is inflated to list it,
    // so opening a 300 MB archive costs nothing; a `.tar.gz`/`.gz` gunzips to list, which is the
    // native stream, not us.) An unsupported format says so here rather than dumping hex.
    async function renderArchive(host: HTMLElement, node: Node, bytes: Uint8Array): Promise<void> {
      let archive: OpenedArchive;
      try {
        archive = await openArchive(node.name, bytes);
      } catch (err) {
        const msg =
          err instanceof UnsupportedArchiveError ? err.message : 'This does not look like an archive KimtOS can open.';
        host.append(el('p', 'kimtfs-filemeta', msg));
        return;
      }
      const items = archive.items;
      const files = items.filter((e) => !e.isDir);
      const total = files.reduce((n, e) => n + e.size, 0);

      const head = el('div', 'kimtfs-ziphead');
      head.append(
        el(
          'span',
          'kimtfs-filemeta',
          `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtBytes(total)} uncompressed`,
        ),
      );
      // The button routes through the SAME extractor as the menu's "Extract to <name>", so there
      // is one extraction path, not two.
      const btn = el('button', 'button-primary kimtfs-extract', 'Extract') as HTMLButtonElement;
      btn.type = 'button';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        void extract(node, 'folder');
      });
      head.append(btn);
      host.append(head);

      const table = el('div', 'kimtfs-ziplist');
      for (const e of items) {
        const row = el('div', 'kimtfs-ziprow');
        row.append(
          el('span', 'kimtfs-zipname', e.path),
          el('span', 'kimtfs-zipsize', e.isDir ? '—' : fmtBytes(e.size)),
        );
        table.append(row);
      }
      host.append(table);
    }

    // ── Get Info ───────────────────────────────────────────────────────────
    function properties(node: Node): void {
      const path = [...trail(node.id).map((n) => n.name)];
      const rows: [string, string][] = [
        ['Kind', kindLabel(node)],
        ['Size', node.type === 'folder' ? `${descendantIds(node.id).length} items` : fmtBytes(node.size || 0)],
        ['Where', `KimtFS › ${path.slice(0, -1).join(' › ') || '—'}`],
        ['Modified', node.updatedAt ? new Date(node.updatedAt).toLocaleString() : '—'],
      ];
      if (node.type === 'file' && node.kind === 'blob') rows.push(['Type', node.mime || 'Unknown']);
      void infoDialog({
        title: node.name,
        owner: layout,
        html: `<dl class="kimtfs-props">${rows
          .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
          .join('')}</dl>`,
      });
    }

    // The status bar. `navigator.storage.estimate()` is the browser's own answer to "how much
    // room is left" — nothing in this repo asked it before, so an app whose whole job is
    // storing your files could not tell you when it was about to run out.
    //
    // It measures THE WHOLE ORIGIN, not KimtFS: downloaded AI models, every other app's
    // records and blobs, the caches. Sitting bare next to "0 items" it read as KimtFS
    // holding 2.7 GB of nothing (#651), so it says whose figure it is and opens AnubisDB —
    // the console that breaks the same total down per app.
    async function updateStatus(count: number): Promise<void> {
      const items = `${count} item${count === 1 ? '' : 's'}`;
      clear(statusBar);
      statusBar.append(el('span', 'kimtfs-status-items', items));
      try {
        const est = await navigator.storage?.estimate?.();
        if (!est?.quota) return;
        const used = est.usage || 0;
        const space = el(
          'button',
          'kimtfs-status-space',
          `This device: ${fmtBytes(used)} of ${fmtBytes(est.quota)} used by all apps`,
        ) as HTMLButtonElement;
        space.type = 'button';
        space.title =
          'Everything this browser stores for KimtOS — models and every app. Open AnubisDB for the breakdown.';
        space.addEventListener('click', () => openApp?.('anubisdb'));
        statusBar.append(space);
      } catch {
        // An estimate is a nicety; a browser that will not give one must not break the list.
      }
    }

    // ── main: file editor / preview ─────────────────────────────────────────
    function openFile(id: string): void {
      openId = id;
      renderMain();
    }

    function crumbLabel(node: Node | undefined): HTMLElement {
      const wrap = el('div', 'kimtfs-crumbs');
      const chain: Node[] = [];
      let cur = node ? byId(node.parentId) : undefined;
      while (cur) {
        chain.unshift(cur);
        cur = byId(cur.parentId);
      }
      wrap.append(el('span', 'kimtfs-crumb', 'Home'));
      for (const c of chain) {
        wrap.append(el('span', 'kimtfs-sep', '/'), el('span', 'kimtfs-crumb', c.name));
      }
      return wrap;
    }

    // Persisted, so the choice survives closing the app — it is a preference, not a mood.
    // The same store backs the Settings ▸ Apps control, so the two can never disagree.
    async function setViewMode(mode: ViewMode): Promise<void> {
      await setAppConfig(APP_ID, 'view', mode);
      await renderMain();
    }

    // Only the NEWEST paint of the main pane may write into it. renderMain awaits — the
    // node, an object URL, the bytes — so a second call routinely starts while the first is
    // suspended, and both then append into the same pane. Extracting an archive did exactly
    // that: reload() repainted (still on the .zip), select() repainted a tick later (on the
    // new folder), and the slower archive paint appended its toolbar and entry list UNDER
    // the new listing — the app showed the old zip preview and the extracted tree at the
    // same time (#651). Every await in a paint is followed by a `stale()` check.
    let paintSeq = 0;

    async function renderMain(): Promise<void> {
      const paint = ++paintSeq;
      const stale = (): boolean => paint !== paintSeq;
      // Whatever was on screen is about to be replaced — stop and dispose any audio player
      // it held before its element is dropped, so it does not keep playing or leak observers.
      tearDownPreview();
      clear(mainBody);
      const toolbar = el('div', 'kimtfs-toolbar');

      if (!openId) {
        renderList(toolbar);
        return;
      }

      const node = (await getApi(`kimtfs/nodes/${openId}`)) as Node;
      if (stale()) return;
      // Out of a file and back to the folder it lives in. Opening a file used to be a one-way
      // door: nothing in the main pane took you back to a listing (#188).
      toolbar.append(
        iconButton(BACK, {
          title: 'Back to the folder',
          onClick: () => select(node.parentId ?? '', true),
          className: 'kimtfs-ib',
        }),
      );
      toolbar.append(crumbLabel(node));
      const spacer = el('span', 'kimtfs-tb-spacer');
      toolbar.append(spacer);
      if (node.kind === 'blob')
        toolbar.append(
          iconButton(DOWNLOAD, { title: 'Download', onClick: () => download(node), className: 'kimtfs-ib' }),
        );
      toolbar.append(
        iconButton(TRASH, { title: 'Delete', onClick: () => void remove(node), className: 'kimtfs-ib kimtfs-danger' }),
      );
      mainBody.append(toolbar);

      const titleInput = el('input', 'kimtfs-title') as HTMLInputElement;
      titleInput.value = node.name;
      titleInput.addEventListener('change', async () => {
        const name = titleInput.value.trim();
        if (name && name !== node.name) {
          await jsonApi('PATCH', `kimtfs/nodes/${node.id}`, { name });
          await load();
        }
      });
      mainBody.append(titleInput);

      // The editor, for any file whose content is text — WHEREVER its bytes live. A file
      // created in the app is a `text` node; an uploaded .md/.ts/.json is a `blob` node, and
      // until #651 that second one was read-only, so whether you could edit a file came down
      // to where it had come from. The PATCH route writes each kind back the right way, so
      // this is one editor, not two.
      const tkind = detectKind(node.name, node.mime || '');
      if (node.kind === 'text') {
        mountEditor(node, node.text || '', tkind, spacer);
        return;
      }

      const url = (await fileUrl(`kimtfs/blob/${node.id}`)) as string | null;
      if (stale()) return;
      // Past the route's own limit the editor could not save what it showed, so the file
      // stays read-only rather than offering an edit that would be refused. The BYTE count
      // is checked first, because UTF-8 never uses fewer bytes than characters: a file that
      // fails it cannot pass the character limit either, and this way the read-only path
      // below reads the bytes once instead of twice.
      if (url && isTextual(tkind) && (node.size ?? 0) <= MAX_TEXT) {
        const text = await (await fetch(url)).text();
        if (stale()) return;
        if (text.length <= MAX_TEXT) {
          mountEditor(node, text, tkind, spacer);
          return;
        }
      }
      const preview = el('div', 'kimtfs-preview');
      mainBody.append(preview);
      await renderBlob(preview, node, url);
    }

    // Textarea + autosave, plus a Preview toggle for the kinds that have a rendered form.
    // `spacer` is the toolbar's flexible gap: the toggle goes right after it, on the right.
    function mountEditor(node: Node, text: string, kind: ViewKind, spacer: HTMLElement): void {
      const area = el('textarea', 'kimtfs-textarea') as HTMLTextAreaElement;
      area.value = text;
      area.placeholder = 'Write something…';
      const status = el('span', 'kimtfs-status', '');
      const save = debounce(async () => {
        try {
          await jsonApi('PATCH', `kimtfs/nodes/${node.id}`, { text: area.value });
          status.textContent = 'Saved';
          await load();
          setTimeout(() => (status.textContent = ''), 1200);
        } catch (err) {
          // Never leave "Saving…" on screen for an edit that did not save (the size guard
          // refuses one), or the file looks written when it is not.
          status.textContent = err instanceof Error ? err.message : 'Not saved';
        }
      }, 500);
      area.addEventListener('input', () => {
        status.textContent = 'Saving…';
        save();
      });

      // A .json file you WRITE in the app was just as unformatted as one you uploaded — a
      // raw textarea, no formatting, no validation. It can be previewed now: formatted
      // JSON, or the parse error if it is broken (which is usually why you looked).
      if (isTextual(kind) && kind !== 'text') {
        let previewing = false;
        const view = el('div', 'kimtfs-textpreview');
        const toggle = el('button', 'kimtfs-toggle', 'Preview') as HTMLButtonElement;
        toggle.type = 'button';
        const paint = (): void => {
          clear(view);
          area.hidden = previewing;
          view.hidden = !previewing;
          toggle.textContent = previewing ? 'Edit' : 'Preview';
          if (previewing) view.append(textView(kind, area.value, node.name));
        };
        toggle.addEventListener('click', () => {
          previewing = !previewing;
          paint();
        });
        spacer.after(toggle);
        mainBody.append(area, view, status);
        paint();
        return;
      }

      mainBody.append(area, status);
    }

    (async () => {
      await load();
      renderPath(); // or the bar is blank until the first click
      renderMain();
    })();

    // Closing the window tears down the app: dispose any audio player still mounted so its
    // <audio>/ResizeObserver/rAF do not outlive the window (appsController calls this cleanup).
    return tearDownPreview;
  },

  tools: [
    {
      name: 'list_files',
      description:
        'List every folder and file in KimtFS with ids, names, type (folder/file) and parent id. Use to find an item id before reading/updating/deleting it.',
      parameters: { type: 'object', properties: {} },
      async run() {
        const { nodes } = (await getApi('kimtfs/nodes')) as { nodes: Node[] };
        return {
          ok: true,
          summary: `${nodes.length} items`,
          result: JSON.stringify(
            nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, kind: n.kind, parentId: n.parentId })),
          ),
        };
      },
    },
    {
      name: 'create_folder',
      description: 'Create a folder. `parentId` is the id of the containing folder (omit for the root).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, parentId: { type: 'string' } },
        required: ['name'],
      },
      async run(args: { name?: string; parentId?: string }) {
        const n = (await jsonApi('POST', 'kimtfs/folders', { name: args.name, parentId: args.parentId || '' })) as Node;
        return { ok: true, summary: `Folder “${n.name}”`, result: `Created folder ${n.name} (id ${n.id}).` };
      },
    },
    {
      name: 'create_file',
      description: 'Create a text file with optional content. `parentId` is the containing folder (omit for root).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, text: { type: 'string' }, parentId: { type: 'string' } },
        required: ['name'],
      },
      async run(args: { name?: string; text?: string; parentId?: string }) {
        const n = (await jsonApi('POST', 'kimtfs/files', {
          name: args.name,
          text: args.text || '',
          parentId: args.parentId || '',
        })) as Node;
        return { ok: true, summary: `File “${n.name}”`, result: `Created file ${n.name} (id ${n.id}).` };
      },
    },
    {
      name: 'read_file',
      description: 'Read a text file’s content by id (from list_files). Binary/uploaded files return their metadata.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args: { id?: string }) {
        try {
          const n = (await getApi(`kimtfs/nodes/${args.id}`)) as Node;
          if (n.type !== 'file') return { ok: false, summary: 'Not a file', result: `${n.name} is a folder.` };
          return {
            ok: true,
            summary: n.name,
            result: n.kind === 'text' ? n.text || '' : `Uploaded ${n.mime || 'file'} (${fmtBytes(n.size || 0)}).`,
          };
        } catch {
          return { ok: false, summary: 'Not found', result: `No file with id ${args.id}.` };
        }
      },
    },
    {
      name: 'update_file',
      description: 'Replace a text file’s content by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
      async run(args: { id?: string; text?: string }) {
        const n = (await jsonApi('PATCH', `kimtfs/nodes/${args.id}`, { text: args.text })) as Node | null;
        if (!n) return { ok: false, summary: 'Not found', result: `No file with id ${args.id}.` };
        return { ok: true, summary: `Saved ${n.name}`, result: `Updated ${n.name}.` };
      },
    },
    {
      name: 'rename_item',
      description: 'Rename a folder or file by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      async run(args: { id?: string; name?: string }) {
        const n = (await jsonApi('PATCH', `kimtfs/nodes/${args.id}`, { name: args.name })) as Node | null;
        if (!n) return { ok: false, summary: 'Not found', result: `No item with id ${args.id}.` };
        return { ok: true, summary: 'Renamed', result: `Renamed to ${n.name}.` };
      },
    },
    {
      name: 'delete_item',
      description: 'Delete a folder (and everything inside it) or a file, by id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args: { id?: string }) {
        await jsonApi('DELETE', `kimtfs/nodes/${args.id}`);
        return { ok: true, summary: 'Deleted', result: `Deleted item ${args.id}.` };
      },
    },
  ],
};
