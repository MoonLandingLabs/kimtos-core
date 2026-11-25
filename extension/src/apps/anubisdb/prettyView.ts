// Human-friendly renderer for arbitrary stored values (AnubisDB record / kv
// inspection). Turns raw JSON into a readable field view — typed values, smart
// timestamps, links, image thumbnails, collapsible nesting, clamped long text —
// so a non-developer can actually read their data. The raw JSON stays one click
// away in the inspector; this is the default "Formatted" view.

import { el } from '../../lib/dom.js';

const MAX_STR = 300; // chars before a string is clamped with a "show all"
const MAX_DEPTH = 6; // beyond this, fall back to compact JSON (guards cycles/huge trees)

// Keys whose numeric value is almost certainly a time (epoch), so we date-format it.
const DATE_KEY =
  /(updated|created|modified|deleted|expires?|ended?|ends|started?|starts|last\w*|seen|synced|timestamp|^ts$|time|date|at)$/i;

/** camelCase / snake_case field key → readable "Title Case". */
function humanKey(k: string): string {
  return (
    k
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
      .replace(/\bId\b/g, 'ID')
      .replace(/\bUrl\b/g, 'URL')
      .trim() || k
  );
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const past = diff >= 0;
  const a = Math.abs(diff);
  const MIN = 60_000,
    HR = 3_600_000,
    DAY = 86_400_000;
  if (a < MIN) return 'just now';
  let v: string;
  if (a < HR) v = `${Math.round(a / MIN)}m`;
  else if (a < DAY) v = `${Math.round(a / HR)}h`;
  else if (a < 30 * DAY) v = `${Math.round(a / DAY)}d`;
  else return '';
  return past ? `${v} ago` : `in ${v}`;
}

function fmtDate(n: number): HTMLElement {
  const ms = n < 1e12 ? n * 1000 : n; // accept seconds or milliseconds
  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    const bad = el('span', 'av-num');
    bad.textContent = String(n);
    return bad;
  }
  const s = el('span', 'av-date');
  s.textContent = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  s.title = d.toISOString();
  const rel = relTime(ms);
  if (rel) s.append(el('span', 'av-rel', ` · ${rel}`));
  return s;
}

function renderNumber(n: number, key?: string): HTMLElement {
  const epochMs = n > 1e12 && n < 4.1e12; // 13-digit ms, ~2001–2100 → definitely a time
  const dateByKey = !!key && DATE_KEY.test(key) && ((n > 9e8 && n < 4.1e9) || (n > 9e11 && n < 4.1e12));
  if (epochMs || dateByKey) return fmtDate(n);
  const s = el('span', 'av-num');
  s.textContent = Number.isInteger(n) ? n.toLocaleString() : String(n);
  return s;
}

function renderString(str: string, _key?: string): HTMLElement {
  const s = str.trim();
  if (/^https?:\/\/\S+$/i.test(s)) {
    const a = el('a', 'av-link');
    a.href = s;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = s;
    return a;
  }
  if (/^data:image\//i.test(s)) {
    const img = el('img', 'av-img');
    img.src = s;
    img.alt = '';
    return img;
  }
  if (/^data:/i.test(s)) {
    return el('span', 'av-binary', `binary · ${str.length.toLocaleString()} chars`);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ][\d:.]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return fmtDate(d.getTime());
  }
  if (str.length > MAX_STR) {
    const wrap = el('span', 'av-str');
    const clip = el('span');
    clip.textContent = str.slice(0, MAX_STR) + '… ';
    const more = el('button', 'av-more');
    more.type = 'button';
    more.textContent = 'show all';
    more.addEventListener('click', () => {
      clip.textContent = str;
      more.remove();
    });
    wrap.append(clip, more);
    return wrap;
  }
  const span = el('span', 'av-str');
  if (str) span.textContent = str;
  else {
    span.textContent = 'empty';
    span.classList.add('av-empty');
  }
  return span;
}

function boolChip(b: boolean): HTMLElement {
  const s = el('span', `av-bool is-${b}`);
  s.textContent = b ? 'Yes' : 'No';
  return s;
}

function rawSpan(v: unknown): HTMLElement {
  const s = el('code', 'av-raw');
  try {
    s.textContent = JSON.stringify(v);
  } catch {
    s.textContent = String(v);
  }
  return s;
}

// A collapsible wrapper for nested objects/arrays. Toggling mutates a class
// directly (no parent re-render), so open/closed state survives AnubisDB redraws.
function collapsible(label: string, count: number, body: HTMLElement, open: boolean): HTMLElement {
  const wrap = el('div', `av-node${open ? '' : ' is-collapsed'}`);
  const head = el('button', 'av-node-head');
  head.type = 'button';
  head.append(el('span', 'av-caret'), el('span', 'av-node-label', label));
  head.append(el('span', 'av-node-count', String(count)));
  head.addEventListener('click', () => wrap.classList.toggle('is-collapsed'));
  wrap.append(head, body);
  return wrap;
}

function renderObject(obj: Record<string, unknown>, depth: number): HTMLElement {
  const box = el('div', 'av-obj');
  for (const k of Object.keys(obj)) {
    const row = el('div', 'av-field');
    row.append(el('span', 'av-key', humanKey(k)));
    const v = el('div', 'av-v');
    v.append(renderValue(obj[k], k, depth + 1));
    row.append(v);
    box.append(row);
  }
  return box;
}

function renderArray(arr: unknown[], depth: number): HTMLElement {
  const allPrimitive = arr.every((x) => x === null || typeof x !== 'object');
  if (allPrimitive) {
    const inline = el('div', 'av-inline');
    arr.forEach((x, i) => {
      if (i) inline.append(el('span', 'av-sep', ', '));
      inline.append(renderValue(x, undefined, depth + 1));
    });
    return inline;
  }
  const list = el('div', 'av-list');
  arr.forEach((x, i) => {
    const item = el('div', 'av-item');
    item.append(el('span', 'av-idx', `${i + 1}`));
    const v = el('div', 'av-item-v');
    v.append(renderValue(x, undefined, depth + 1));
    item.append(v);
    list.append(item);
  });
  return list;
}

/** The type name shown for a top-level scalar ('string' | 'number' | 'boolean' | 'null'). */
function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  return typeof value;
}

/** A primitive at the very top level — a KV entry that is itself just a string,
 *  number, boolean or null (e.g. `devtools:lastTool = "diff"`). Rendered bare it
 *  is a lone word, indistinguishable from the raw JSON, so the Formatted toggle
 *  looks broken (#417). Frame it in a typed one-row view instead, reusing the
 *  object-field layout so the type and value read distinctly. */
function scalarRoot(value: unknown, key?: string): HTMLElement {
  const box = el('div', 'av-obj av-scalar');
  const row = el('div', 'av-field');
  row.append(el('span', 'av-key av-scalar-type', typeName(value)));
  const v = el('div', 'av-v');
  v.append(renderValue(value, key, 1)); // depth 1: the normal primitive render, no re-frame
  row.append(v);
  box.append(row);
  return box;
}

/** Render any value to a readable DOM node. */
export function renderValue(value: unknown, key?: string, depth = 0): HTMLElement {
  if (depth === 0 && (value === null || typeof value !== 'object')) return scalarRoot(value, key);
  if (value === null || value === undefined) return el('span', 'av-null', '—');
  const t = typeof value;
  if (t === 'boolean') return boolChip(value as boolean);
  if (t === 'number') return renderNumber(value as number, key);
  if (t === 'string') return renderString(value as string, key);
  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) return rawSpan(value);
    if (!value.length) return el('span', 'av-empty', 'empty list');
    const body = renderArray(value, depth);
    return depth === 0 ? body : collapsible('items', value.length, body, depth < 1);
  }
  if (t === 'object') {
    if (depth > MAX_DEPTH) return rawSpan(value);
    const obj = value as Record<string, unknown>;
    const body = renderObject(obj, depth);
    return depth === 0 ? body : collapsible('fields', Object.keys(obj).length, body, depth < 2);
  }
  return el('span', 'av-val', String(value));
}

/** Parse a stored JSON string and render it; falls back to raw text on error. */
export function renderJson(json: string): HTMLElement {
  try {
    return renderValue(JSON.parse(json) as unknown, undefined, 0);
  } catch {
    const pre = el('pre', 'anubis-json');
    pre.textContent = json;
    return pre;
  }
}
