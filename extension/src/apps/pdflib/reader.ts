// In-app PDF reader (PDF.js), loaded lazily. A continuous, Chrome-like viewer:
// every page is stacked in one scroll and rendered on demand as it nears the
// viewport (and unloaded when far away, to bound memory). See the original notes
// for the rendering/search/annotation design.

import * as pdfjsLib from 'pdfjs-dist';
import { clamp } from '../../lib/num.js';
import { rafThrottle } from '../../lib/timing.js';
import { TextLayer, setLayerDimensions } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fileUrl, getApi, jsonApi } from '../../lib/api.js';
import { escapeHtml } from '../../lib/dom.js';
import { saveBookToDisk } from './download.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// TextContent isn't re-exported at the package root; derive it from the method.
type TextContent = Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>>;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Annotation {
  id: string;
  page: number;
  color?: string;
  text?: string;
  comment?: string;
  rects: Rect[];
  [key: string]: unknown;
}
interface Book {
  id: string;
  title?: string;
  zoom?: number;
  lastPage?: number;
  [key: string]: unknown;
}
interface Size {
  width: number;
  height: number;
}
interface PageItem {
  wrap: HTMLElement;
  canvas: HTMLCanvasElement;
  hl: HTMLElement;
  textDiv: HTMLDivElement;
  base: Size;
  rendered: boolean;
  rendering: boolean;
  renderedScale: number | null;
  task: RenderTask | null;
}
interface Selection {
  page: number;
  rects: Rect[];
  text: string;
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>',
  prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>',
  next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>',
  zoomOut:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 12h12"></path></svg>',
  zoomIn:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 6v12M6 12h12"></path></svg>',
  note: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>',
  list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path></svg>',
  download:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"></path><path d="M8 11l4 4 4-4"></path><path d="M5 19h14"></path></svg>',
};

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

// Highlight colours offered in the selection popup.
const COLORS = ['yellow', 'green', 'blue', 'pink'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

// PDFs split text into many positioned chunks, so we match ignoring whitespace.
const stripWs = (s: string): string => s.replace(/\s+/g, '');

export function createReader({ container, book, onBack }: { container: HTMLElement; book: Book; onBack: () => void }) {
  const root = el('div', 'pdf-reader');

  const bar = el('div', 'pdf-reader-bar');
  const back = el('button', 'icon-button', ICON.back);
  back.title = 'Back to list';
  back.addEventListener('click', onBack);
  const title = el('span', 'pdf-reader-title');
  title.textContent = book.title ?? '';

  const search = el('input', 'input pdf-search');
  search.type = 'search';
  search.placeholder = 'Search in book…';
  const matchLabel = el('span', 'pdf-match');
  const searchPrev = el('button', 'icon-button pdf-nav-btn', ICON.prev);
  searchPrev.title = 'Previous match';
  const searchNext = el('button', 'icon-button pdf-nav-btn', ICON.next);
  searchNext.title = 'Next match';
  const searchGroup = el('div', 'pdf-search-group');
  searchGroup.append(search, matchLabel, searchPrev, searchNext);

  const zoomOut = el('button', 'icon-button pdf-nav-btn', ICON.zoomOut);
  zoomOut.title = 'Zoom out';
  const zoomLabel = el('span', 'pdf-zoom-label');
  const zoomIn = el('button', 'icon-button pdf-nav-btn', ICON.zoomIn);
  zoomIn.title = 'Zoom in';
  const zoomGroup = el('div', 'pdf-zoom-group');
  zoomGroup.append(zoomOut, zoomLabel, zoomIn);

  const pageLabel = el('span', 'pdf-page-label');

  // Save the book you are reading back to disk — the same stored file, untouched.
  const saveBtn = el('button', 'icon-button pdf-nav-btn', ICON.download);
  saveBtn.title = 'Download this PDF';
  saveBtn.setAttribute('aria-label', 'Download this PDF');
  saveBtn.addEventListener('click', () => void saveBookToDisk(book, root));

  const sideBtn = el('button', 'icon-button pdf-nav-btn pdf-side-btn', ICON.list);
  sideBtn.title = 'Notes';
  sideBtn.addEventListener('click', () => toggleSide());

  // All the controls live in one right-aligned cluster; the title stays alone on the left,
  // so the bar reads as "title · | · controls" rather than search sprawling into the title (#266).
  const controls = el('div', 'pdf-reader-controls');
  const showControls = (): void => {
    controls.append(searchGroup, pageLabel, zoomGroup, saveBtn, sideBtn);
    bar.append(controls);
  };

  bar.append(back, title);

  const view = el('div', 'pdf-reader-view');
  const pagesEl = el('div', 'pdf-pages');
  view.append(pagesEl);
  const side = el('aside', 'pdf-side');
  const main = el('div', 'pdf-reader-main');
  main.append(view, side);

  root.append(bar, main);
  container.replaceChildren(root);
  pagesEl.append(el('p', 'pdf-loading', 'Loading…'));

  // State
  let pdf: PDFDocumentProxy | null = null;
  let scale = 1;
  let base1: Size = { width: 612, height: 792 }; // first-page size, the layout baseline
  const pageEls: PageItem[] = [];
  let tops: number[] = []; // scroll offset of each page within the view
  let current = 1;

  let query = '';
  const tcCache = new Map<number, TextContent>();
  const textCache = new Map<number, string>();
  let matches: number[] = []; // zero-based page indices
  let matchIdx = -1;

  const annByPage = new Map<number, Annotation[]>(); // pageIndex(0-based) -> [annotation]

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveLastPage = (n: number): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void jsonApi('PATCH', `books/${book.id}`, { lastPage: n }), 600);
  };

  let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveZoom = (z: number): void => {
    if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
    zoomSaveTimer = setTimeout(() => void jsonApi('PATCH', `books/${book.id}`, { zoom: z }), 600);
  };

  // --- text caches (shared by search + the text layer) ---
  async function getTC(n: number) {
    if (!tcCache.has(n)) tcCache.set(n, await (await pdf!.getPage(n)).getTextContent());
    return tcCache.get(n)!;
  }
  async function getText(n: number): Promise<string> {
    if (!textCache.has(n)) {
      const tc = await getTC(n);
      textCache.set(
        n,
        (tc.items as { str?: string }[])
          .map((it) => it.str ?? '')
          .join(' ')
          .toLowerCase(),
      );
    }
    return textCache.get(n)!;
  }

  // --- layout ---
  function defaultScale(): number {
    const fitWidth = view.clientWidth - 40; // padding + scrollbar headroom
    return clamp(Math.min(1, fitWidth / base1.width), ZOOM_MIN, ZOOM_MAX);
  }

  function setZoomLabel(): void {
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function applyZoom(): void {
    if (!popup.hidden) hidePopup();
    const anchor = current - 1;
    pageEls.forEach((item, i) => {
      sizeWrap(item);
      unload(i);
    });
    measure();
    scrollToPage(anchor);
    renderVisible();
    setZoomLabel();
    updateCurrent();
  }

  function zoomBy(factor: number): void {
    const next = clamp(scale * factor, ZOOM_MIN, ZOOM_MAX);
    if (next === scale) return;
    scale = next;
    applyZoom();
    saveZoom(scale);
  }
  zoomOut.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
  zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));

  function sizeWrap(item: PageItem): void {
    item.wrap.style.width = `${Math.round(item.base.width * scale)}px`;
    item.wrap.style.height = `${Math.round(item.base.height * scale)}px`;
  }

  function measure(): void {
    const vt = view.getBoundingClientRect().top;
    tops = pageEls.map((p) => p.wrap.getBoundingClientRect().top - vt + view.scrollTop);
  }

  function scrollToPage(i: number): void {
    view.scrollTop = Math.max(0, (tops[i] ?? 0) - 6);
  }

  function setCurrent(n: number): void {
    if (n === current) return;
    current = n;
    pageLabel.textContent = `${current} / ${pdf!.numPages}`;
    saveLastPage(current);
  }

  function updateCurrent(): void {
    const y = view.scrollTop + 90;
    let lo = 0;
    let hi = tops.length - 1;
    let cur = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= y) {
        cur = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    setCurrent(cur + 1);
  }

  // --- rendering ---
  async function renderOne(i: number): Promise<void> {
    const item = pageEls[i];
    if (!item || item.rendering || (item.rendered && item.renderedScale === scale)) return;
    item.rendering = true;
    try {
      const page = await pdf!.getPage(i + 1);
      const viewport = page.getViewport({ scale });
      item.base = { width: viewport.width / scale, height: viewport.height / scale };
      sizeWrap(item); // correct the placeholder to this page's real size
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      item.canvas.width = Math.floor(viewport.width * dpr);
      item.canvas.height = Math.floor(viewport.height * dpr);
      item.canvas.style.width = `${Math.floor(viewport.width)}px`;
      item.canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = item.canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (item.task) {
        try {
          item.task.cancel();
        } catch {
          /* ignore */
        }
      }
      item.task = page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]);
      await item.task.promise;

      item.textDiv.replaceChildren();
      setLayerDimensions(item.textDiv, viewport);
      const layer = new TextLayer({ textContentSource: await getTC(i + 1), container: item.textDiv, viewport });
      await layer.render();
      if (query) highlightItem(item);

      item.rendered = true;
      item.renderedScale = scale;
      item.canvas.classList.add('is-ready');
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') item.rendering = false;
    } finally {
      item.rendering = false;
    }
  }

  function renderVisible(): void {
    const top = view.scrollTop - 600;
    const bottom = view.scrollTop + view.clientHeight + 600;
    for (let i = 0; i < pageEls.length; i++) {
      const t = tops[i] ?? 0;
      if (t + pageEls[i].wrap.offsetHeight >= top && t <= bottom) renderOne(i);
    }
  }

  function unload(i: number): void {
    const item = pageEls[i];
    if (!item || !item.rendered) return;
    if (item.task) {
      try {
        item.task.cancel();
      } catch {
        /* ignore */
      }
    }
    item.canvas.width = 0;
    item.canvas.height = 0;
    item.canvas.classList.remove('is-ready');
    item.textDiv.replaceChildren();
    item.rendered = false;
    item.renderedScale = null;
  }

  // Render pages near the viewport; unload the ones that scrolled far away.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.i);
        if (entry.isIntersecting) renderOne(i);
        else unload(i);
      }
    },
    { root: view, rootMargin: '600px 0px 600px 0px' },
  );

  // --- search ---
  function highlightItem(item: PageItem): void {
    const q = stripWs(query);
    if (!q) return;
    const spans = [...item.textDiv.querySelectorAll('span')];
    const compact: string[] = [];
    const map: { s: number; c: number }[] = []; // map[k] = { s: spanIndex, c: charIndex }
    for (let s = 0; s < spans.length; s++) {
      const t = spans[s].textContent ?? '';
      for (let c = 0; c < t.length; c++) {
        if (/\s/.test(t[c])) continue;
        compact.push(t[c].toLowerCase());
        map.push({ s, c });
      }
    }
    const hay = compact.join('');
    const marked = new Map<number, Set<number>>(); // spanIndex -> Set(charIndex)
    for (let idx = hay.indexOf(q); idx !== -1; idx = hay.indexOf(q, idx + q.length)) {
      for (let k = idx; k < idx + q.length; k++) {
        const { s, c } = map[k];
        if (!marked.has(s)) marked.set(s, new Set());
        marked.get(s)!.add(c);
      }
    }
    for (const [s, set] of marked) {
      const t = spans[s].textContent ?? '';
      let html = '';
      let inMark = false;
      for (let c = 0; c < t.length; c++) {
        const isWs = /\s/.test(t[c]);
        if (set.has(c) && !inMark) {
          html += '<mark class="pdf-mark">';
          inMark = true;
        } else if (inMark && !set.has(c) && !isWs) {
          html += '</mark>';
          inMark = false;
        }
        html += escapeHtml(t[c]);
      }
      if (inMark) html += '</mark>';
      spans[s].innerHTML = html;
    }
  }

  function clearHighlights(): void {
    for (const item of pageEls) {
      if (!item.rendered) continue;
      for (const span of item.textDiv.querySelectorAll('span')) {
        if (span.querySelector('.pdf-mark')) span.innerHTML = escapeHtml(span.textContent ?? '');
      }
    }
  }

  async function runSearch(): Promise<void> {
    query = search.value.trim().toLowerCase();
    matches = [];
    matchIdx = -1;
    clearHighlights();
    if (!query) {
      matchLabel.textContent = '';
      return;
    }
    matchLabel.textContent = 'Searching…';
    const compactQuery = stripWs(query);
    for (let p = 1; p <= pdf!.numPages; p++) {
      if (stripWs(await getText(p)).includes(compactQuery)) matches.push(p - 1);
    }
    pageEls.forEach((item) => item.rendered && highlightItem(item));
    if (matches.length) {
      matchIdx = 0;
      await goToMatch(0);
    } else {
      matchLabel.textContent = 'No matches';
    }
  }

  async function goToMatch(absIdx: number): Promise<void> {
    matchIdx = (absIdx + matches.length) % matches.length;
    matchLabel.textContent = `${matchIdx + 1} / ${matches.length}`;
    const pageIdx = matches[matchIdx];
    scrollToPage(pageIdx);
    await renderOne(pageIdx);
    const mark = pageEls[pageIdx].textDiv.querySelector('.pdf-mark');
    mark?.scrollIntoView({ block: 'center' });
  }

  searchPrev.addEventListener('click', () => matches.length && goToMatch(matchIdx - 1));
  searchNext.addEventListener('click', () => matches.length && goToMatch(matchIdx + 1));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (matches.length && search.value.trim().toLowerCase() === query) goToMatch(matchIdx + 1);
    else runSearch();
  });

  // --- highlights + comments ---
  async function loadAnnotations(): Promise<void> {
    let annotations: Annotation[];
    try {
      annotations =
        ((await getApi(`books/${book.id}/annotations`)) as { annotations?: Annotation[] }).annotations || [];
    } catch {
      return;
    }
    annByPage.clear();
    for (const a of annotations) {
      const i = a.page - 1;
      if (!annByPage.has(i)) annByPage.set(i, []);
      annByPage.get(i)!.push(a);
    }
    pageEls.forEach((_, i) => drawPage(i));
    renderSidebar();
  }

  function allAnnots(): Annotation[] {
    const out: Annotation[] = [];
    for (const arr of annByPage.values()) out.push(...arr);
    out.sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0));
    return out;
  }

  function toggleSide(): void {
    root.classList.toggle('notes-open');
    sideBtn.classList.toggle('is-active', root.classList.contains('notes-open'));
  }

  function renderSidebar(): void {
    const items = allAnnots();
    const head = el('div', 'pdf-side-head');
    head.append(el('span', 'pdf-side-title', 'Notes'), el('span', 'pdf-side-count', String(items.length)));
    const body = el('div', 'pdf-side-list');
    if (!items.length) {
      body.append(
        el('p', 'pdf-side-empty', 'No highlights yet. Select text in the book to highlight it or add a note.'),
      );
    }
    for (const a of items) {
      const color = COLORS.includes(a.color ?? '') ? a.color : 'yellow';
      const row = el('div', 'pdf-side-item');
      row.append(el('span', `pdf-side-dot pdf-color-${color}`));
      const txt = el('div', 'pdf-side-text-wrap');
      txt.append(el('span', 'pdf-side-text', a.text || '(highlight)'));
      if (a.comment) txt.append(el('span', 'pdf-side-note', a.comment));
      txt.append(el('span', 'pdf-side-page', `Page ${a.page}`));
      txt.addEventListener('click', () => jumpToAnnot(a));
      const del = el('button', 'icon-button pdf-side-del', ICON.trash);
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAnnot(a);
      });
      row.append(txt, del);
      body.append(row);
    }
    side.replaceChildren(head, body);
  }

  async function removeAnnot(a: Annotation): Promise<void> {
    try {
      await jsonApi('DELETE', `books/${book.id}/annotations/${a.id}`);
    } catch {
      /* ignore */
    }
    const i = a.page - 1;
    const arr = annByPage.get(i) || [];
    const idx = arr.indexOf(a);
    if (idx >= 0) arr.splice(idx, 1);
    drawPage(i);
    renderSidebar();
    if (!popup.hidden) hidePopup();
  }

  function jumpToAnnot(a: Annotation): void {
    const item = pageEls[a.page - 1];
    if (!item) return;
    if (root.classList.contains('notes-open')) toggleSide();
    renderOne(a.page - 1);
    const target = item.hl.querySelector(`[data-id="${a.id}"]`) || item.wrap;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.hl.querySelectorAll(`[data-id="${a.id}"]`).forEach((d) => {
      d.classList.add('is-flash');
      setTimeout(() => d.classList.remove('is-flash'), 1300);
    });
  }

  // Highlights are positioned in % of the page box, so they track zoom for free.
  function drawPage(i: number): void {
    const item = pageEls[i];
    if (!item) return;
    item.hl.replaceChildren();
    for (const a of annByPage.get(i) || []) {
      const color = COLORS.includes(a.color ?? '') ? a.color : 'yellow';
      a.rects.forEach((r, idx) => {
        const d = el('div', `pdf-hl pdf-hl-${color}`);
        d.dataset.id = a.id;
        d.style.left = `${r.x * 100}%`;
        d.style.top = `${r.y * 100}%`;
        d.style.width = `${r.w * 100}%`;
        d.style.height = `${r.h * 100}%`;
        if (a.comment && idx === a.rects.length - 1) d.classList.add('has-note');
        item.hl.append(d);
      });
    }
  }

  function annotAt(i: number, fx: number, fy: number): Annotation | null {
    for (const a of annByPage.get(i) || []) {
      for (const r of a.rects) {
        if (fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h) return a;
      }
    }
    return null;
  }

  // Normalized rects for the current text selection, restricted to one page.
  function selectionSnapshot(): Selection | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
    const node = (sel.anchorNode?.parentElement ?? sel.anchorNode) as Element | null;
    const wrap = node?.closest?.('.pdf-page') as HTMLElement | null;
    if (!wrap) return null;
    const i = Number(wrap.dataset.i);
    const box = wrap.getBoundingClientRect();
    const rects: Rect[] = [];
    for (const r of sel.getRangeAt(0).getClientRects()) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) continue;
      if (r.width < 1 || r.height < 1) continue;
      rects.push({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        w: r.width / box.width,
        h: r.height / box.height,
      });
    }
    if (!rects.length) return null;
    return { page: i + 1, rects, text: sel.toString().trim() };
  }

  // A single reused floating popup (create-from-selection and edit).
  const popup = el('div', 'pdf-popup');
  popup.hidden = true;
  root.append(popup);
  let lastPointer = { x: 0, y: 0 };
  const hidePopup = (): void => {
    popup.hidden = true;
    popup.replaceChildren();
  };

  function placePopup(clientX: number, clientY: number): void {
    popup.hidden = false;
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    const r = root.getBoundingClientRect();
    const left = clientX - r.left - w / 2;
    let top = clientY - r.top + 14;
    if (top + h > root.clientHeight - 8) top = clientY - r.top - h - 14; // flip above
    popup.style.left = `${clamp(left, 8, Math.max(8, root.clientWidth - w - 8))}px`;
    popup.style.top = `${clamp(top, 8, Math.max(8, root.clientHeight - h - 8))}px`;
  }

  function colorRow(active: string | null, onPick: (c: string) => void): HTMLElement {
    const row = el('div', 'pdf-colors');
    const btns = COLORS.map((c) => {
      const b = el('button', `pdf-color pdf-color-${c}${c === active ? ' is-active' : ''}`);
      b.title = c;
      b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        onPick(c);
      });
      row.append(b);
      return b;
    });
    return row;
  }

  async function createAnnot(snap: Selection, color: string, withComment: boolean): Promise<void> {
    let annot: Annotation;
    try {
      annot = (await jsonApi('POST', `books/${book.id}/annotations`, {
        page: snap.page,
        rects: snap.rects,
        text: snap.text,
        color,
      })) as Annotation;
    } catch {
      return;
    }
    const i = snap.page - 1;
    if (!annByPage.has(i)) annByPage.set(i, []);
    annByPage.get(i)!.push(annot);
    window.getSelection()?.removeAllRanges();
    drawPage(i);
    renderSidebar();
    if (withComment) openEditPopup(annot, lastPointer.x, lastPointer.y);
    else hidePopup();
  }

  function openSelectionPopup(snap: Selection, x: number, y: number): void {
    popup.replaceChildren();
    popup.append(colorRow(null, (c) => createAnnot(snap, c, false)));
    const note = el('button', 'pdf-popup-note', `${ICON.note}<span>Note</span>`);
    note.addEventListener('click', () => createAnnot(snap, 'yellow', true));
    popup.append(note);
    placePopup(x, y);
  }

  function openEditPopup(annot: Annotation, x: number, y: number): void {
    const i = annot.page - 1;
    popup.replaceChildren();
    popup.append(
      colorRow(annot.color ?? null, async (c) => {
        annot.color = c;
        drawPage(i);
        renderSidebar();
        try {
          await jsonApi('PATCH', `books/${book.id}/annotations/${annot.id}`, { color: c });
        } catch {
          /* ignore */
        }
      }),
    );
    const ta = el('textarea', 'pdf-popup-comment');
    ta.placeholder = 'Add a note…';
    ta.value = annot.comment || '';
    popup.append(ta);
    const actions = el('div', 'pdf-popup-actions');
    const save = el('button', 'button-primary', 'Save');
    save.addEventListener('click', async () => {
      annot.comment = ta.value.trim();
      try {
        await jsonApi('PATCH', `books/${book.id}/annotations/${annot.id}`, { comment: annot.comment });
      } catch {
        /* ignore */
      }
      drawPage(i);
      renderSidebar();
      hidePopup();
    });
    const del = el('button', 'icon-button pdf-popup-del', ICON.trash);
    del.title = 'Delete highlight';
    del.addEventListener('click', () => removeAnnot(annot));
    actions.append(save, del);
    popup.append(actions);
    placePopup(x, y);
    requestAnimationFrame(() => ta.focus());
  }

  // A selection offers to highlight; a plain click on a highlight opens its note.
  view.addEventListener('mouseup', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    const target = e.target as Element;
    if (target.closest('.pdf-popup')) return;
    const snap = selectionSnapshot();
    if (snap) {
      openSelectionPopup(snap, e.clientX, e.clientY);
      return;
    }
    const wrap = target.closest('.pdf-page') as HTMLElement | null;
    if (wrap) {
      const i = Number(wrap.dataset.i);
      const box = wrap.getBoundingClientRect();
      const a = annotAt(i, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
      if (a) {
        openEditPopup(a, e.clientX, e.clientY);
        return;
      }
    }
    hidePopup();
  });

  // --- scroll + resize ---
  let scrollRaf = 0;
  view.addEventListener(
    'scroll',
    () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        updateCurrent();
        if (!popup.hidden) hidePopup();
      });
    },
    { passive: true },
  );

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!pdf || view.clientWidth === 0) return;
      measure();
      updateCurrent();
    }, 150);
  });
  ro.observe(view);

  // --- boot ---
  void (async () => {
    try {
      pdf = await pdfjsLib.getDocument({ url: (await fileUrl(`books/${book.id}/file`)) as string }).promise;
      const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
      base1 = { width: vp.width, height: vp.height };
      // Restore the per-book zoom if we saved one, else fit to width.
      scale = book.zoom ? clamp(book.zoom, ZOOM_MIN, ZOOM_MAX) : defaultScale();
      setZoomLabel();

      showControls();
      pagesEl.replaceChildren();
      for (let i = 0; i < pdf.numPages; i++) {
        const wrap = el('div', 'pdf-page');
        wrap.dataset.i = String(i);
        const canvas = el('canvas', 'pdf-canvas');
        const hl = el('div', 'pdf-hl-layer'); // highlights (% positioned, scale-free)
        const textDiv = el('div', 'pdf-text-layer');
        wrap.append(canvas, hl, textDiv);
        const item: PageItem = {
          wrap,
          canvas,
          hl,
          textDiv,
          base: base1,
          rendered: false,
          rendering: false,
          renderedScale: null,
          task: null,
        };
        sizeWrap(item);
        pagesEl.append(wrap);
        pageEls.push(item);
        io.observe(wrap);
      }

      await loadAnnotations();

      const start = clamp((book.lastPage || 1) - 1, 0, pdf.numPages - 1);
      requestAnimationFrame(() => {
        measure();
        scrollToPage(start);
        setCurrent(start + 1);
        pageLabel.textContent = `${start + 1} / ${pdf!.numPages}`;
        updateCurrent();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pagesEl.replaceChildren(el('p', 'app-error', `Couldn't open this PDF: ${msg}`));
    }
  })();

  // Immersive reading: auto-hiding floating toolbar when the window is maximized.
  const REVEAL_ZONE = 72; // px from the top that reveals the bar
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  function setPeek(on: boolean): void {
    if (peekTimer) clearTimeout(peekTimer);
    if (on) root.classList.add('peek');
    else peekTimer = setTimeout(() => root.classList.remove('peek'), 450);
  }
  function onPointerMove(e: MouseEvent): void {
    if (!root.closest('.dialog.is-max')) return; // only in fullscreen
    setPeek(e.clientY - root.getBoundingClientRect().top < REVEAL_ZONE);
  }
  const keepBar = (): void => setPeek(true);
  const releaseBar = (): void => setPeek(false);
  root.addEventListener('mousemove', rafThrottle(onPointerMove));
  bar.addEventListener('focusin', keepBar);
  bar.addEventListener('focusout', releaseBar);

  return {
    el: root,
    destroy() {
      io.disconnect();
      ro.disconnect();
      if (peekTimer) clearTimeout(peekTimer);
      root.removeEventListener('mousemove', onPointerMove);
    },
  };
}
