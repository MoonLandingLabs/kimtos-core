// Generate Chrome Web Store listing assets for the Kimtos extension, from the REAL brand
// system (brandMarkSvg + appTileSvg + BRAND_GRADIENT_STOPS in @kimtos/icons). Output is exact-
// dimension, no-alpha PNG (sharp .flatten()), which is what the store requires.
//
// All five screenshots frame REAL product captures (capture.mjs writes them to
// captures/ — committed, so this script never needs a browser) in the gallery style the
// store's carousel shows two-up: a brand-gradient band with the headline, the live UI
// below it. Google's Featured bar wants the actual user experience on screen (#1065).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// The brand furniture and the catalog reader are shared with app-cards.mjs — one band, one
// lockup, one parse of www/data/apps.ts. See brand.mjs.
import { B0, B1, B2, brandBand, brandMarkSvg, loadApps, lockup, text, tile, wrapLines } from './brand.mjs';

const OUT = process.argv[2] || 'extension/store-assets';
const CAPTURES = fileURLToPath(new URL('./captures/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// --- real app catalog (id, name, accent) ----------------------------------
const APPS = loadApps();

const TAGLINE = 'Every new browser tab, a private workspace';

const pick = (ids) => ids.map((id) => APPS.find((a) => a.id === id)).filter(Boolean);

// === Real-capture slides (1280x800) =======================================
// A brand-gradient band with the headline, and the LIVE product below it in a
// rounded card — the gallery framing the store's two-up carousel renders. Two
// fits: 'bleed' (wide card cropped by the bottom edge — for window/dialog shots
// whose lower half is padding) and 'fit' (the whole capture as a floating card —
// for the home shot, where the dock at the bottom IS the point). The captures
// come from capture.mjs (committed), so this stays runnable without a browser.
async function realShot(headline, sub, captureFile, { fit = 'bleed' } = {}) {
  const w = 1280,
    h = 800;
  const bandH = 172,
    radius = 18;
  const bleed = fit === 'bleed';
  const margin = 26; // 'fit' only: breathing room under the floating card
  const cardW = bleed ? 1120 : Math.round((h - bandH - margin) * (1280 / 800));
  const cardH = bleed ? h - bandH : h - bandH - margin;
  const cardX = Math.round((w - cardW) / 2),
    cardY = bandH;
  // 'bleed' rounds only the visible top corners: the mask extends past the canvas.
  const maskH = bleed ? cardH + radius : cardH;
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="band" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${B0}"/><stop offset="0.55" stop-color="${B1}"/><stop offset="1" stop-color="${B2}"/>
      </linearGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#band)"/>
    ${text(w / 2, 86, 42, 800, '#fff', headline, 'text-anchor="middle" letter-spacing="-1"')}
    ${text(w / 2, 130, 21, 500, 'rgba(255,255,255,0.92)', sub, 'text-anchor="middle"')}
    <rect x="${cardX}" y="${cardY + 12}" width="${cardW}" height="${cardH}" rx="${radius}" fill="#04061a" opacity="0.5" filter="url(#soft)"/>
  </svg>`;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
      <rect width="${cardW}" height="${maskH}" rx="${radius}" fill="#fff"/>
    </svg>`,
  );
  const border = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect x="${cardX + 0.5}" y="${cardY + 0.5}" width="${cardW - 1}" height="${maskH - 1}" rx="${radius}"
        fill="none" stroke="#ffffff" stroke-opacity="0.35"/>
    </svg>`,
  );
  const ui = await sharp(`${CAPTURES}${captureFile}`)
    .resize(cardW) // 2x capture -> card width; the downscale is what keeps it crisp
    .extract({ left: 0, top: 0, width: cardW, height: cardH })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(Buffer.from(base))
    .composite([
      { input: ui, left: cardX, top: cardY },
      { input: border, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

// === Explainer slide — why Kimtos / how it works (1280x800) ===============
// The one DESIGNED slide (not a capture): a "why + how" card on the brand gradient,
// matching the band the real-capture slides are framed in. Every claim here is
// literally true — the privacy line is the product, so it must not overstate.
// (wrapLines lives in brand.mjs — the same greedy character-budget wrap the app cards use.)

function explainerSlide() {
  const w = 1280,
    h = 800;
  const steps = [
    ['1', 'Open a new tab', 'Your whole workspace is right there — no app to launch, no site to open.'],
    ['2', 'Pick your tools', 'Notes, tasks, PDFs, a whiteboard, files, on-device AI. Install what you need.'],
    ['3', 'It stays with you', 'Everything runs in your browser and saves to your device. Nothing is uploaded.'],
  ];
  const colW = 372,
    gap = 40,
    rowW = steps.length * colW + (steps.length - 1) * gap,
    x0 = (w - rowW) / 2,
    padX = 32,
    cardY = 264,
    cardH = 246;
  let cols = '';
  steps.forEach(([n, title, body], i) => {
    const cx = x0 + i * (colW + gap);
    cols += `<rect x="${cx}" y="${cardY}" width="${colW}" height="${cardH}" rx="20" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.25"/>`;
    cols += `<circle cx="${cx + padX + 14}" cy="${cardY + 54}" r="24" fill="#fff"/>`;
    cols += text(cx + padX + 14, cardY + 63, 26, 800, B1, n, 'text-anchor="middle"');
    cols += text(cx + padX, cardY + 122, 27, 800, '#fff', title, 'letter-spacing="-0.4"');
    // Character-budgeted wrap so no line runs past the card's inner width.
    wrapLines(body, 34).forEach((ln, li) => {
      cols += text(cx + padX, cardY + 164 + li * 28, 18, 500, 'rgba(255,255,255,0.9)', ln);
    });
  });
  // Bottom privacy strip — the promises, stated plainly.
  const badges = ['No uploads', 'No tracking', 'No ads', 'On-device AI'];
  const bw = 214,
    bgap = 20,
    bRowW = badges.length * bw + (badges.length - 1) * bgap,
    bx0 = (w - bRowW) / 2,
    by = 604;
  let strip = '';
  badges.forEach((b, i) => {
    const cx = bx0 + i * (bw + bgap);
    strip += `<rect x="${cx}" y="${by}" width="${bw}" height="56" rx="28" fill="#ffffff" fill-opacity="0.16"/>`;
    strip += text(cx + bw / 2, by + 36, 20, 700, '#fff', b, 'text-anchor="middle"');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="band" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${B0}"/><stop offset="0.55" stop-color="${B1}"/><stop offset="1" stop-color="${B2}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#band)"/>
    ${lockup(w / 2 - 96, 70, 44, 34)}
    ${text(w / 2, 178, 46, 800, '#fff', 'A private workspace, by design', 'text-anchor="middle" letter-spacing="-1"')}
    ${text(w / 2, 216, 22, 500, 'rgba(255,255,255,0.92)', 'Powerful tools that run in your browser and keep your data on your device.', 'text-anchor="middle"')}
    ${cols}
    ${strip}
  </svg>`;
}

// === Small promo tile (440x280) ===========================================
function smallTile() {
  const w = 440,
    h = 280;
  const chosen = pick(['tabs', 'kimtai', 'notes', 'snaptext']);
  const s = 60,
    gap = 18,
    rowW = chosen.length * s + (chosen.length - 1) * gap;
  let tiles = '';
  chosen.forEach((a, i) => (tiles += tile(a.id, a.c, (w - rowW) / 2 + i * (s + gap), 186, s)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${brandBand(w, h)}
    ${brandMarkSvg(64).replace('<svg ', `<svg x="${w / 2 - 32}" y="40" `)}
    ${text(w / 2, 148, 34, 800, '#fff', 'Kimtos', 'text-anchor="middle" letter-spacing="-0.5"')}
    ${text(w / 2, 176, 15, 500, 'rgba(255,255,255,0.9)', 'Your private new-tab workspace', 'text-anchor="middle"')}
    ${tiles}
  </svg>`;
}

// === Marquee promo tile (1400x560) ========================================
function marquee() {
  const w = 1400,
    h = 560;
  const cluster = pick(['tabs', 'kimtai', 'notes', 'denoise', 'snaptext', 'thoth', 'kimtfs', 'calculator', 'vidrec']);
  const s = 118,
    gap = 26,
    cols = 3;
  const gridW = cols * s + (cols - 1) * gap;
  const gx0 = w - gridW - 110,
    gy0 = (h - (cols * s + (cols - 1) * gap)) / 2;
  let tiles = '';
  cluster.slice(0, 9).forEach((a, i) => {
    tiles += tile(a.id, a.c, gx0 + (i % cols) * (s + gap), gy0 + Math.floor(i / cols) * (s + gap), s);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${brandBand(w, h)}
    ${lockup(110, 92, 56, 40)}
    ${text(110, 268, 62, 800, '#fff', 'Your new tab,', 'letter-spacing="-1.5"')}
    ${text(110, 336, 62, 800, 'rgba(255,255,255,0.86)', 'a private workspace', 'letter-spacing="-1.5"')}
    ${text(110, 396, 25, 500, 'rgba(255,255,255,0.9)', TAGLINE + '.')}
    ${text(110, 430, 25, 500, 'rgba(255,255,255,0.9)', 'Notes, PDFs, on-device AI — nothing leaves your device.')}
    ${tiles}
  </svg>`;
}

// --- render ----------------------------------------------------------------
// All five slides frame the real product (a composed PNG buffer from realShot); the two
// promo tiles are still SVG strings. The store-safe flatten is shared, so a job's input
// is either — the loop below branches on the type.
const jobs = [
  [
    'screenshot-1-hero.png',
    await realShot(
      'Your new tab, a private workspace',
      'Notes, tasks, files and on-device AI — everything stays in your browser.',
      'home.png',
      { fit: 'fit' }, // the dock at the bottom is the point — show all of it
    ),
    1280,
    800,
  ],
  [
    'screenshot-2-notes.png',
    await realShot(
      'A full writing space, on your device',
      'Collections, Markdown with live preview, search — stored locally, never uploaded.',
      'notes.png',
    ),
    1280,
    800,
  ],
  [
    'screenshot-3-store.png',
    await realShot(
      'Pick your tools from the App Store',
      'Every app is free, no account needed — everything runs in your browser.',
      'store.png',
    ),
    1280,
    800,
  ],
  [
    'screenshot-4-board.png',
    await realShot(
      'Think it out on an infinite canvas',
      'Sketches, shapes and sticky notes — autosaved to your device, never uploaded.',
      'notaboard.png',
    ),
    1280,
    800,
  ],
  [
    'screenshot-5-files.png',
    await realShot(
      'Your own private file system',
      'Folders, files and uploads that live in your browser — no cloud account anywhere.',
      'kimtfs.png',
    ),
    1280,
    800,
  ],
  [
    'screenshot-6-tools.png',
    await realShot(
      'Open a tool — or two — right on your tab',
      'Every app is its own window. Voice to Text and Image to Text, side by side, on-device.',
      'tools.png',
      { fit: 'fit' }, // full desktop with both windows — show all of it
    ),
    1280,
    800,
  ],
  [
    'screenshot-7-multitask.png',
    await realShot(
      'Run three at once, each doing its own thing',
      'A developer toolbox, your day’s checklist and a calculator — every app its own window.',
      'multitask.png',
      { fit: 'fit' },
    ),
    1280,
    800,
  ],
  ['screenshot-8-privacy.png', explainerSlide(), 1280, 800],
  ['promo-small-440x280.png', smallTile(), 440, 280],
  ['promo-marquee-1400x560.png', marquee(), 1400, 560],
];

for (const [name, input, w, h] of jobs) {
  await sharp(typeof input === 'string' ? Buffer.from(input) : input)
    .resize(w, h)
    .flatten({ background: '#0a0e27' }) // remove alpha -> 24-bit, store-safe
    .png()
    .toFile(`${OUT}/${name}`);
  const meta = await sharp(`${OUT}/${name}`).metadata();
  console.log(`${name}  ${meta.width}x${meta.height}  channels=${meta.channels}  alpha=${meta.hasAlpha}`);
}
console.log(`\n${APPS.length} apps rendered from the real catalog. Output: ${OUT}/`);

// --- the marketing site's hero pair ----------------------------------------
// www's hero swaps these two by theme, and the dark one is ALSO the OG/Twitter image and
// the schema.org screenshot (www/nuxt.config.ts, www/pages/index.vue). They are generated
// here, from the same captures as the store slides, because the hand-made originals went
// stale: the live site advertised a v0.1.0 build long after the 1.0.x line shipped. Sized
// to the 1440x900 the OG meta declares — same 1.6 aspect as the capture, so it is a clean
// downscale, and small enough to be a sane page/social asset.
const SITE_ASSETS = fileURLToPath(new URL('../../www/public/assets/', import.meta.url));
for (const [capture, name] of [
  ['home-dark.png', 'screenshot-newtab.png'],
  ['home.png', 'screenshot-newtab-light.png'],
]) {
  await sharp(`${CAPTURES}${capture}`).resize(1440, 900).png({ quality: 90 }).toFile(`${SITE_ASSETS}${name}`);
  const meta = await sharp(`${SITE_ASSETS}${name}`).metadata();
  console.log(`www/public/assets/${name}  ${meta.width}x${meta.height}`);
}
