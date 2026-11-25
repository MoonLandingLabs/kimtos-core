// DevTools — pure transforms, shared by the UI and the agent tools.
// Everything here runs on-device with plain browser APIs; nothing touches the
// network. Functions throw an Error with a friendly message on bad input so the
// UI can show it inline and the agent tools can report `ok: false`.

// ---- JSON ----------------------------------------------------------------
import { clamp } from '../../lib/num.js';

// Lorem ipsum and UUID are not DevTools facts — they are "make something up" primitives, and
// FakeForm needs the same two. They live in the one shared generator now (#222) and are
// re-exported here so this module's API, and every caller of it, is unchanged.
export { lorem, uuidV4 } from '../../lib/fakeData.js';
export function formatJson(input: string, indent = 2): string {
  return JSON.stringify(JSON.parse(input), null, indent);
}
export function minifyJson(input: string): string {
  return JSON.stringify(JSON.parse(input));
}

// ---- Base64 (unicode-safe) ----------------------------------------------
// btoa/atob speak Latin-1 code units, so text crosses through UTF-8 bytes on
// the way in and out — without that, any non-ASCII input corrupts (#631, #722).
// The byte→binary-string step is chunked: spreading one argument per byte
// overflows the call stack on inputs past ~100 kB.
const B64_CHUNK = 0x8000;
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
}
export function decodeBase64(b64: string): string {
  // Forgive wrapping whitespace (copied from an email or a log) and the
  // URL-safe alphabet (JWT segments use - and _ for + and /).
  const clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new Error('That doesn’t look like Base64 (A–Z, a–z, 0–9, +, / and = only).');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Valid Base64, but the decoded bytes aren’t UTF-8 text.');
  }
}

// ---- URL -----------------------------------------------------------------
// encodeURI keeps a full URL's structure (: / ? & = #), escaping only spaces and
// unicode; encodeURIComponent escapes everything, for a single query value.
export const encodeUri = (s: string): string => encodeURI(s);
export const encodeUrl = (s: string): string => encodeURIComponent(s);
export const decodeUrl = (s: string): string => decodeURIComponent(s);

// ---- HTML entities -------------------------------------------------------
const HTML_ENC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_DEC: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};
export const encodeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ENC[c] ?? c);
export const decodeHtml = (s: string): string =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, body: string) => {
    if (HTML_DEC[m]) return HTML_DEC[m];
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });

// ---- JWT decode (no verification — there's no secret on-device) ----------
export function decodeJwt(token: string): string {
  const parts = token.trim().split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error('That doesn’t look like a JWT (expected header.payload.signature).');
  }
  const part = (s: string): unknown => JSON.parse(decodeBase64(s));
  const header = part(parts[0]);
  const payload = part(parts[1]) as Record<string, unknown>;
  const notes: string[] = [];
  const stamp = (label: string, key: string) => {
    const v = payload[key];
    if (typeof v === 'number') notes.push(`${label} (${key}): ${new Date(v * 1000).toISOString()}`);
  };
  stamp('issued', 'iat');
  stamp('not before', 'nbf');
  if (typeof payload.exp === 'number') {
    const expired = payload.exp * 1000 < Date.now();
    notes.push(`expires (exp): ${new Date(payload.exp * 1000).toISOString()} — ${expired ? 'EXPIRED' : 'valid'}`);
  }
  const body = JSON.stringify({ header, payload }, null, 2);
  return notes.length ? `${body}\n\n// ${notes.join('\n// ')}` : body;
}

// ---- Hashing -------------------------------------------------------------
export type HashAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export async function hashText(text: string, algo: HashAlgo): Promise<string> {
  const digest = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- UUID ----------------------------------------------------------------

// ---- Case conversion -----------------------------------------------------
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
export type CaseKind = 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'title' | 'sentence' | 'dot';
export function toCase(input: string, kind: CaseKind): string {
  const w = words(input);
  if (!w.length) return '';
  switch (kind) {
    case 'camel':
      return w.map((x, i) => (i === 0 ? x : cap(x))).join('');
    case 'pascal':
      return w.map(cap).join('');
    case 'snake':
      return w.join('_');
    case 'kebab':
      return w.join('-');
    case 'constant':
      return w.join('_').toUpperCase();
    case 'title':
      return w.map(cap).join(' ');
    case 'sentence':
      return cap(w.join(' '));
    case 'dot':
      return w.join('.');
  }
}

// ---- Color ---------------------------------------------------------------
export interface Color {
  hex: string;
  rgb: string;
  hsl: string;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100,
    ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  const [r, g, b] = (
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  ) as [number, number, number];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const toHex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
function make(r: number, g: number, b: number): Color {
  const [h, s, l] = rgbToHsl(r, g, b);
  return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`, rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${h}, ${s}%, ${l}%)` };
}
export function parseColor(input: string): Color {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m && m[1]) {
    const hex = m[1];
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return make(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16));
  }
  m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return make(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^hsla?\(\s*(\d+)[,\s]+(\d+)%?[,\s]+(\d+)%?/);
  if (m) return make(...hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])));
  throw new Error('Enter a color as #hex, rgb(r, g, b), or hsl(h, s%, l%).');
}

// ---- Timestamp -----------------------------------------------------------
export function epochToDate(value: string): string {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new Error('Enter a Unix timestamp (seconds or milliseconds).');
  const ms = Math.abs(n) < 1e12 ? n * 1000 : n; // seconds vs milliseconds
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error('That timestamp is out of range.');
  return [`ISO 8601:  ${d.toISOString()}`, `Local:     ${d.toString()}`, `UTC:       ${d.toUTCString()}`].join('\n');
}
export function dateToEpoch(value: string): string {
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) throw new Error('Enter a date, e.g. 2026-07-07 or an ISO string.');
  return [`seconds:      ${Math.floor(d.getTime() / 1000)}`, `milliseconds: ${d.getTime()}`].join('\n');
}

// ---- Number base ---------------------------------------------------------
export interface Bases {
  dec: string;
  hex: string;
  bin: string;
  oct: string;
}
export function convertBase(value: string, from: 2 | 8 | 10 | 16): Bases {
  const clean = value.trim().replace(/^0[xbo]/i, '');
  if (!clean) throw new Error('Enter a number.');
  const n = parseInt(clean, from);
  if (Number.isNaN(n)) throw new Error(`“${value}” isn’t a valid base-${from} number.`);
  return { dec: String(n), hex: n.toString(16), bin: n.toString(2), oct: n.toString(8) };
}
