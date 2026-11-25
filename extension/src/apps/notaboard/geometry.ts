// Pure scene-geometry primitives for the NotaBoard engine — no DOM, no canvas.
// An "element" is one serializable shape in the scene (see engine.js for the
// shape catalogue). These helpers compute bounds and apply rigid transforms,
// and are unit-testable in isolation.

import { clamp } from '../../lib/num.js';
export interface Point {
  x: number;
  y: number;
}
export interface SceneElement {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  fontScale?: number;
  points: Point[];
  [key: string]: unknown;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 8-char id for scene elements.
export const uid = (): string => Math.random().toString(36).slice(2, 10);

// Deep clone a serializable element/array (structuredClone with a JSON fallback).
export const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

// True for the point-list shapes (freehand stroke, line, arrow); the rest are
// box-based (x/y/w/h).
export const isPoints = (el: SceneElement): boolean =>
  el.type === 'stroke' || el.type === 'line' || el.type === 'arrow';

// Distance from point p to segment a–b (for hit-testing thin elements).
export function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// Axis-aligned bounds of any element, normalized so w/h are positive. Text needs
// a `measure(el) => {w,h}` callback (engine measures via the canvas context).
export function bounds(el: SceneElement, measure?: (el: SceneElement) => { w: number; h: number }): Box {
  if (isPoints(el)) {
    if (!el.points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of el.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === 'text') {
    const m = measure ? measure(el) : { w: 0, h: el.size };
    return { x: el.x, y: el.y, w: m.w, h: m.h };
  }
  const x = el.w < 0 ? el.x + el.w : el.x;
  const y = el.h < 0 ? el.y + el.h : el.y;
  return { x, y, w: Math.abs(el.w), h: Math.abs(el.h) };
}

// Move an element by (dx, dy) in world space (mutates in place).
export function translateEl(el: SceneElement, dx: number, dy: number): void {
  if (isPoints(el)) {
    for (const p of el.points) {
      p.x += dx;
      p.y += dy;
    }
  } else {
    el.x += dx;
    el.y += dy;
  }
}

// Scale an element around anchor (ox, oy) by (sx, sy) (mutates in place). Stroke
// width and text size scale with the geometry so resizing reads naturally.
export function scaleEl(el: SceneElement, sx: number, sy: number, ox: number, oy: number): void {
  if (isPoints(el)) {
    for (const p of el.points) {
      p.x = ox + (p.x - ox) * sx;
      p.y = oy + (p.y - oy) * sy;
    }
    if (el.size) el.size = Math.max(1, el.size * (Math.abs(sx) + Math.abs(sy)) * 0.5);
  } else if (el.type === 'text') {
    el.x = ox + (el.x - ox) * sx;
    el.y = oy + (el.y - oy) * sy;
    // Scale the font by both axes (geometric mean) so any handle grows the text.
    el.size = clamp(el.size * Math.sqrt(Math.abs(sx * sy)), 8, 240);
  } else if (el.type === 'note') {
    el.x = ox + (el.x - ox) * sx;
    el.y = oy + (el.y - oy) * sy;
    el.w *= sx;
    el.h *= sy;
    // Scale the note's text with the box (geometric mean of both axes).
    el.fontScale = Math.max(0.2, (el.fontScale || 1) * Math.sqrt(Math.abs(sx * sy)));
  } else {
    el.x = ox + (el.x - ox) * sx;
    el.y = oy + (el.y - oy) * sy;
    el.w *= sx;
    el.h *= sy;
  }
}
