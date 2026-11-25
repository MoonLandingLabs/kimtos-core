// The shared brand furniture behind every generated asset: the gradient band, the lockup,
// the text/tile primitives, and the app catalog reader.
//
// It lives here rather than in generate.mjs because there are now two renderers over the
// same brand — the store listing (generate.mjs) and the per-app cards (app-cards.mjs) — and
// a second hand-copied band is exactly how the dark promo treatment and the gallery
// treatment drifted apart in the first place. One definition, two callers.
import { readFileSync } from 'node:fs';
import { appTileSvg, brandMarkSvg, BRAND_GRADIENT_STOPS } from '@kimtos/icons';

export { appTileSvg, brandMarkSvg };

export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
export const [B0, B1, B2] = BRAND_GRADIENT_STOPS; // indigo -> teal

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Embed a real app tile at (x,y) sized `s`. */
export const tile = (id, accent, x, y, s) => appTileSvg(id, accent, s).replace('<svg ', `<svg x="${x}" y="${y}" `);

export const text = (x, y, s, w, fill, str, extra = '') =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${s}" font-weight="${w}" fill="${fill}" ${extra}>${esc(str)}</text>`;

/** The brand-gradient band (indigo -> teal) with a soft light bloom at top-left. */
export const brandBand = (w, h, idSuffix = '') => {
  const g = `band${idSuffix}`;
  const b = `bloom${idSuffix}`;
  return `
  <defs>
    <linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${B0}"/><stop offset="0.55" stop-color="${B1}"/><stop offset="1" stop-color="${B2}"/>
    </linearGradient>
    <radialGradient id="${b}" cx="0.2" cy="0.1" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${g})"/>
  <rect width="${w}" height="${h}" fill="url(#${b})"/>`;
};

/** brand mark + wordmark at (x,y), mark size m. */
export const lockup = (x, y, m, fs) =>
  `${brandMarkSvg(m).replace('<svg ', `<svg x="${x}" y="${y}" `)}` +
  text(x + m + 16, y + m / 2 + fs * 0.35, fs, 800, '#fff', 'Kimtos', 'letter-spacing="-0.5"');

/** Greedy word-wrap into lines no wider than `maxChars`. SVG <text> does not wrap, and
 *  splitting by word COUNT let a long word overflow the card (#1088 review); this measures
 *  by character budget, which for this font keeps every line inside its box. */
export function wrapLines(str, maxChars) {
  const lines = [];
  let line = '';
  for (const word of String(str).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The real app catalog, read from www/data/apps.ts — itself GENERATED from every
 * extension/src/apps/<id>/meta.ts. Reading it here means a card's name, accent, tier and
 * marketing copy have exactly one source: the app's own meta. There is no second place to
 * update when an app is added or renamed.
 *
 * Parsed block-by-block rather than with one multi-line regex over the whole file: the
 * file is prettier-formatted and its quote style has flipped once already, which silently
 * produced ZERO apps (and empty slides) while still exiting 0. Each field capture pins the
 * opening quote and requires the same one to close, so an apostrophe inside a
 * double-quoted string cannot truncate the value.
 */
export function loadApps(file = 'www/data/apps.ts') {
  const src = readFileSync(file, 'utf8');
  const body = src.slice(src.indexOf('export const APPS'));
  const blocks = [...body.matchAll(/\n {2}\{\n([\s\S]*?)\n {2}\},?/g)].map((m) => m[1]);

  const str = (b, k) => (b.match(new RegExp(`\\b${k}: (['"])([\\s\\S]*?)\\1`)) || [])[2];
  const points = (b) => {
    const m = b.match(/\bpoints: \[([\s\S]*?)\]/);
    return m ? [...m[1].matchAll(/(['"])([\s\S]*?)\1/g)].map((x) => x[2]) : null;
  };

  const apps = blocks
    .map((b) => ({
      id: str(b, 'id'),
      name: str(b, 'name'),
      c: str(b, 'c'),
      tech: str(b, 'tech'),
      desc: str(b, 'desc'),
      points: points(b),
    }))
    .filter((a) => a.id && appTileSvg(a.id, a.c, 100) !== ''); // only apps with a real glyph

  // Fail closed. A parser that silently yields three apps out of twenty-two still exits 0
  // and writes three cards, and the missing nineteen are only noticed by whoever goes
  // looking for them.
  if (apps.length < 10) {
    throw new Error(
      `Parsed only ${apps.length} apps out of ${file} — the catalog format changed, or ` +
        '@kimtos/icons has no dist (run `make shared`). Refusing to render a partial set.',
    );
  }
  for (const a of apps) {
    for (const k of ['name', 'c', 'tech', 'desc']) {
      if (!a[k]) throw new Error(`App "${a.id}" has no ${k} in ${file}`);
    }
    if (!a.points || a.points.length !== 3) {
      throw new Error(`App "${a.id}" needs exactly three marketing points, got ${a.points?.length ?? 0}`);
    }
  }
  return apps;
}
