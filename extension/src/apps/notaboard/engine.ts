// NotaBoard canvas engine — a retained-mode whiteboard. The scene is a flat,
// serializable array of `elements` (array order = z-order); everything is drawn
// to one <canvas> each animation frame in WORLD coordinates, under a pan/zoom
// transform. See the original notes for the shape catalogue and gesture design.
// The host element must be position:relative — the text editor overlays it.

import { clamp } from '../../lib/num.js';
import {
  uid,
  clone,
  isPoints,
  distToSeg,
  bounds,
  translateEl,
  scaleEl,
  type Point,
  type SceneElement,
  type Box,
} from './geometry.js';

type Ctx = CanvasRenderingContext2D;

interface NBElement {
  id: string;
  type: string;
  color?: string;
  size: number;
  fill?: boolean;
  tool?: string;
  points: Point[];
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  blobKey?: string;
  fontScale?: number;
  [key: string]: unknown;
}
interface Action {
  kind: string;
  move: (ev: PointerEvent) => void;
  up?: (ev?: PointerEvent) => void;
}
interface Handle {
  el: NBElement;
  dir: string;
  b: Box;
}
interface BoardOptions {
  host: HTMLElement;
  onChange?: () => void;
  onSelectionChange?: (els: NBElement[]) => void;
  resolveImage?: (blobKey: string) => Promise<string | null> | string | null;
}

const HANDLE = 9; // resize-handle hit/visual size, in screen px
const HIT_PAD = 8; // extra world px around thin elements for easier hit-testing
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const HISTORY_LIMIT = 60;
const NOTE_W = 200;
const NOTE_H = 150;
const NOTE_PAD = 14;

const THEME: Record<string, { bg: string; grid: string; dot: string; ink: string }> = {
  light: { bg: '#fbfbfa', grid: 'rgba(37,99,235,0.10)', dot: 'rgba(0,0,0,0.20)', ink: '#1f2937' },
  dark: { bg: '#17171b', grid: 'rgba(255,255,255,0.08)', dot: 'rgba(255,255,255,0.22)', ink: '#ffffff' },
};

export function createBoard({ host, onChange, onSelectionChange, resolveImage }: BoardOptions) {
  const canvas = document.createElement('canvas');
  canvas.className = 'nb-canvas';
  canvas.tabIndex = 0;
  host.appendChild(canvas);
  // `let` (not const): export + the minimap temporarily redirect all drawing to
  // another canvas by swapping this binding, then restore it.
  let ctx: Ctx = canvas.getContext('2d')!;

  const MINI_W = 188;
  const MINI_H = 132;
  const miniCanvas = document.createElement('canvas');
  miniCanvas.className = 'nb-minimap';
  host.appendChild(miniCanvas);
  const miniCtx = miniCanvas.getContext('2d')!;
  let minimapOn = true;
  let miniT = { s: 1, ox: 0, oy: 0 };
  let lineBoost = 1;
  let miniScene: HTMLCanvasElement | null = null;
  let miniDirty = true;
  let miniForce = true;
  let miniTick = 0;

  // --- scene + view + tool state ---
  let elements: NBElement[] = [];
  let paper = 'grid';
  let theme = 'dark'; // default board paper theme (dark/light toggle comes later)
  const view = { x: 0, y: 0, scale: 1 };
  let tool = 'pen';
  const style = { color: '#1f2937', size: 4, fill: false, noteColor: '#fde68a' };
  const selected = new Set<string>();

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  const imageCache = new Map<string, HTMLImageElement | 'loading'>();

  const past: NBElement[][] = [];
  const future: NBElement[][] = [];

  function markSceneDirty(force = false): void {
    miniDirty = true;
    if (force) miniForce = true;
  }

  // --- helpers ---
  const toWorld = (px: number, py: number): Point => ({
    x: (px - view.x) / view.scale,
    y: (py - view.y) / view.scale,
  });
  const measureCtx = ctx;

  const textMeasureCache = new WeakMap<NBElement, { key: string; w: number; h: number }>();
  function measureText(el: NBElement): { key: string; w: number; h: number } {
    const key = `${el.text || ''}|${el.size}`;
    const hit = textMeasureCache.get(el);
    if (hit && hit.key === key) return hit;
    measureCtx.save();
    measureCtx.font = `${el.size}px var(--font), sans-serif`;
    const lines = (el.text || ' ').split('\n');
    let w = 0;
    for (const line of lines) w = Math.max(w, measureCtx.measureText(line || ' ').width);
    measureCtx.restore();
    const m = { key, w: w + 4, h: lines.length * el.size * 1.25 };
    textMeasureCache.set(el, m);
    return m;
  }
  const measureFn = measureText as unknown as (e: SceneElement) => { w: number; h: number };
  const elBounds = (el: NBElement): Box => bounds(el, measureFn);

  function findById(id: string): NBElement | undefined {
    return elements.find((e) => e.id === id);
  }

  // --- rendering ---
  let frame = 0;
  function requestRender(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    requestRender();
  }

  function applyTransform(): void {
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
  }

  function drawPaper(): void {
    const th = THEME[theme] || THEME.light;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (paper === 'plain') return;
    const sp = 26 * view.scale;
    if (sp < 6) return;
    const ox = ((view.x % sp) + sp) % sp;
    const oy = ((view.y % sp) + sp) % sp;
    ctx.strokeStyle = th.grid;
    ctx.fillStyle = th.dot;
    if (paper === 'dots') {
      for (let x = ox; x < cssW; x += sp)
        for (let y = oy; y < cssH; y += sp) {
          ctx.beginPath();
          ctx.arc(x, y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      return;
    }
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = oy; y < cssH; y += sp) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(cssW, y + 0.5);
    }
    if (paper === 'grid') {
      for (let x = ox; x < cssW; x += sp) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, cssH);
      }
    }
    ctx.stroke();
  }

  function strokePath(points: Point[]): void {
    ctx.beginPath();
    if (points.length < 3) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      return;
    }
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawArrowHead(a: Point, b: Point, size: number): void {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.max(10, size * 3.2);
    const spread = 0.42;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len * Math.cos(ang - spread), b.y - len * Math.sin(ang - spread));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len * Math.cos(ang + spread), b.y - len * Math.sin(ang + spread));
    ctx.stroke();
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawElement(el: NBElement): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = el.color || '#1f2937';
    ctx.fillStyle = el.color || '#1f2937';
    ctx.lineWidth = (el.size || 3) * lineBoost;

    if (el.type === 'stroke') {
      ctx.globalAlpha = el.tool === 'highlighter' ? 0.4 : 1;
      ctx.lineWidth = (el.tool === 'highlighter' ? (el.size || 4) * 4 : el.size || 4) * lineBoost;
      if (el.points.length === 1) {
        ctx.beginPath();
        ctx.arc(el.points[0].x, el.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        strokePath(el.points);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (el.type === 'line' || el.type === 'arrow') {
      const [a, b] = el.points;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (el.type === 'arrow') drawArrowHead(a, b, el.size || 3);
      return;
    }
    if (el.type === 'rect' || el.type === 'ellipse') {
      const b = elBounds(el);
      if (el.fill) {
        ctx.globalAlpha = 0.18;
        if (el.type === 'rect') {
          roundRect(b.x, b.y, b.w, b.h, 8);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (el.type === 'rect') {
        roundRect(b.x, b.y, b.w, b.h, 8);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    if (el.type === 'note') {
      ctx.fillStyle = el.color || '#fde68a';
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      roundRect(el.x, el.y, el.w, el.h, 10);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      const noteFont = 15 * (el.fontScale || 1);
      drawWrappedText(el.text || '', el.x + NOTE_PAD, el.y + NOTE_PAD, el.w - NOTE_PAD * 2, noteFont, 1.35, '#3a3a32');
      return;
    }
    if (el.type === 'text') {
      ctx.fillStyle = el.color || '#1f2937';
      ctx.textBaseline = 'top';
      ctx.font = `${el.size}px var(--font), sans-serif`;
      const lines = (el.text || '').split('\n');
      lines.forEach((line, i) => ctx.fillText(line, el.x, el.y + i * el.size * 1.25));
      return;
    }
    if (el.type === 'image') {
      const img = getImage(el.blobKey ?? '');
      if (img && img !== 'loading') ctx.drawImage(img, el.x, el.y, el.w, el.h);
      else {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        roundRect(el.x, el.y, el.w, el.h, 6);
        ctx.fill();
      }
    }
  }

  function drawWrappedText(
    text: string,
    x: number,
    y: number,
    maxW: number,
    fontPx: number,
    lh: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.font = `${fontPx}px var(--font), sans-serif`;
    let cy = y;
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, x, cy);
          cy += fontPx * lh;
          line = word;
        } else {
          line = test;
        }
      }
      ctx.fillText(line, x, cy);
      cy += fontPx * lh;
    }
  }

  function getImage(blobKey: string): HTMLImageElement | 'loading' | null {
    if (imageCache.has(blobKey)) return imageCache.get(blobKey)!;
    if (!resolveImage) return null;
    imageCache.set(blobKey, 'loading');
    Promise.resolve(resolveImage(blobKey))
      .then((url) => {
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          imageCache.set(blobKey, img);
          markSceneDirty(true);
          requestRender();
        };
        img.src = url;
      })
      .catch(() => {});
    return 'loading';
  }

  // The current in-progress gesture element (drawn on top, not yet committed).
  let draft: NBElement | null = null;
  let marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;

  function draw(): void {
    drawPaper();
    applyTransform();
    const vis = { x: -view.x / view.scale, y: -view.y / view.scale, w: cssW / view.scale, h: cssH / view.scale };
    for (const el of elements) {
      if (editing && editing.el === el) continue;
      if (!intersectsView(el, vis)) continue;
      drawElement(el);
    }
    if (draft) drawElement(draft);
    drawSelection();
    if (marquee) drawMarquee();
    renderMinimap();
  }

  function drawExtent(el: NBElement): number {
    if (el.type === 'stroke') return (el.tool === 'highlighter' ? (el.size || 4) * 4 : el.size || 4) / 2 + 2;
    if (el.type === 'arrow') return Math.max(10, (el.size || 3) * 3.2) + (el.size || 0);
    if (el.type === 'note') return 12;
    return (el.size || 0) / 2 + 2;
  }

  function intersectsView(el: NBElement, v: Box): boolean {
    const b = elBounds(el);
    const pad = drawExtent(el);
    return b.x - pad < v.x + v.w && b.x + b.w + pad > v.x && b.y - pad < v.y + v.h && b.y + b.h + pad > v.y;
  }

  function contentBounds(): Box | null {
    if (!elements.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of elements) {
      const b = elBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function rebuildMiniScene(ratio: number): void {
    miniDirty = false;
    const content = contentBounds();
    if (!content) {
      miniScene = null;
      miniT = { s: 1, ox: 0, oy: 0 };
      return;
    }
    const padX = content.w * 0.06 + 12;
    const padY = content.h * 0.06 + 12;
    const wWorld = content.w + padX * 2;
    const hWorld = content.h + padY * 2;
    const s = Math.min(MINI_W / wWorld, MINI_H / hWorld);
    const ox = (MINI_W - wWorld * s) / 2 - (content.x - padX) * s;
    const oy = (MINI_H - hWorld * s) / 2 - (content.y - padY) * s;
    miniT = { s, ox, oy };

    if (!miniScene) miniScene = document.createElement('canvas');
    miniScene.width = MINI_W * ratio;
    miniScene.height = MINI_H * ratio;
    const sceneCtx = miniScene.getContext('2d')!;
    const th = THEME[theme] || THEME.light;
    sceneCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    sceneCtx.fillStyle = th.bg;
    sceneCtx.fillRect(0, 0, MINI_W, MINI_H);

    const saved = { ctx, view: { ...view }, dpr };
    ctx = sceneCtx;
    dpr = ratio;
    view.scale = s;
    view.x = ox;
    view.y = oy;
    lineBoost = Math.min(4, Math.max(1, 1.4 / s));
    applyTransform();
    for (const el of elements) drawElement(el);
    lineBoost = 1;
    ctx = saved.ctx;
    Object.assign(view, saved.view);
    dpr = saved.dpr;
  }

  function renderMinimap(): void {
    const show = minimapOn && elements.length > 0;
    miniCanvas.hidden = !show;
    if (!show) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (miniCanvas.width !== MINI_W * ratio) {
      miniCanvas.width = MINI_W * ratio;
      miniCanvas.height = MINI_H * ratio;
      miniForce = true;
    }
    miniTick += 1;
    if (!miniScene || miniForce || (miniDirty && miniTick % 4 === 0)) {
      rebuildMiniScene(ratio);
      miniDirty = false;
      miniForce = false;
    }

    miniCtx.setTransform(1, 0, 0, 1, 0, 0);
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (miniScene) miniCtx.drawImage(miniScene, 0, 0);

    miniCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    miniCtx.fillStyle = 'rgba(16,185,129,0.16)';
    miniCtx.strokeStyle = 'rgba(16,185,129,0.95)';
    miniCtx.lineWidth = 1.5;
    const vw = { x: -view.x / view.scale, y: -view.y / view.scale, w: cssW / view.scale, h: cssH / view.scale };
    const x0 = clamp(vw.x * miniT.s + miniT.ox, 0, MINI_W);
    const y0 = clamp(vw.y * miniT.s + miniT.oy, 0, MINI_H);
    const x1 = clamp((vw.x + vw.w) * miniT.s + miniT.ox, 0, MINI_W);
    const y1 = clamp((vw.y + vw.h) * miniT.s + miniT.oy, 0, MINI_H);
    miniCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
    miniCtx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  function minimapTo(e: PointerEvent): void {
    const rect = miniCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - miniT.ox) / miniT.s;
    const wy = (my - miniT.oy) / miniT.s;
    view.x = cssW / 2 - wx * view.scale;
    view.y = cssH / 2 - wy * view.scale;
    requestRender();
    onView?.();
  }
  miniCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    miniCanvas.setPointerCapture(e.pointerId);
    minimapTo(e);
    const move = (ev: PointerEvent): void => minimapTo(ev);
    const up = (): void => {
      miniCanvas.releasePointerCapture(e.pointerId);
      miniCanvas.removeEventListener('pointermove', move);
      miniCanvas.removeEventListener('pointerup', up);
    };
    miniCanvas.addEventListener('pointermove', move);
    miniCanvas.addEventListener('pointerup', up);
  });

  function drawSelection(): void {
    if (!selected.size || tool !== 'select') return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(16,185,129,0.95)';
    ctx.lineWidth = 1.5;
    const single = selected.size === 1 ? findById([...selected][0]) : null;
    for (const id of selected) {
      const el = findById(id);
      if (!el) continue;
      const b = elBounds(el);
      const x = b.x * view.scale + view.x;
      const y = b.y * view.scale + view.y;
      const w = b.w * view.scale;
      const h = b.h * view.scale;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      ctx.setLineDash([]);
    }
    if (single) {
      const b = elBounds(single);
      const corners = handlePoints(b);
      ctx.fillStyle = '#fff';
      for (const c of corners) {
        const sx = c.x * view.scale + view.x;
        const sy = c.y * view.scale + view.y;
        ctx.fillRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
      }
    }
  }

  function handlePoints(b: Box): { x: number; y: number; dir: string }[] {
    return [
      { x: b.x, y: b.y, dir: 'nw' },
      { x: b.x + b.w, y: b.y, dir: 'ne' },
      { x: b.x + b.w, y: b.y + b.h, dir: 'se' },
      { x: b.x, y: b.y + b.h, dir: 'sw' },
    ];
  }

  function drawMarquee(): void {
    if (!marquee) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(16,185,129,0.12)';
    ctx.strokeStyle = 'rgba(16,185,129,0.8)';
    ctx.lineWidth = 1;
    const x = Math.min(marquee.x0, marquee.x1);
    const y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0);
    const h = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  // --- history ---
  function snapshot(): NBElement[] {
    return elements.map((e) => clone(e));
  }
  function pushHistory(prev: NBElement[]): void {
    past.push(prev);
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  function commit(prev: NBElement[]): void {
    pushHistory(prev);
    markSceneDirty(true);
    onChange?.();
  }

  // --- hit testing ---
  function hitHandle(world: Point): Handle | null {
    if (selected.size !== 1 || tool !== 'select') return null;
    const el = findById([...selected][0]);
    if (!el) return null;
    const b = elBounds(el);
    const r = HANDLE / view.scale;
    for (const c of handlePoints(b)) {
      if (Math.abs(world.x - c.x) <= r && Math.abs(world.y - c.y) <= r) return { el, dir: c.dir, b };
    }
    return null;
  }

  function hitElement(world: Point): NBElement | null {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (elementHit(el, world)) return el;
    }
    return null;
  }

  function elementHit(el: NBElement, p: Point): boolean {
    const pad = HIT_PAD / view.scale;
    if (el.type === 'stroke') {
      const t = (el.tool === 'highlighter' ? (el.size || 4) * 4 : el.size || 4) / 2 + pad;
      for (let i = 0; i < el.points.length - 1; i++) {
        if (distToSeg(p, el.points[i], el.points[i + 1]) <= t) return true;
      }
      return el.points.length === 1 && Math.hypot(p.x - el.points[0].x, p.y - el.points[0].y) <= t;
    }
    if (el.type === 'line' || el.type === 'arrow') {
      return distToSeg(p, el.points[0], el.points[1]) <= (el.size || 3) / 2 + pad;
    }
    const b = elBounds(el);
    return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  }

  // --- pointer interaction ---
  let action: Action | null = null;

  function eventPoint(e: PointerEvent): { sx: number; sy: number } {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }
  const eventWorld = (e: PointerEvent): Point => {
    const { sx, sy } = eventPoint(e);
    return toWorld(sx, sy);
  };

  function onPointerDown(e: PointerEvent): void {
    if (e.button === 1 || (e.button === 0 && spaceDown) || tool === 'pan') {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    const { sx, sy } = eventPoint(e);
    const world = toWorld(sx, sy);

    if (tool === 'select') return selectDown(world, sx, sy, e.shiftKey);
    if (tool === 'eraser') return eraseDown(world);
    if (tool === 'text') return placeText(world);
    if (tool === 'note') return placeNote(world);
    if (tool === 'pen' || tool === 'highlighter') return penDown(world);
    return shapeDown(world);
  }

  // -- pan/zoom --
  let spaceDown = false;
  function startPan(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    action = {
      kind: 'pan',
      move: (ev) => {
        view.x = start.vx + (ev.clientX - start.x);
        view.y = start.vy + (ev.clientY - start.y);
        syncEditor();
        requestRender();
      },
      up: () => {},
    };
    host.classList.add('is-panning');
  }

  function zoomAt(sx: number, sy: number, factor: number): void {
    const before = toWorld(sx, sy);
    view.scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
    view.x = sx - before.x * view.scale;
    view.y = sy - before.y * view.scale;
    syncEditor();
    requestRender();
    onView?.();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    } else {
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      syncEditor();
      requestRender();
    }
  }

  // -- select / move / resize / marquee --
  function selectDown(world: Point, sx: number, sy: number, additive: boolean): void {
    const handle = hitHandle(world);
    if (handle) {
      const prev = snapshot();
      const b = handle.b;
      const anchor = {
        nw: { x: b.x + b.w, y: b.y + b.h },
        ne: { x: b.x, y: b.y + b.h },
        se: { x: b.x, y: b.y },
        sw: { x: b.x + b.w, y: b.y },
      }[handle.dir]!;
      const el0 = clone(handle.el);
      let resized = false;
      action = {
        kind: 'resize',
        move: (ev) => {
          const p = eventWorld(ev);
          const w0 = b.w || 1;
          const h0 = b.h || 1;
          let sxr = (p.x - anchor.x) / (handle.dir.includes('w') ? -w0 : w0);
          let syr = (p.y - anchor.y) / (handle.dir.includes('n') ? -h0 : h0);
          if (!Number.isFinite(sxr) || Math.abs(sxr) < 0.02) sxr = 0.02;
          if (!Number.isFinite(syr) || Math.abs(syr) < 0.02) syr = 0.02;
          const fresh = clone(el0);
          scaleEl(fresh, sxr, syr, anchor.x, anchor.y);
          Object.assign(handle.el, fresh);
          resized = true;
          markSceneDirty();
          requestRender();
        },
        up: () => {
          if (resized) commit(prev);
        },
      };
      return;
    }

    const hit = hitElement(world);
    if (hit) {
      if (additive) {
        if (selected.has(hit.id)) selected.delete(hit.id);
        else selected.add(hit.id);
      } else if (!selected.has(hit.id)) {
        selected.clear();
        selected.add(hit.id);
      }
      emitSelection();
      const prev = snapshot();
      let last = world;
      let moved = false;
      action = {
        kind: 'move',
        move: (ev) => {
          const p = eventWorld(ev);
          const dx = p.x - last.x;
          const dy = p.y - last.y;
          last = p;
          if (dx || dy) moved = true;
          for (const id of selected) {
            const el = findById(id);
            if (el) translateEl(el, dx, dy);
          }
          if (moved) markSceneDirty();
          requestRender();
        },
        up: () => {
          if (moved) commit(prev);
        },
      };
      requestRender();
      return;
    }

    if (!additive) {
      selected.clear();
      emitSelection();
    }
    marquee = { x0: sx, y0: sy, x1: sx, y1: sy };
    const base = new Set(selected);
    action = {
      kind: 'marquee',
      move: (ev) => {
        const p = eventPoint(ev);
        marquee!.x1 = p.sx;
        marquee!.y1 = p.sy;
        const r = marqueeWorld();
        selected.clear();
        base.forEach((id) => selected.add(id));
        for (const el of elements) {
          const b = elBounds(el);
          if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) selected.add(el.id);
        }
        emitSelection();
        requestRender();
      },
      up: () => {
        marquee = null;
        requestRender();
      },
    };
  }

  function marqueeWorld(): Box {
    const a = toWorld(Math.min(marquee!.x0, marquee!.x1), Math.min(marquee!.y0, marquee!.y1));
    const b = toWorld(Math.max(marquee!.x0, marquee!.x1), Math.max(marquee!.y0, marquee!.y1));
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  // -- freehand pen / highlighter --
  function penDown(world: Point): void {
    draft = { id: uid(), type: 'stroke', tool, color: style.color, size: style.size, points: [world] } as NBElement;
    action = {
      kind: 'draw',
      move: (ev) => {
        const p = eventWorld(ev);
        const pts = draft!.points;
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * view.scale >= 1.4) pts.push(p);
        requestRender();
      },
      up: () => {
        const prev = snapshot();
        elements.push(draft!);
        draft = null;
        commit(prev);
        requestRender();
      },
    };
  }

  // -- shapes (rect / ellipse / line / arrow) --
  function shapeDown(world: Point): void {
    const start = world;
    if (tool === 'line' || tool === 'arrow') {
      draft = {
        id: uid(),
        type: tool,
        color: style.color,
        size: style.size,
        points: [start, { ...start }],
      } as NBElement;
    } else {
      draft = {
        id: uid(),
        type: tool,
        color: style.color,
        size: style.size,
        fill: style.fill,
        x: start.x,
        y: start.y,
        w: 0,
        h: 0,
      } as NBElement;
    }
    const hasPoints = tool === 'line' || tool === 'arrow';
    action = {
      kind: 'draw',
      move: (ev) => {
        const p = eventWorld(ev);
        let ex = p.x;
        let ey = p.y;
        if (ev.shiftKey) {
          if (hasPoints) {
            const dx = ex - start.x;
            const dy = ey - start.y;
            if (Math.abs(dx) > Math.abs(dy) * 2) ey = start.y;
            else if (Math.abs(dy) > Math.abs(dx) * 2) ex = start.x;
          } else {
            const s = Math.max(Math.abs(ex - start.x), Math.abs(ey - start.y));
            ex = start.x + Math.sign(ex - start.x || 1) * s;
            ey = start.y + Math.sign(ey - start.y || 1) * s;
          }
        }
        if (hasPoints) draft!.points[1] = { x: ex, y: ey };
        else {
          draft!.w = ex - start.x;
          draft!.h = ey - start.y;
        }
        requestRender();
      },
      up: () => {
        const d = draft!;
        const big = hasPoints
          ? Math.hypot(d.points[1].x - start.x, d.points[1].y - start.y) > 3
          : Math.abs(d.w) > 3 || Math.abs(d.h) > 3;
        if (big) {
          const prev = snapshot();
          elements.push(d);
          commit(prev);
        }
        draft = null;
        requestRender();
      },
    };
  }

  // -- eraser (object eraser: removes whole elements it touches) --
  function eraseDown(world: Point): void {
    const prev = snapshot();
    let removed = false;
    const eraseAt = (p: Point): void => {
      const hit = hitElement(p);
      if (hit) {
        elements = elements.filter((e) => e !== hit);
        selected.delete(hit.id);
        removed = true;
        markSceneDirty();
        requestRender();
      }
    };
    eraseAt(world);
    action = {
      kind: 'erase',
      move: (ev) => eraseAt(eventWorld(ev)),
      up: () => {
        if (removed) {
          emitSelection();
          commit(prev);
        }
      },
    };
  }

  // -- text + sticky note (open the inline editor) --
  function placeText(world: Point): void {
    const el = {
      id: uid(),
      type: 'text',
      color: style.color,
      size: Math.max(16, style.size * 5),
      x: world.x,
      y: world.y,
      text: '',
    } as NBElement;
    openEditor(el, true);
  }
  function placeNote(world: Point): void {
    const el = {
      id: uid(),
      type: 'note',
      color: style.noteColor,
      x: world.x - NOTE_W / 2,
      y: world.y - 20,
      w: NOTE_W,
      h: NOTE_H,
      text: '',
      fontScale: 1,
    } as NBElement;
    openEditor(el, true);
  }

  function onPointerMove(e: PointerEvent): void {
    if (action) action.move(e);
    else updateCursor();
  }
  function onPointerUp(e: PointerEvent): void {
    if (!action) return;
    action.up?.(e);
    action = null;
    host.classList.remove('is-panning');
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  function updateCursor(): void {
    /* cursor is set via CSS by tool class on host */
  }

  // --- in-place text editor (textarea overlaid on the element) ---
  let editing: { el: NBElement; isNew: boolean; input: HTMLTextAreaElement } | null = null;

  function openEditor(el: NBElement, isNew: boolean): void {
    commitEditor();
    const input = document.createElement('textarea');
    input.className = 'nb-text-input' + (el.type === 'note' ? ' is-note' : '');
    input.value = el.text || '';
    input.spellcheck = false;
    if (el.type === 'note') input.style.background = el.color || '#fde68a';
    host.appendChild(input);
    editing = { el, isNew, input };
    positionEditor();
    requestRender();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    input.addEventListener('input', () => {
      if (el.type === 'text') {
        el.text = input.value;
        positionEditor();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditor();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commitEditor();
      }
    });
    input.addEventListener('blur', commitEditor);
  }

  function positionEditor(): void {
    if (!editing) return;
    const { el, input } = editing;
    const x = el.x * view.scale + view.x;
    const y = el.y * view.scale + view.y;
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    if (el.type === 'note') {
      input.style.width = `${el.w * view.scale}px`;
      input.style.height = `${el.h * view.scale}px`;
      input.style.fontSize = `${15 * (el.fontScale || 1) * view.scale}px`;
      input.style.padding = `${NOTE_PAD * view.scale}px`;
    } else {
      input.style.font = `${el.size * view.scale}px var(--font), sans-serif`;
      input.style.color = el.color ?? '';
      input.style.width = '0px';
      input.style.height = '0px';
      input.style.width = `${Math.max(input.scrollWidth + 4, 24)}px`;
      input.style.height = `${input.scrollHeight}px`;
    }
  }
  const syncEditor = positionEditor;

  function commitEditor(): void {
    if (!editing) return;
    const { el, isNew, input } = editing;
    const text = input.value;
    input.removeEventListener('blur', commitEditor);
    input.remove();
    editing = null;
    if (text.trim()) {
      const prev = snapshot();
      el.text = text;
      if (isNew) elements.push(el);
      commit(prev);
    } else if (!isNew) {
      const prev = snapshot();
      elements = elements.filter((e) => e !== el);
      commit(prev);
    }
    requestRender();
  }
  function cancelEditor(): void {
    if (!editing) return;
    const { input } = editing;
    input.removeEventListener('blur', commitEditor);
    input.remove();
    editing = null;
    requestRender();
  }

  function onDblClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitElement(world);
    if (hit && (hit.type === 'text' || hit.type === 'note')) openEditor(hit, false);
  }

  // --- keyboard ---
  const TOOL_KEYS: Record<string, string> = {
    v: 'select',
    p: 'pen',
    b: 'pen',
    h: 'highlighter',
    e: 'eraser',
    r: 'rect',
    o: 'ellipse',
    l: 'line',
    a: 'arrow',
    t: 'text',
    n: 'note',
  };
  function onKeyDown(e: KeyboardEvent): void {
    if (editing) return;
    if (e.key === ' ') {
      spaceDown = true;
      host.classList.add('can-pan');
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (meta && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selectAll();
      return;
    }
    if (meta && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      duplicateSelection();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected.size) {
        e.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (!meta && TOOL_KEYS[e.key.toLowerCase()]) {
      api.setTool(TOOL_KEYS[e.key.toLowerCase()]);
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') {
      spaceDown = false;
      host.classList.remove('can-pan');
    }
  }

  function emitSelection(): void {
    const list = [...selected].map(findById).filter(Boolean) as NBElement[];
    onSelectionChange?.(list);
  }

  // --- listeners ---
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // Hooks the UI can set.
  let onToolChange: ((t: string) => void) | null = null;
  let onView: (() => void) | null = null;

  // --- mutating operations ---
  function undo(): void {
    if (!past.length) return;
    future.push(snapshot());
    elements = past.pop()!;
    pruneSelection();
    markSceneDirty(true);
    onChange?.();
    requestRender();
  }
  function redo(): void {
    if (!future.length) return;
    past.push(snapshot());
    elements = future.pop()!;
    pruneSelection();
    markSceneDirty(true);
    onChange?.();
    requestRender();
  }
  function pruneSelection(): void {
    for (const id of [...selected]) if (!findById(id)) selected.delete(id);
    emitSelection();
  }

  function deleteSelection(): void {
    if (!selected.size) return;
    const prev = snapshot();
    elements = elements.filter((e) => !selected.has(e.id));
    selected.clear();
    emitSelection();
    commit(prev);
    requestRender();
  }
  function selectAll(): void {
    selected.clear();
    elements.forEach((e) => selected.add(e.id));
    if (tool !== 'select') api.setTool('select');
    emitSelection();
    requestRender();
  }
  function duplicateSelection(): void {
    if (!selected.size) return;
    const prev = snapshot();
    const copies: NBElement[] = [];
    for (const el of elements) {
      if (selected.has(el.id)) {
        const c = clone(el);
        c.id = uid();
        translateEl(c, 16, 16);
        copies.push(c);
      }
    }
    elements.push(...copies);
    selected.clear();
    copies.forEach((c) => selected.add(c.id));
    emitSelection();
    commit(prev);
    requestRender();
  }
  function applyToSelection(fn: (el: NBElement) => void): void {
    if (!selected.size) return;
    const prev = snapshot();
    let changed = false;
    for (const el of elements) {
      if (selected.has(el.id)) {
        fn(el);
        changed = true;
      }
    }
    if (changed) commit(prev);
    requestRender();
  }

  function addImageElement({ blobKey, url, w, h }: { blobKey: string; url?: string; w: number; h: number }): void {
    if (url) {
      const img = new Image();
      img.onload = () => {
        markSceneDirty(true);
        requestRender();
      };
      img.src = url;
      imageCache.set(blobKey, img);
    }
    const viewW = cssW / view.scale;
    const max = Math.min(viewW * 0.6, 520);
    let dw = w;
    let dh = h;
    if (dw > max) {
      dh = (dh * max) / dw;
      dw = max;
    }
    const center = toWorld(cssW / 2, cssH / 2);
    const el = {
      id: uid(),
      type: 'image',
      blobKey,
      x: center.x - dw / 2,
      y: center.y - dh / 2,
      w: dw,
      h: dh,
    } as NBElement;
    const prev = snapshot();
    elements.push(el);
    selected.clear();
    selected.add(el.id);
    api.setTool('select');
    emitSelection();
    commit(prev);
    requestRender();
  }

  function zoomToFit(): void {
    if (!elements.length) {
      view.scale = 1;
      view.x = 0;
      view.y = 0;
      requestRender();
      onView?.();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of elements) {
      const b = elBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = 60;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    view.scale = clamp(Math.min(cssW / w, cssH / h), MIN_SCALE, 1.6);
    view.x = (cssW - (maxX + minX) * view.scale) / 2;
    view.y = (cssH - (maxY + minY) * view.scale) / 2;
    requestRender();
    onView?.();
  }

  function renderToCanvas(maxSize: number, background: boolean): HTMLCanvasElement | null {
    if (!elements.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of elements) {
      const b = elBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = 24;
    const w = Math.max(1, maxX - minX + pad * 2);
    const h = Math.max(1, maxY - minY + pad * 2);
    const scale = Math.min(maxSize / w, maxSize / h, 2);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const c = out.getContext('2d')!;
    const saved = { ctx, view: { ...view }, dpr };
    ctx = c;
    dpr = 1;
    view.scale = scale;
    view.x = -minX * scale + pad * scale;
    view.y = -minY * scale + pad * scale;
    if (background) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = (THEME[theme] || THEME.light).bg;
      c.fillRect(0, 0, out.width, out.height);
    }
    applyTransform();
    for (const el of elements) drawElement(el);
    ctx = saved.ctx;
    Object.assign(view, saved.view);
    dpr = saved.dpr;
    requestRender();
    return out;
  }

  function exportThumbnail(): string {
    const out = renderToCanvas(280, true);
    return out ? out.toDataURL('image/webp', 0.7) : '';
  }
  function exportPNG(): Promise<Blob | null> {
    const out = renderToCanvas(2000, true);
    return new Promise((resolve) => {
      if (!out) return resolve(null);
      out.toBlob((b) => resolve(b), 'image/png');
    });
  }

  const api = {
    canvas,
    setElements(els: NBElement[] | null | undefined): void {
      elements = (els || []).map((e) => clone(e));
      selected.clear();
      past.length = 0;
      future.length = 0;
      markSceneDirty(true);
      emitSelection();
      requestRender();
    },
    getElements: (): NBElement[] => elements,
    setPaper(p: string): void {
      paper = p;
      requestRender();
    },
    getPaper: (): string => paper,
    setTheme(t: string): void {
      theme = t === 'dark' ? 'dark' : 'light';
      const lc = style.color.toLowerCase();
      if (theme === 'dark' && lc === THEME.light.ink) style.color = THEME.dark.ink;
      else if (theme === 'light' && lc === THEME.dark.ink) style.color = THEME.light.ink;
      markSceneDirty(true);
      requestRender();
    },
    getTheme: (): string => theme,
    setMinimap(on: boolean): void {
      minimapOn = !!on;
      requestRender();
    },
    isMinimapOn: (): boolean => minimapOn,
    setTool(t: string): void {
      tool = t;
      cancelEditor();
      if (t !== 'select') {
        selected.clear();
        emitSelection();
      }
      host.dataset.tool = t;
      onToolChange?.(t);
      requestRender();
    },
    getTool: (): string => tool,
    setColor(c: string): void {
      style.color = c;
      applyToSelection((el) => {
        if (el.type !== 'note' && el.type !== 'image') el.color = c;
      });
    },
    setSize(n: number): void {
      style.size = n;
      applyToSelection((el) => {
        if (isPoints(el)) el.size = n;
      });
    },
    setFill(on: boolean): void {
      style.fill = on;
      applyToSelection((el) => {
        if (el.type === 'rect' || el.type === 'ellipse') el.fill = on;
      });
    },
    getStyle: () => ({ ...style }),
    undo,
    redo,
    canUndo: (): boolean => past.length > 0,
    canRedo: (): boolean => future.length > 0,
    deleteSelection,
    selectAll,
    duplicateSelection,
    hasSelection: (): boolean => selected.size > 0,
    selectAtPoint(clientX: number, clientY: number): boolean {
      const r = canvas.getBoundingClientRect();
      const hit = hitElement(toWorld(clientX - r.left, clientY - r.top));
      selected.clear();
      if (hit) {
        selected.add(hit.id);
        api.setTool('select');
      }
      emitSelection();
      requestRender();
      return !!hit;
    },
    setNoteColor(c: string): void {
      style.noteColor = c;
      applyToSelection((el) => {
        if (el.type === 'note') el.color = c;
      });
    },
    bringToFront(): void {
      applyOrder((sel, rest) => [...rest, ...sel]);
    },
    sendToBack(): void {
      applyOrder((sel, rest) => [...sel, ...rest]);
    },
    clearBoard(): void {
      if (!elements.length) return;
      const prev = snapshot();
      elements = [];
      selected.clear();
      emitSelection();
      commit(prev);
      requestRender();
    },
    addImageElement,
    zoomIn: () => zoomAt(cssW / 2, cssH / 2, 1.2),
    zoomOut: () => zoomAt(cssW / 2, cssH / 2, 1 / 1.2),
    zoomReset: () => {
      view.scale = 1;
      view.x = 0;
      view.y = 0;
      requestRender();
      onView?.();
    },
    zoomToFit,
    getZoom: (): number => view.scale,
    exportThumbnail,
    exportPNG,
    onToolChange: (fn: (t: string) => void) => {
      onToolChange = fn;
    },
    onViewChange: (fn: () => void) => {
      onView = fn;
    },
    focus: () => canvas.focus(),
    destroy(): void {
      if (frame) cancelAnimationFrame(frame);
      cancelEditor();
      ro.disconnect();
      miniCanvas.remove();
      canvas.remove();
    },
  };

  function applyOrder(fn: (sel: NBElement[], rest: NBElement[]) => NBElement[]): void {
    if (!selected.size) return;
    const prev = snapshot();
    const sel = elements.filter((e) => selected.has(e.id));
    const rest = elements.filter((e) => !selected.has(e.id));
    elements = fn(sel, rest);
    commit(prev);
    requestRender();
  }

  host.dataset.tool = tool;
  resize();
  return api;
}
