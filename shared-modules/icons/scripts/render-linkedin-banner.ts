// Render on-brand LinkedIn banners from the kimtos brand system (same gradient +
// roof-and-dock glyph as the icons). Composes an SVG and rasterises it via sharp
// at 2× for crisp edges.
//
//   npm run render:linkedin -w @kimtos/icons
//
// Outputs (into www/public/assets, so they're served with the marketing site):
//   linkedin-banner.png         1584×396  — personal profile banner (the common one)
//   linkedin-cover-company.png  1128×191  — Company Page cover

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '..', 'www', 'public', 'assets');

// ── Brand ────────────────────────────────────────────────────────────
const STOPS = ['#8aa2ff', '#5b6cff', '#18b6a4'] as const; // indigo → teal
const GLYPH = // roof + three dock tiles, white, on a 100×100 grid
  '<path d="M18 48 L50 23 L82 48" fill="none" stroke="#fff" stroke-width="8.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<g fill="#fff"><rect x="26" y="58" width="14" height="15" rx="4.2"/><rect x="43" y="58" width="14" height="15" rx="4.2"/><rect x="60" y="58" width="14" height="15" rx="4.2"/></g>';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const [ar, ag, ab] = hex(a),
    [br, bg, bb] = hex(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[c(ar, br), c(ag, bg), c(ab, bb)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

// A macOS-style app tile: squircle with an accent gradient + a top gloss.
const tile = (id: string, x: number, y: number, s: number, accent: string, glyph = '') => {
  const g = `grad-${id}`;
  return `
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${mix(accent, '#ffffff', 0.4)}"/>
      <stop offset="0.52" stop-color="${accent}"/>
      <stop offset="1" stop-color="${mix(accent, '#000000', 0.16)}"/>
    </linearGradient></defs>
    <g transform="translate(${x} ${y})" filter="url(#tileShadow)">
      <rect width="${s}" height="${s}" rx="${s * 0.26}" fill="url(#${g})"/>
      <rect width="${s}" height="${s * 0.5}" rx="${s * 0.26}" fill="#ffffff" opacity="0.14"/>
      ${glyph ? `<g transform="translate(${s * 0.22} ${s * 0.22}) scale(${(s * 0.56) / 100})">${glyph}</g>` : ''}
    </g>`;
};

const brandTile = (x: number, y: number, s: number) => `
  <defs><linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${STOPS[0]}"/><stop offset="0.46" stop-color="${STOPS[1]}"/><stop offset="1" stop-color="${STOPS[2]}"/>
  </linearGradient></defs>
  <g transform="translate(${x} ${y})" filter="url(#tileShadow)">
    <rect width="${s}" height="${s}" rx="${s * 0.23}" fill="url(#brandg)"/>
    <g transform="scale(${s / 100})">${GLYPH}</g>
  </g>`;

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// Accents for the floating dock motif (echoes the product's app dock).
const DOCK = ['#3b82f6', '#a78bfa', '#18b6a4', '#4ade80', '#fb923c', '#f472b6'];

// ── Personal profile banner — 1584×396 ───────────────────────────────
function bannerSvg(W: number, H: number): string {
  const cx = 160; // left content column
  const midY = H / 2;
  // Floating dock in its own column on the far right (no collision with text).
  const tsize = 90,
    gap = 20;
  const dockW = DOCK.length * tsize + (DOCK.length - 1) * gap;
  const dockX = W - 96 - dockW;
  const dockY = midY - tsize / 2;
  const tiles = DOCK.map((a, i) =>
    tile(`d${i}`, dockX + i * (tsize + gap), dockY - (i === 2 ? 12 : 0), tsize, a, i === 2 ? GLYPH : ''),
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0c1120"/><stop offset="1" stop-color="#080a10"/>
      </linearGradient>
      <radialGradient id="glowA" cx="0.8" cy="0.05" r="0.7">
        <stop offset="0" stop-color="#5b6cff" stop-opacity="0.32"/><stop offset="1" stop-color="#5b6cff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowB" cx="0.1" cy="1" r="0.7">
        <stop offset="0" stop-color="#18b6a4" stop-opacity="0.18"/><stop offset="1" stop-color="#18b6a4" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8aa2ff"/><stop offset="1" stop-color="#43e0c8"/>
      </linearGradient>
      <filter id="tileShadow" x="-40%" y="-40%" width="180%" height="200%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/>
      </filter>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glowA)"/>
    <rect width="${W}" height="${H}" fill="url(#glowB)"/>
    <rect x="0" y="0" width="${W}" height="4" fill="url(#hl)"/>

    <!-- shelf under the dock -->
    <rect x="${dockX - 24}" y="${dockY + tsize + 22}" width="${dockW + 48}" height="2" fill="#ffffff" opacity="0.08"/>
    ${tiles}

    <!-- brand lockup -->
    ${brandTile(cx, 56, 58)}
    <text x="${cx + 74}" y="${96}" font-family="${FONT}" font-size="32" font-weight="700" fill="#ffffff" letter-spacing="-0.5">KimtOS</text>

    <!-- two-line headline keeps the left column clear of the dock -->
    <text x="${cx}" y="205" font-family="${FONT}" font-size="58" font-weight="800" letter-spacing="-1.6" fill="#ffffff">Your new tab,</text>
    <text x="${cx}" y="267" font-family="${FONT}" font-size="58" font-weight="800" letter-spacing="-1.6" fill="url(#hl)">actually useful.</text>
    <text x="${cx}" y="313" font-family="${FONT}" font-size="22" font-weight="500" fill="#ffffff" opacity="0.72">Private tools on every new tab — nothing leaves your browser.</text>
    <text x="${cx}" y="353" font-family="${FONT}" font-size="20" font-weight="600" fill="#ffffff" opacity="0.5">Free and open source&#160;&#160;·&#160;&#160;MIT licensed</text>
  </svg>`;
}

// ── Company Page cover — 1128×191 (logo overlaps lower-left) ──────────
function coverSvg(W: number, H: number): string {
  const cx = 92;
  const midY = H / 2;
  const tsize = 58,
    gap = 14;
  const dockW = 4 * tsize + 3 * gap;
  const dockX = W - 74 - dockW;
  const tiles = DOCK.slice(0, 4)
    .map((a, i) => tile(`c${i}`, dockX + i * (tsize + gap), midY - tsize / 2, tsize, a, i === 2 ? GLYPH : ''))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1120"/><stop offset="1" stop-color="#080a10"/></linearGradient>
      <radialGradient id="glowA" cx="0.8" cy="0.1" r="0.8"><stop offset="0" stop-color="#5b6cff" stop-opacity="0.3"/><stop offset="1" stop-color="#5b6cff" stop-opacity="0"/></radialGradient>
      <linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${STOPS[0]}"/><stop offset="0.46" stop-color="${STOPS[1]}"/><stop offset="1" stop-color="${STOPS[2]}"/></linearGradient>
      <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8aa2ff"/><stop offset="1" stop-color="#43e0c8"/></linearGradient>
      <filter id="tileShadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#000" flood-opacity="0.45"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glowA)"/>
    <rect x="0" y="0" width="${W}" height="3" fill="url(#hl)"/>
    ${tiles}
    <g transform="translate(${cx} 34)"><rect width="34" height="34" rx="8" fill="url(#brandg)"/><g transform="scale(0.34)">${GLYPH}</g></g>
    <text x="${cx + 44}" y="58" font-family="${FONT}" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="-0.4">KimtOS</text>
    <text x="${cx}" y="118" font-family="${FONT}" font-size="34" font-weight="800" letter-spacing="-1" fill="#ffffff">Your new tab, <tspan fill="url(#hl)">actually useful.</tspan></text>
    <text x="${cx}" y="150" font-family="${FONT}" font-size="18" font-weight="500" fill="#ffffff" opacity="0.64">Private, on-device browser tools · Free and open source</text>
  </svg>`;
}

await mkdir(outDir, { recursive: true });
const jobs: [string, string, number, number][] = [
  ['linkedin-banner.png', bannerSvg(1584, 396), 1584, 396],
  ['linkedin-cover-company.png', coverSvg(1128, 191), 1128, 191],
];
for (const [name, svg, w, h] of jobs) {
  await sharp(Buffer.from(svg)).resize(w, h).png().toFile(join(outDir, name));
  console.log(`✓ ${name}  (${w}×${h})`);
}
console.log(`→ ${outDir}`);
