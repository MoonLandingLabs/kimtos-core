// Retouch — an on-device image editor. Everything runs on an HTML5 Canvas in the
// tab: open (upload / drop / paste), transform (rotate, flip, crop, resize),
// adjust (brightness / contrast / saturation / blur / grayscale / sepia / invert
// via ctx.filter), zoom, undo/redo, and export (PNG/JPEG download or copy to the
// clipboard). No uploads, no WASM download — the image never leaves the device.
// Saved images live in the shared `history:retouch` store (records + blobs) and
// are listed by the shared history sidebar, exactly like denoise and vidrec.
// Live-gesture editing isn't exposed to the agent, but stateless image transforms
// (grayscale, invert, rotate, resize) and the saved-image library are.
import './retouch.css';
import { historyKey } from '@kimtos/config/ui';
import { el, clear, ownerDoc, ownerView } from '../../lib/dom.js';
import { UPLOAD, DOWNLOAD, COPY, SLIDERS, OPEN, PENCIL, iconButton } from '../../components/icons.js';
import { promptDialog, promptFields } from '../../components/promptDialog.js';
import { confirmDialog } from '../../components/confirm.js';
import { createHistorySidebar, type HistorySidebarEntry } from '../../components/historySidebar.js';
import { createSidebarShell } from '../../components/sidebarShell.js';
import { dataStore as db } from '../../lib/dataStore.js';
import { createBlobHistory } from '../../lib/blobHistory.js';
import appMeta from './meta.js';
import {
  selToPixels,
  clampToCanvas,
  pixelsToSel,
  resizeSel,
  applyAspectPx,
  boundsOf,
  fullImagePx,
  type CanvasGeom,
  type Handle,
  type PixelRect,
  type Sel,
} from './crop.js';
import {
  nextZoom,
  clampZoom,
  scaleByWheel,
  anchorPan,
  clampPan,
  normalizeWheelDelta,
  type Pan,
  type Point,
  type Size,
} from './zoom.js';

const ACCENT = appMeta.accent;
const HISTORY = historyKey('retouch');
const HISTORY_LIMIT = 24;
let sidebarWidth = 220; // drag-resizable; persists across opens within the session.

interface Adjust {
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  sepia: number;
  invert: number;
  blur: number;
}
const DEFAULT_ADJUST: Adjust = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  blur: 0,
};
const isDefault = (a: Adjust): boolean =>
  a.brightness === 100 &&
  a.contrast === 100 &&
  a.saturate === 100 &&
  a.grayscale === 0 &&
  a.sepia === 0 &&
  a.invert === 0 &&
  a.blur === 0;
const buildFilter = (a: Adjust): string =>
  `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) grayscale(${a.grayscale}%) sepia(${a.sepia}%) invert(${a.invert}%) blur(${a.blur}px)`;

// Small inline glyphs for the transform buttons (existing icon set has no
// rotate/flip/crop). currentColor so they follow the button text colour.
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  rotL: svg('<path d="M3 8a9 9 0 1 1-2 5"/><path d="M3 3v5h5"/>'),
  rotR: svg('<path d="M21 8a9 9 0 1 0 2 5"/><path d="M21 3v5h-5"/>'),
  flipH: svg('<path d="M12 3v18"/><path d="M8 7l-5 5 5 5z"/><path d="M16 7l5 5-5 5z"/>'),
  flipV: svg('<path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="M7 16l5 5 5-5z"/>'),
  crop: svg('<path d="M6.5 2v13a2.5 2.5 0 0 0 2.5 2.5h13"/><path d="M17.5 22V9a2.5 2.5 0 0 0-2.5-2.5H2"/>'),
  resize: svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/><path d="M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/><path d="M8 11h6"/>'),
  fit: svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
  save: svg(
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  ),
};

// ---- saved images (the `history:retouch` store) ----
// One record per saved image plus one blob holding its pixels. `adjust` carries the
// PENDING (unbaked) slider state, so reopening an image puts the user back exactly
// where they left off; the blob is the raw canvas, unfiltered.
interface ImageEntry extends HistorySidebarEntry {
  name: string;
  at: number;
  imageKey: string;
  w?: number;
  h?: number;
  adjust?: Partial<Adjust>;
}

const hist = createBlobHistory(HISTORY, { limit: HISTORY_LIMIT, blobKeys: ['imageKey'] });
const loadHistory = hist.load;
const removeEntry = hist.remove;

const baseName = (name: string | undefined): string => (name || 'image').replace(/\.[^.]+$/, '') || 'image';

// Save (or update, when `id` is given) one image. Updating reuses the record's own
// blob key so a re-save replaces the pixels instead of orphaning a blob.
const saveEntry = async (
  name: string,
  blob: Blob,
  w: number,
  h: number,
  adjust: Adjust,
  id?: string,
): Promise<ImageEntry> => {
  const existing = id ? ((await db.get(HISTORY, id)) as ImageEntry | null) : null;
  const imageKey = existing?.imageKey || `${HISTORY}/${db.uid()}`;
  await db.putBlob(imageKey, blob);
  const entry = (await db.put(HISTORY, {
    ...(existing ? { id: existing.id } : {}),
    name,
    at: Date.now(),
    imageKey,
    w,
    h,
    adjust: { ...adjust },
  })) as ImageEntry;
  await hist.prune();
  return entry;
};

// A saved image as the user would see it: its pixels with its pending adjustments
// baked in. Used by the sidebar's "Download PNG".
const renderEntry = async (entry: ImageEntry): Promise<Blob | null> => {
  const raw = await db.getBlob(entry.imageKey);
  if (!raw) return null;
  const a: Adjust = { ...DEFAULT_ADJUST, ...(entry.adjust || {}) };
  if (isDefault(a)) return raw;
  return await processImage(raw, (cx, _c, bmp) => {
    cx.filter = buildFilter(a);
    cx.drawImage(bmp, 0, 0);
  });
};

// Download a blob under `name`, revoking the object URL once the click is through.
const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Process an image blob on an off-DOM canvas (for the agent tools).
async function processImage(
  blob: Blob,
  draw: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, bmp: ImageBitmap) => void,
): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');
  draw(ctx, c, bmp);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed.'))), 'image/png'),
  );
}

interface ToolCtx {
  attachment?: (kind: string) => { blob: Blob } | null | undefined;
  addAttachment?: (att: { kind: string; blob: Blob; filename: string }) => void;
  [key: string]: unknown;
}
const needImage = (ctx: ToolCtx): { blob: Blob } | null => ctx.attachment?.('image') ?? null;

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Edit images on your device — crop, rotate, resize, adjust',
  tip: 'Open an image (upload, drop, or paste), then crop, rotate, resize and adjust it. Scroll over the image to zoom to the cursor, and hold Space and drag to pan. Press Save to keep it — with its adjustments — in the sidebar, where you can reopen, rename or delete it. Everything happens on your device; nothing is uploaded.',
  accent: ACCENT,
  order: appMeta.order,
  popout: true,

  // Agent tools — stateless transforms on the attached image (interactive
  // editing needs a live gesture, so it's intentionally not exposed).
  tools: [
    {
      name: 'grayscale_image',
      description: 'Convert the attached image to grayscale.',
      parameters: { type: 'object', properties: {}, required: [] },
      needs: { attachment: 'image' },
      run: async (_args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = needImage(ctx);
        if (!att)
          return { ok: false, result: 'No image is attached — ask the user to attach one.', summary: 'no image' };
        // The callback owns the draw — setting a filter without drawing yields a
        // blank image, which is exactly what this tool used to return.
        const out = await processImage(att.blob, (cx, _c, bmp) => {
          cx.filter = 'grayscale(100%)';
          cx.drawImage(bmp, 0, 0);
        });
        ctx.addAttachment?.({ kind: 'image', blob: out, filename: 'grayscale.png' });
        return { ok: true, result: 'Converted the image to grayscale.', summary: 'grayscaled image' };
      },
    },
    {
      name: 'invert_image',
      description: 'Invert the colours of the attached image (negative).',
      parameters: { type: 'object', properties: {}, required: [] },
      needs: { attachment: 'image' },
      run: async (_args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = needImage(ctx);
        if (!att) return { ok: false, result: 'No image is attached.', summary: 'no image' };
        const out = await processImage(att.blob, (cx, _c, bmp) => {
          cx.filter = 'invert(100%)';
          cx.drawImage(bmp, 0, 0);
        });
        ctx.addAttachment?.({ kind: 'image', blob: out, filename: 'inverted.png' });
        return { ok: true, result: 'Inverted the image colours.', summary: 'inverted image' };
      },
    },
    {
      name: 'rotate_image',
      description: 'Rotate the attached image 90° clockwise.',
      parameters: { type: 'object', properties: {}, required: [] },
      needs: { attachment: 'image' },
      run: async (_args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = needImage(ctx);
        if (!att) return { ok: false, result: 'No image is attached.', summary: 'no image' };
        const out = await processImage(att.blob, (cx, c, bmp) => {
          c.width = bmp.height;
          c.height = bmp.width;
          cx.translate(c.width / 2, c.height / 2);
          cx.rotate(Math.PI / 2);
          cx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
        });
        ctx.addAttachment?.({ kind: 'image', blob: out, filename: 'rotated.png' });
        return { ok: true, result: 'Rotated the image 90° clockwise.', summary: 'rotated image' };
      },
    },
    {
      name: 'resize_image',
      description: 'Resize the attached image to the given width and height (pixels).',
      parameters: {
        type: 'object',
        properties: { width: { type: 'number' }, height: { type: 'number' } },
        required: ['width', 'height'],
      },
      run: async (args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = needImage(ctx);
        if (!att) return { ok: false, result: 'No image is attached.', summary: 'no image' };
        const w = Math.max(1, Math.round(Number(args.width) || 0));
        const h = Math.max(1, Math.round(Number(args.height) || 0));
        if (!w || !h) return { ok: false, result: 'Provide a positive width and height.', summary: 'bad size' };
        const out = await processImage(att.blob, (cx, c, bmp) => {
          c.width = w;
          c.height = h;
          cx.drawImage(bmp, 0, 0, w, h);
        });
        ctx.addAttachment?.({ kind: 'image', blob: out, filename: `resized-${w}x${h}.png` });
        return { ok: true, result: `Resized the image to ${w}×${h}.`, summary: 'resized image' };
      },
    },
    {
      name: 'list_images',
      description: 'List the images saved in Retouch (with their id, name and size).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const entries = (await loadHistory()) as unknown as ImageEntry[];
        const list =
          entries.map((e) => `${e.id} · ${e.name || 'Image'} (${e.w || '?'}×${e.h || '?'})`).join('\n') || '(none)';
        return { ok: true, result: list, summary: `${entries.length} saved image(s)` };
      },
    },
    {
      name: 'get_image',
      description: 'Get one saved image by id: its name and size (id from list_images).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const entry = (await db.get(HISTORY, String(args.id))) as ImageEntry | null;
        if (!entry) return { ok: false, result: 'No saved image with that id.', summary: 'not found' };
        const name = entry.name || 'Image';
        return { ok: true, result: `"${name}" — ${entry.w || '?'}×${entry.h || '?'}.`, summary: `"${name}"` };
      },
    },
    {
      name: 'rename_image',
      description: 'Rename a saved image (id from list_images).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      run: async (args: Record<string, unknown>) => {
        const name = String(args.name || '').trim();
        if (!name) return { ok: false, result: 'A name is required.', summary: 'no name' };
        const entry = (await db.patch(HISTORY, String(args.id), { name })) as ImageEntry | null;
        if (!entry) return { ok: false, result: 'No saved image with that id.', summary: 'not found' };
        return { ok: true, result: `Renamed to "${entry.name}".`, summary: `renamed to "${entry.name}"` };
      },
    },
    {
      name: 'delete_image',
      description: 'Delete a saved image and its pixels (id from list_images).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const entry = (await db.get(HISTORY, String(args.id))) as ImageEntry | null;
        if (!entry) return { ok: false, result: 'No saved image with that id.', summary: 'not found' };
        await removeEntry(entry);
        return { ok: true, result: 'Image deleted.', summary: 'deleted an image' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall, if present).
  dataLabel: 'saved images',
  hasData: () => db.hasAny(HISTORY),
  async clearData() {
    await db.clearCollection(HISTORY);
    await db.clearBlobsByPrefix(`${HISTORY}/`);
  },

  render(body: HTMLElement) {
    const root = el('div', 'rt-root');
    body.replaceChildren(root);

    // Working canvas + its 2D context (the single source of pixels). Undo snapshots
    // read it back with getImageData on every edit, so hint willReadFrequently — without
    // it Chrome warns and keeps the surface GPU-backed, which is slower for repeated reads.
    const canvas = document.createElement('canvas');
    canvas.className = 'rt-canvas';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let filename = 'image.png';
    const undoStack: ImageData[] = [];
    let hi = -1;
    const adjust: Adjust = { ...DEFAULT_ADJUST };
    // The saved image this canvas came from (null = never saved), and whether it has
    // moved on since. `dirty` is what the discard prompt and the Save button read.
    let current: ImageEntry | null = null;
    let dirty = false;
    let restoring = false; // guards the sidebar callbacks while we put a cancelled selection back

    // --- empty state (dropzone) ---
    const empty = el('div', 'rt-empty');
    const drop = el('button', 'rt-drop');
    drop.type = 'button';
    drop.innerHTML = `${UPLOAD}<span class="rt-drop-title">Drop or paste an image, or click to browse</span><span class="rt-drop-hint">PNG, JPG, WEBP, GIF · ⌘/Ctrl+V to paste</span>`;
    const fileInput = Object.assign(el('input'), { type: 'file', accept: 'image/*', hidden: true });
    empty.append(drop, fileInput);

    // --- editor ---
    const editor = el('div', 'rt-editor');
    editor.hidden = true;
    const toolbar = el('div', 'rt-toolbar');
    const canvasWrap = el('div', 'rt-canvas-wrap');
    // The crop overlay: an interactive box with 8 resize grips, a rule-of-thirds grid,
    // and a live W×H badge. The dimmed mask over the removed area is the box's own huge
    // box-shadow (see retouch.css). Grips carry a data-handle the pointer code reads.
    const cropBox = el('div', 'rt-crop');
    cropBox.hidden = true;
    const cropGrid = el('div', 'rt-crop-grid');
    const cropBadge = el('div', 'rt-crop-badge');
    const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const pos of HANDLES) {
      const grip = el('div', `rt-h rt-h-${pos}`);
      grip.dataset.handle = pos;
      cropBox.append(grip);
    }
    cropBox.append(cropGrid, cropBadge);
    canvasWrap.append(canvas, cropBox);
    const adjustPanel = el('div', 'rt-adjust');
    adjustPanel.hidden = true;
    editor.append(toolbar, canvasWrap, adjustPanel);

    // --- saved-images sidebar + main pane (the shared shell every history app uses) ---
    const history = createHistorySidebar({
      title: 'Images',
      emptyText: 'Saved images will appear here.',
      load: loadHistory,
      remove: removeEntry,
      itemOf: (entry) => ({ snippet: (entry as ImageEntry).name || 'Image' }),
      menu: (entry) => [
        { label: 'Open', icon: OPEN, onClick: () => void openEntry(entry) },
        { label: 'Rename', icon: PENCIL, onClick: () => void renameEntry(entry as ImageEntry) },
        { label: 'Download PNG', icon: DOWNLOAD, onClick: () => void downloadEntry(entry as ImageEntry) },
      ],
      onOpen: (entry) => void openEntry(entry),
      onNew: () => void newImage(),
      confirmMessage: 'Delete this image?',
      undoMessage: 'Image deleted',
      selectable: true,
      bulkConfirm: (n) => `Delete ${n} image${n === 1 ? '' : 's'}?`,
      bulkUndo: (n) => `${n} image${n === 1 ? '' : 's'} deleted`,
    });
    const shell = createSidebarShell({
      history,
      reserve: 380,
      width: sidebarWidth,
      label: 'Images',
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    shell.main.append(empty, editor);
    root.append(shell.layout);

    // ---- undo/redo (in-memory pixel snapshots; not persisted) ----
    function snapshot(): void {
      if (!ctx) return;
      undoStack.length = hi + 1;
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > 12) undoStack.shift();
      hi = undoStack.length - 1;
      dirty = true;
    }
    function restore(i: number): void {
      const s = undoStack[i];
      if (!s || !ctx) return;
      canvas.width = s.width;
      canvas.height = s.height;
      ctx.putImageData(s, 0, 0);
      Object.assign(adjust, DEFAULT_ADJUST);
      canvas.style.filter = '';
      resetView(); // an undo/redo can change the image size — refit rather than keep a stale pan
      dirty = true;
      refresh();
    }

    // ---- flatten pending adjustments into pixels ----
    function flatten(): void {
      if (!ctx || isDefault(adjust)) return;
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext('2d');
      if (!tctx) return;
      tctx.filter = buildFilter(adjust);
      tctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tmp, 0, 0);
      Object.assign(adjust, DEFAULT_ADJUST);
      canvas.style.filter = '';
    }

    // ---- structural ops ----
    function replaceWith(src: HTMLCanvasElement): void {
      if (!ctx) return;
      canvas.width = src.width;
      canvas.height = src.height;
      ctx.filter = 'none';
      ctx.drawImage(src, 0, 0);
    }
    function rotate(cw: boolean): void {
      flatten();
      const tmp = document.createElement('canvas');
      tmp.width = canvas.height;
      tmp.height = canvas.width;
      const t = tmp.getContext('2d');
      if (!t) return;
      t.translate(tmp.width / 2, tmp.height / 2);
      t.rotate(((cw ? 90 : -90) * Math.PI) / 180);
      t.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      replaceWith(tmp);
      snapshot();
      resetView(); // the image geometry changed — show the whole result, fitted
      refresh();
    }
    function flip(horizontal: boolean): void {
      flatten();
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const t = tmp.getContext('2d');
      if (!t) return;
      t.translate(horizontal ? tmp.width : 0, horizontal ? 0 : tmp.height);
      t.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      t.drawImage(canvas, 0, 0);
      replaceWith(tmp);
      snapshot();
      refresh();
    }
    function resizeTo(w: number, h: number): void {
      flatten();
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext('2d');
      if (!t) return;
      t.drawImage(canvas, 0, 0, w, h);
      replaceWith(tmp);
      snapshot();
      resetView(); // the image geometry changed — show the whole result, fitted
      refresh();
    }
    function cropTo(x: number, y: number, w: number, h: number): void {
      flatten();
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext('2d');
      if (!t) return;
      t.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      replaceWith(tmp);
      snapshot();
      resetView(); // the image geometry changed — show the whole result, fitted
      refresh();
    }

    // ---- crop editor (#617) ----
    // The selection is stored in IMAGE pixels (cropPx), so it survives a window
    // resize/maximize: it is re-projected to the wrap's scroll-content space on every
    // paint. The handle geometry is the pure crop.ts helpers; here we only read pointer
    // deltas and paint. Content space folds the scroll in, so the mapping stays correct
    // at any window size — the class behind #615.
    let cropPx: PixelRect | null = null;
    let activeRatio = 0; // 0 = FreeForm; > 0 locks corner drags to this w/h ratio
    let fldW: HTMLInputElement | null = null;
    let fldH: HTMLInputElement | null = null;
    let fldX: HTMLInputElement | null = null;
    let fldY: HTMLInputElement | null = null;

    // The canvas as laid out, in content space (scrollLeft/Top fold the scroll in).
    function canvasGeom(): CanvasGeom {
      const wrap = canvasWrap.getBoundingClientRect();
      const cv = canvas.getBoundingClientRect();
      return {
        left: cv.left - wrap.left + canvasWrap.scrollLeft,
        top: cv.top - wrap.top + canvasWrap.scrollTop,
        dispW: cv.width,
        dispH: cv.height,
        pixW: canvas.width,
        pixH: canvas.height,
      };
    }
    // A pointer event's position in the same content space.
    const toContent = (e: PointerEvent): { x: number; y: number } => {
      const wrap = canvasWrap.getBoundingClientRect();
      return { x: e.clientX - wrap.left + canvasWrap.scrollLeft, y: e.clientY - wrap.top + canvasWrap.scrollTop };
    };

    // Reflect cropPx into the number fields, but never clobber the one being typed in.
    function syncFields(): void {
      if (!cropPx) return;
      const set = (f: HTMLInputElement | null, v: number): void => {
        if (f && document.activeElement !== f) f.value = String(v);
      };
      set(fldW, cropPx.w);
      set(fldH, cropPx.h);
      set(fldX, cropPx.x);
      set(fldY, cropPx.y);
    }
    // Project cropPx to content space and lay out the box + badge + fields.
    function paintCrop(): void {
      if (!cropping || !cropPx) {
        cropBox.hidden = true;
        return;
      }
      const sel = pixelsToSel(cropPx, canvasGeom());
      Object.assign(cropBox.style, {
        left: `${sel.x}px`,
        top: `${sel.y}px`,
        width: `${sel.w}px`,
        height: `${sel.h}px`,
      });
      cropBadge.textContent = `${cropPx.w} × ${cropPx.h}`;
      cropBox.hidden = false;
      syncFields();
    }
    // A number-field edit → clamp into the image and repaint.
    function setCropField(key: 'w' | 'h' | 'x' | 'y', raw: string): void {
      if (!cropPx) return;
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return; // mid-typing ("", "-") — leave the box alone
      const g = canvasGeom();
      const next = { ...cropPx };
      if (key === 'w') next.w = Math.max(1, Math.min(n, g.pixW - next.x));
      else if (key === 'h') next.h = Math.max(1, Math.min(n, g.pixH - next.y));
      else if (key === 'x') next.x = Math.max(0, Math.min(n, g.pixW - next.w));
      else next.y = Math.max(0, Math.min(n, g.pixH - next.h));
      cropPx = next;
      paintCrop();
    }

    // pointer: a grip resizes; the box interior moves; empty canvas draws a fresh box.
    let drag: { handle: Handle; start: Sel; px: number; py: number } | null = null;
    let drawing: { ox: number; oy: number } | null = null;
    canvasWrap.addEventListener('pointerdown', (e) => {
      // Pan takes the gesture when zoomed: middle-button drag, or Space+drag (NotaBoard idiom).
      // This works whether or not crop mode is on, so it sits ahead of the crop guard.
      if (zoom != null && (e.button === 1 || (e.button === 0 && spaceDown))) {
        startPan(e);
        return;
      }
      if (!cropping) return;
      const target = e.target as HTMLElement;
      const grip = target.closest('[data-handle]') as HTMLElement | null;
      const g = canvasGeom();
      if (grip && cropPx) {
        drag = { handle: grip.dataset.handle as Handle, start: pixelsToSel(cropPx, g), px: e.clientX, py: e.clientY };
      } else if (cropPx && (target === cropBox || cropBox.contains(target))) {
        drag = { handle: 'move', start: pixelsToSel(cropPx, g), px: e.clientX, py: e.clientY };
      } else {
        const p = toContent(e);
        const c = clampToCanvas(p.x, p.y, g);
        drawing = { ox: c.x, oy: c.y };
        cropPx = selToPixels({ x: c.x, y: c.y, w: 0, h: 0 }, g);
      }
      canvasWrap.setPointerCapture(e.pointerId);
      e.preventDefault();
      paintCrop();
    });
    const onCropMove = (e: PointerEvent): void => {
      if (!cropping) return;
      const g = canvasGeom();
      if (drag && cropPx) {
        const sel = resizeSel(drag.start, drag.handle, e.clientX - drag.px, e.clientY - drag.py, boundsOf(g), {
          aspect: activeRatio || undefined,
          min: 8,
        });
        cropPx = selToPixels(sel, g);
        paintCrop();
      } else if (drawing) {
        const p = toContent(e);
        const c = clampToCanvas(p.x, p.y, g);
        cropPx = selToPixels(
          {
            x: Math.min(drawing.ox, c.x),
            y: Math.min(drawing.oy, c.y),
            w: Math.abs(c.x - drawing.ox),
            h: Math.abs(c.y - drawing.oy),
          },
          g,
        );
        paintCrop();
      }
    };
    const onCropUp = (): void => {
      // A fresh freehand box snaps to the locked ratio, if one is active.
      if (drawing && cropPx && activeRatio > 0) {
        cropPx = applyAspectPx(cropPx, activeRatio, { pixW: canvas.width, pixH: canvas.height });
        paintCrop();
      }
      drag = null;
      drawing = null;
    };
    canvasWrap.addEventListener('pointermove', onCropMove);
    // The app's OWN document/window, not the bare globals: when Retouch is popped out
    // into a floating window those are the opener's, so the crop's keyboard shortcuts
    // and its pointer-release never fired there (the class of bug #85).
    const appDoc = (): Document => ownerDoc(root);
    ownerView(root).addEventListener('pointerup', onCropUp);

    // Keyboard while cropping: arrows nudge (shift = ×10), Enter applies, Esc cancels.
    function onCropKey(e: KeyboardEvent): void {
      if (!cropping || !cropPx) return;
      if (e.key === 'Enter') {
        applyCrop();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        toggleCrop();
        e.preventDefault();
        return;
      }
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return; // fields own their arrows
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      const g = canvasGeom();
      cropPx = {
        x: Math.max(0, Math.min(cropPx.x + dx, g.pixW - cropPx.w)),
        y: Math.max(0, Math.min(cropPx.y + dy, g.pixH - cropPx.h)),
        w: cropPx.w,
        h: cropPx.h,
      };
      paintCrop();
    }
    function applyCrop(): void {
      if (cropPx && cropPx.w > 4 && cropPx.h > 4) {
        const g = canvasGeom();
        // Round-trip clamps cropPx to the image bounds; it is already scroll-invariant (#615).
        const { x, y, w, h } = selToPixels(pixelsToSel(cropPx, g), g);
        if (w > 0 && h > 0) cropTo(x, y, w, h);
      }
      toggleCrop();
    }
    // Keep the overlay glued to the image when the window (and so the display size) changes.
    const cropRO = new ResizeObserver(() => {
      if (cropping) paintCrop();
    });
    cropRO.observe(canvas);
    // While zoomed, a window resize can leave the pan out of range (an image edge pulled inside
    // the now-smaller viewport); reclamp and repaint. Fit mode needs nothing — the browser
    // rescales the contained canvas and cropRO repaints the overlay.
    const wrapRO = new ResizeObserver(() => {
      if (zoom != null) applyZoom();
    });
    wrapRO.observe(canvasWrap);

    // ---- zoom + pan (#652, #1124) ----
    // `zoom === null` is Fit: the canvas keeps its CSS max-width/height and the browser scales
    // it down to the pane. Any other value is a continuous, cursor-anchored magnification: the
    // canvas is positioned absolutely and drawn with `transform: translate(pan) scale(zoom)`,
    // origin at the viewport top-left, so the image point under the pointer stays fixed across
    // a zoom (the #1124 fix — a discrete, unanchored zoom read as the image being cut). Pan is
    // the same translate, dragged directly. The crop overlay follows automatically: it reads
    // the canvas's live rect, so nothing here has to know about the selection.
    //
    // The anchor/step/clamp maths is pure and unit-tested in zoom.ts (#652); index.ts only
    // measures the DOM and applies the result.
    let zoom: number | null = null;
    let pan: Pan = { x: 0, y: 0 };
    let spaceDown = false;
    const zoomLabel = el('button', 'rt-btn rt-text ghost rt-zoom-label', '100%');
    zoomLabel.type = 'button';
    zoomLabel.title = 'Zoom to 100%';
    zoomLabel.addEventListener('click', () => setZoom(1));

    // The visible viewport (the wrap's box; its border is 0 and overflow is hidden, so this is
    // exactly the region the transformed canvas is clipped to) and points within it.
    const viewSize = (): Size => {
      const r = canvasWrap.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    const centerPoint = (): Point => {
      const s = viewSize();
      return { x: s.w / 2, y: s.h / 2 };
    };
    const cursorPoint = (e: { clientX: number; clientY: number }): Point => {
      const r = canvasWrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // What the image is actually displayed at right now — measured in Fit mode, exact otherwise.
    function currentScale(): number {
      if (zoom != null) return zoom;
      const w = canvas.getBoundingClientRect().width;
      return canvas.width > 0 && w > 0 ? w / canvas.width : 1;
    }
    // The canvas top-left in viewport space — the stored pan when zoomed (exact), the measured
    // centred position in Fit mode (so the first wheel step out of Fit is seamless).
    function currentPan(): Pan {
      if (zoom != null) return pan;
      const cv = canvas.getBoundingClientRect();
      const wr = canvasWrap.getBoundingClientRect();
      return { x: cv.left - wr.left, y: cv.top - wr.top };
    }
    // Return to Fit — used when a structural op changes the image geometry.
    function resetView(): void {
      zoom = null;
      pan = { x: 0, y: 0 };
    }
    function applyZoom(): void {
      if (zoom == null) {
        canvas.classList.remove('is-zoomed');
        canvas.style.transform = '';
      } else {
        canvas.classList.add('is-zoomed');
        pan = clampPan(pan, zoom, { w: canvas.width, h: canvas.height }, viewSize());
        canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      }
      zoomLabel.textContent = `${Math.round(currentScale() * 100)}%`;
      fitBtn.classList.toggle('is-on', zoom == null);
      if (cropping) paintCrop();
    }
    // Set an explicit zoom (or Fit, when `next` is null), keeping the image point under `at`
    // fixed — the cursor for a wheel gesture, the viewport centre for the buttons/label.
    function setZoom(next: number | null, at?: Point): void {
      if (next == null) {
        resetView();
        applyZoom();
        return;
      }
      const ns = clampZoom(next);
      pan = anchorPan(currentPan(), currentScale(), ns, at ?? centerPoint());
      zoom = ns;
      applyZoom();
    }
    const stepZoom = (dir: 1 | -1): void => setZoom(nextZoom(currentScale(), dir));
    const fitBtn = tbBtn(ICON.fit, 'Fit to window', () => setZoom(null));

    // Wheel / trackpad-pinch: continuous zoom to the cursor, no modifier needed (needing one
    // was part of the "not like a real editor" feel). Panning a zoomed image is drag, below.
    canvasWrap.addEventListener(
      'wheel',
      (e) => {
        if (editor.hidden) return; // no image open
        e.preventDefault();
        const dy = normalizeWheelDelta(e.deltaY, e.deltaMode, viewSize().h);
        setZoom(scaleByWheel(currentScale(), dy), cursorPoint(e));
      },
      { passive: false },
    );

    // Drag-to-pan, reusing NotaBoard's idiom (engine.ts `startPan`): middle-button drag, or
    // Space+drag. Only meaningful when zoomed in; the pointerdown wiring lives with the crop
    // handler above so the two gestures share one listener.
    function startPan(e: PointerEvent): void {
      if (zoom == null) return;
      canvasWrap.classList.add('is-panning');
      canvasWrap.setPointerCapture(e.pointerId);
      e.preventDefault();
      const start = { cx: e.clientX, cy: e.clientY, px: pan.x, py: pan.y };
      const move = (ev: PointerEvent): void => {
        if (zoom == null) return;
        pan = clampPan(
          { x: start.px + (ev.clientX - start.cx), y: start.py + (ev.clientY - start.cy) },
          zoom,
          { w: canvas.width, h: canvas.height },
          viewSize(),
        );
        canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        if (cropping) paintCrop();
      };
      const up = (ev: PointerEvent): void => {
        canvasWrap.classList.remove('is-panning');
        if (canvasWrap.hasPointerCapture?.(ev.pointerId)) canvasWrap.releasePointerCapture(ev.pointerId);
        canvasWrap.removeEventListener('pointermove', move);
        ownerView(root).removeEventListener('pointerup', up);
      };
      canvasWrap.addEventListener('pointermove', move);
      ownerView(root).addEventListener('pointerup', up);
    }
    // Space primes the pan (grab) cursor while zoomed; it must not scroll the pane or click a
    // focused button, but it must still type into the crop number fields.
    const isTyping = (t: EventTarget | null): boolean => {
      const node = t as HTMLElement | null;
      return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
    };
    appDoc().addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || editor.hidden || isTyping(e.target)) return;
      spaceDown = true;
      if (zoom != null) {
        canvasWrap.classList.add('can-pan');
        e.preventDefault();
      }
    });
    appDoc().addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      spaceDown = false;
      canvasWrap.classList.remove('can-pan');
    });

    // ---- toolbar ----
    function tbBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
      const b = iconButton(icon, { title, className: 'rt-btn', onClick });
      return b;
    }
    let cropping = false;
    const cropBtn = tbBtn(ICON.crop, 'Crop', () => toggleCrop());
    const undoBtn = tbBtn(ICON.undo, 'Undo', () => {
      if (hi > 0) {
        hi--;
        restore(hi);
      }
    });
    const redoBtn = tbBtn(ICON.redo, 'Redo', () => {
      if (hi < undoStack.length - 1) {
        hi++;
        restore(hi);
      }
    });
    const adjBtn = tbBtn(SLIDERS, 'Adjustments', () => {
      adjustPanel.hidden = !adjustPanel.hidden;
      adjBtn.classList.toggle('is-on', !adjustPanel.hidden);
    });

    function toggleCrop(): void {
      cropping = !cropping;
      cropBtn.classList.toggle('is-on', cropping);
      canvasWrap.classList.toggle('is-cropping', cropping);
      if (cropping) {
        cropPx = fullImagePx(canvasGeom()); // start with the whole image selected
        activeRatio = 0;
        appDoc().addEventListener('keydown', onCropKey);
      } else {
        cropPx = null;
        drag = null;
        drawing = null;
        appDoc().removeEventListener('keydown', onCropKey);
      }
      renderCropActions();
      paintCrop();
    }

    // FreeForm plus the common presets; a non-free ratio locks corner drags to it.
    const PRESETS: [string, number][] = [
      ['Free', 0],
      ['1:1', 1],
      ['4:5', 4 / 5],
      ['16:9', 16 / 9],
      ['9:16', 9 / 16],
      ['3:2', 3 / 2],
    ];
    const cropActions = el('div', 'rt-crop-actions');
    function renderCropActions(): void {
      // A locked ratio disables the 4 edge grips (they can't keep the ratio); corners can.
      canvasWrap.classList.toggle('rt-ratio-locked', cropping && activeRatio > 0);
      clear(cropActions);
      fldW = fldH = fldX = fldY = null;
      if (!cropping) return;

      const presets = el('div', 'rt-crop-presets');
      for (const [label, ratio] of PRESETS) {
        const btn = el('button', 'rt-btn rt-text rt-chip', label);
        btn.type = 'button';
        if (ratio === activeRatio) btn.classList.add('is-on');
        btn.addEventListener('click', () => {
          activeRatio = ratio;
          if (ratio > 0 && cropPx) cropPx = applyAspectPx(cropPx, ratio, { pixW: canvas.width, pixH: canvas.height });
          renderCropActions();
          paintCrop();
        });
        presets.append(btn);
      }

      const fields = el('div', 'rt-crop-fields');
      const mk = (label: string, key: 'w' | 'h' | 'x' | 'y'): HTMLInputElement => {
        const wrap = el('label', 'rt-crop-field');
        wrap.append(el('span', 'rt-crop-field-label', label));
        const input = Object.assign(el('input', 'rt-crop-input'), {
          type: 'number',
          min: key === 'x' || key === 'y' ? '0' : '1',
        });
        input.addEventListener('input', () => setCropField(key, input.value));
        wrap.append(input);
        fields.append(wrap);
        return input;
      };
      fldW = mk('W', 'w');
      fldH = mk('H', 'h');
      fldX = mk('X', 'x');
      fldY = mk('Y', 'y');

      const reset = el('button', 'rt-btn rt-text ghost', 'Reset');
      reset.type = 'button';
      reset.addEventListener('click', () => {
        cropPx = fullImagePx(canvasGeom());
        paintCrop();
      });
      const apply = el('button', 'rt-btn rt-text', 'Apply crop');
      apply.type = 'button';
      apply.addEventListener('click', () => applyCrop());
      const cancel = el('button', 'rt-btn rt-text ghost', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => toggleCrop());

      cropActions.append(presets, fields, reset, apply, cancel);
      syncFields();
    }

    function buildToolbar(): void {
      clear(toolbar);
      const g1 = el('div', 'rt-group');
      g1.append(tbBtn(UPLOAD, 'Open another image', () => fileInput.click()));
      const g2 = el('div', 'rt-group');
      g2.append(
        tbBtn(ICON.rotL, 'Rotate left', () => rotate(false)),
        tbBtn(ICON.rotR, 'Rotate right', () => rotate(true)),
        tbBtn(ICON.flipH, 'Flip horizontal', () => flip(true)),
        tbBtn(ICON.flipV, 'Flip vertical', () => flip(false)),
        cropBtn,
        tbBtn(ICON.resize, 'Resize', () => void promptResize()),
      );
      const g3 = el('div', 'rt-group');
      g3.append(
        adjBtn,
        undoBtn,
        redoBtn,
        tbBtn(ICON.reset, 'Reset to original', () => resetAll()),
      );
      const gz = el('div', 'rt-group rt-zoom');
      gz.append(
        tbBtn(ICON.zoomOut, 'Zoom out (or scroll over the image)', () => stepZoom(-1)),
        zoomLabel,
        tbBtn(ICON.zoomIn, 'Zoom in (or scroll over the image)', () => stepZoom(1)),
        fitBtn,
      );
      const g4 = el('div', 'rt-group rt-group-end');
      const png = el('button', 'rt-btn rt-text', 'PNG');
      png.type = 'button';
      png.addEventListener('click', () => void download('image/png'));
      const jpg = el('button', 'rt-btn rt-text', 'JPG');
      jpg.type = 'button';
      jpg.addEventListener('click', () => void download('image/jpeg'));
      g4.append(
        saveBtn,
        iconButton(COPY, { title: 'Copy to clipboard', className: 'rt-btn', onClick: () => void copyOut() }),
        iconButton(DOWNLOAD, { title: 'Download PNG', className: 'rt-btn', onClick: () => void download('image/png') }),
        png,
        jpg,
      );
      toolbar.append(g1, g2, g3, gz, cropActions, g4);
      renderCropActions();
    }

    // ---- adjustments panel ----
    const dims = el('span', 'rt-dims');
    function buildAdjust(): void {
      clear(adjustPanel);
      const sliders: [keyof Adjust, string, number, number][] = [
        ['brightness', 'Brightness', 0, 200],
        ['contrast', 'Contrast', 0, 200],
        ['saturate', 'Saturation', 0, 200],
        ['blur', 'Blur', 0, 12],
        ['grayscale', 'Grayscale', 0, 100],
        ['sepia', 'Sepia', 0, 100],
        ['invert', 'Invert', 0, 100],
      ];
      for (const [key, label, min, max] of sliders) {
        const row = el('label', 'rt-slider-row');
        const name = el('span', 'rt-slider-label', label);
        const input = Object.assign(el('input', 'rt-slider'), {
          type: 'range',
          min: String(min),
          max: String(max),
          value: String(adjust[key]),
        });
        input.addEventListener('input', () => {
          adjust[key] = Number(input.value);
          canvas.style.filter = isDefault(adjust) ? '' : buildFilter(adjust);
          dirty = true; // pending adjustments are part of the saved state
          refresh();
        });
        row.append(name, input);
        adjustPanel.append(row);
      }
      const apply = el('button', 'rt-btn rt-text', 'Apply');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        if (!isDefault(adjust)) {
          flatten();
          snapshot();
        }
        buildAdjust();
        refresh();
      });
      const resetAdj = el('button', 'rt-btn rt-text ghost', 'Reset');
      resetAdj.type = 'button';
      resetAdj.addEventListener('click', () => {
        Object.assign(adjust, DEFAULT_ADJUST);
        canvas.style.filter = '';
        dirty = true;
        buildAdjust();
        refresh();
      });
      const actions = el('div', 'rt-adjust-actions');
      actions.append(apply, resetAdj);
      adjustPanel.append(actions);
    }

    // One dialog for both dimensions, with the ratio kept by default — the old
    // pair of native prompts could not show the current size, could not keep the
    // ratio, and threw away the width you had just typed if you cancelled the
    // height. `owner: root` mounts it in the app's own document, so it appears in
    // the floating window when Retouch is popped out (see #85).
    async function promptResize(): Promise<void> {
      const from = { w: canvas.width, h: canvas.height };
      const ratio = from.w / from.h;
      const px = (n: number): string => String(Math.max(1, Math.round(n)));

      const res = await promptFields({
        title: 'Resize image',
        owner: root,
        confirmLabel: 'Resize',
        fields: [
          { key: 'w', label: 'Width (px)', value: String(from.w), type: 'number', min: 1 },
          { key: 'h', label: 'Height (px)', value: String(from.h), type: 'number', min: 1 },
        ],
        toggle: { key: 'lock', label: 'Lock aspect ratio', checked: true },
        note: `Current: ${from.w} x ${from.h}`,
        onInput: (key, values, set) => {
          if (values.lock !== 'on') return;
          const n = Number(key === 'w' ? values.w : values.h);
          if (!Number.isFinite(n) || n <= 0) return; // mid-typing ("", "-") — leave it alone
          if (key === 'w') set('h', px(n / ratio));
          else set('w', px(n * ratio));
        },
      });
      if (!res) return;

      const w = Math.round(Number(res.w));
      const h = Math.round(Number(res.h));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
      if (w === from.w && h === from.h) return; // nothing to do — don't push an undo step
      resizeTo(w, h);
    }

    function resetAll(): void {
      if (!undoStack.length) return;
      const first = undoStack[0];
      if (!first || !ctx) return;
      undoStack.length = 1;
      hi = 0;
      restore(0);
    }

    // ---- saved images ----
    const saveBtn = tbBtn(ICON.save, 'Save to your images', () => void saveCurrent());

    // The canvas as raw pixels — CSS filters don't touch the bitmap, so this is the
    // image WITHOUT the pending adjustments, which is exactly what we persist.
    const canvasBlob = (): Promise<Blob | null> =>
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));

    // `saving` is not cosmetic: encoding and writing the blob are async, so a second
    // click before the first finishes would see `current` still null and write a
    // SECOND record for the same image.
    let saving = false;
    async function saveCurrent(): Promise<void> {
      if (editor.hidden || !ctx || saving) return;
      saving = true;
      saveBtn.disabled = true;
      try {
        const blob = await canvasBlob();
        if (!blob) return;
        current = await saveEntry(filename, blob, canvas.width, canvas.height, adjust, current?.id);
        dirty = false;
        history.open(current); // highlights the row; openEntry short-circuits the reload
      } finally {
        saving = false;
        refresh();
      }
    }

    const confirmDiscard = (): Promise<boolean> =>
      confirmDialog('Discard the unsaved changes to this image?', {
        owner: root,
        confirmLabel: 'Discard',
      });

    // Cancelling a discard must leave the editor alone AND put the sidebar's highlight
    // back on what is really open — hence the `restoring` guard on both callbacks.
    async function guardUnsaved(): Promise<boolean> {
      if (!dirty || editor.hidden) return true;
      if (await confirmDiscard()) return true;
      restoring = true;
      if (current) history.open(current);
      else history.showNew();
      restoring = false;
      return false;
    }

    async function openEntry(entry: HistorySidebarEntry): Promise<void> {
      if (restoring) return;
      const e = entry as ImageEntry | undefined;
      if (!e) return;
      if (current?.id === e.id && !dirty) {
        refresh();
        return;
      }
      // Read the pixels BEFORE asking to discard: there is no sense making the user
      // throw work away for an entry whose blob has gone missing.
      const blob = await db.getBlob(e.imageKey);
      if (!blob) return;
      if (!(await guardUnsaved())) return;
      loadFile(blob, e.name, e);
    }

    function newImage(): void {
      if (restoring) return;
      void (async () => {
        if (!(await guardUnsaved())) return;
        current = null;
        dirty = false;
        undoStack.length = 0;
        hi = -1;
        Object.assign(adjust, DEFAULT_ADJUST);
        canvas.style.filter = '';
        if (cropping) toggleCrop();
        editor.hidden = true;
        empty.hidden = false;
      })();
    }

    async function renameEntry(entry: ImageEntry): Promise<void> {
      const name = (
        await promptDialog({
          title: 'Rename image',
          label: 'Name',
          value: entry.name || '',
          confirmLabel: 'Rename',
          owner: root,
        })
      )?.trim();
      if (!name) return;
      const next = (await db.patch(HISTORY, entry.id, { name })) as ImageEntry | null;
      if (current?.id === entry.id) {
        current = next ?? current;
        filename = name;
      }
      history.refresh();
    }

    async function downloadEntry(entry: ImageEntry): Promise<void> {
      const blob = await renderEntry(entry);
      if (blob) downloadBlob(blob, `${baseName(entry.name)}.png`);
    }

    // ---- export ----
    function exportCanvas(): HTMLCanvasElement {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const c = out.getContext('2d');
      if (c) {
        c.filter = isDefault(adjust) ? 'none' : buildFilter(adjust);
        c.drawImage(canvas, 0, 0);
      }
      return out;
    }
    function download(type: 'image/png' | 'image/jpeg'): Promise<void> {
      return new Promise((resolve) => {
        exportCanvas().toBlob(
          (blob) => {
            if (blob) downloadBlob(blob, `${baseName(filename)}${type === 'image/png' ? '.png' : '.jpg'}`);
            resolve();
          },
          type,
          type === 'image/jpeg' ? 0.92 : undefined,
        );
      });
    }
    async function copyOut(): Promise<void> {
      try {
        const blob = await new Promise<Blob | null>((res) => exportCanvas().toBlob((b) => res(b), 'image/png'));
        if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch {
        /* clipboard unavailable */
      }
    }

    // ---- load ----
    // `from` is the saved entry this image came from: it restores the pending
    // adjustments alongside the pixels, and makes Save update that entry rather
    // than creating a second copy of it.
    function loadFile(file: File | Blob, name?: string, from?: ImageEntry): void {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (!ctx) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.filter = 'none';
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        filename = name || (file instanceof File ? file.name : 'image.png');
        undoStack.length = 0;
        hi = -1;
        Object.assign(adjust, DEFAULT_ADJUST, from?.adjust || {});
        canvas.style.filter = isDefault(adjust) ? '' : buildFilter(adjust);
        snapshot(); // sets dirty — a freshly opened image is only "unsaved" if it is new
        current = from ?? null;
        dirty = !from;
        if (cropping) toggleCrop();
        zoom = null; // a new image starts fitted, not at the last image's magnification
        empty.hidden = true;
        editor.hidden = false;
        buildToolbar();
        buildAdjust();
        refresh();
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }

    function refresh(): void {
      dims.textContent = `${canvas.width} × ${canvas.height}`;
      undoBtn.disabled = hi <= 0;
      redoBtn.disabled = hi >= undoStack.length - 1;
      saveBtn.disabled = !!current && !dirty;
      saveBtn.title = current ? (dirty ? 'Save changes' : 'Saved') : 'Save to your images';
      applyZoom();
      // keep the dims chip in the toolbar's export group
      if (!dims.parentElement) toolbar.querySelector('.rt-group-end')?.prepend(dims);
    }

    // ---- wiring ----
    // Every way in goes through the same unsaved-changes guard, so an accidental
    // drop can't silently throw away work the user has not saved.
    async function openIncoming(file: File | Blob, name?: string): Promise<void> {
      if (!(await guardUnsaved())) return;
      loadFile(file, name);
    }
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void openIncoming(f);
      fileInput.value = '';
    });
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      drop.classList.add('is-over');
    };
    const onDragLeave = (): void => drop.classList.remove('is-over');
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      drop.classList.remove('is-over');
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) void openIncoming(f);
    };
    drop.addEventListener('dragover', onDragOver);
    drop.addEventListener('dragleave', onDragLeave);
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', onDrop);

    const onPaste = (e: ClipboardEvent): void => {
      const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) void openIncoming(file, 'pasted.png');
    };
    root.addEventListener('paste', onPaste);
    // Make the root focusable so it can receive paste without a text field.
    root.tabIndex = -1;

    return () => {
      history.destroy(); // first: stopping things below is itself what asks the sidebar to repaint
      ownerView(root).removeEventListener('pointerup', onCropUp);
      appDoc().removeEventListener('keydown', onCropKey);
      cropRO.disconnect();
      shell.responsive.destroy?.();
    };
  },
};
