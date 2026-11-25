// One social card per app, in the store-listing brand treatment (the light indigo->teal
// band, the real glyph tile, white type) — for introducing the apps a couple at a time
// rather than as a wall of twenty-two.
//
//   node extension/store-assets/app-cards.mjs        # from the repo root
//
// 1600x900 is deliberately one size for both networks: it is X's 16:9 in-stream landscape,
// and LinkedIn centre-crops it to 1.91:1 without touching anything that carries meaning
// (the safe area below is what keeps the type out of that crop).
//
// EVERY WORD ON THESE CARDS COMES FROM THE APP'S OWN meta.ts, through the generated
// www/data/apps.ts — name, accent, tier, `tech`, `desc` and the three `points`. Nothing is
// written here. That is not tidiness: marketing copy invented at render time is copy nobody
// reviews, and it is how a card ends up claiming something the app does not do. If a card
// reads badly, the fix is the app's meta, and the docs and the marketing site improve with it.
//
// These cards do NOT depict the product's interface. The store slides frame real captures
// (capture.mjs) precisely so the listing shows the true UI; a hand-drawn approximation of a
// window would be a mock-up presented as a screenshot, which that pipeline exists to avoid.
// A card is a title card — glyph, name, what it is — and is honest about being one.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { B1, brandBand, esc, FONT, loadApps, lockup, text, tile, wrapLines } from './brand.mjs';

const OUT = process.argv[2] || 'extension/store-assets/app-cards';
mkdirSync(OUT, { recursive: true });

const W = 1600;
const H = 900;
const PAD = 96;

/** A rounded pill with a label — the tier badge and the platform note. */
const pill = (x, y, label, { fill = 'rgba(255,255,255,0.18)', color = '#fff' } = {}) => {
  const w = 34 + label.length * 13;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="52" rx="26" fill="${fill}"/>` +
    text(x + w / 2, y + 34, 21, 700, color, label, 'text-anchor="middle"') +
    `<!--w:${w}-->`
  );
};
/** The width `pill` used, so the next one can sit beside it. */
const pillWidth = (label) => 34 + label.length * 13;

function card(app) {
  const { id, name, c, tech, desc, points } = app;

  // The glyph again at poster scale, bled off the right edge behind the points card. It is
  // the same tile the dock and the store render — the app's actual mark, not decoration.
  const watermark = `<g opacity="0.15">${tile(id, c, W - 300, H - 470, 640)}</g>`;

  // --- left column: what the app is ---------------------------------------
  const colX = PAD;
  let left = tile(id, c, colX, 232, 128);
  left += text(colX, 470, 82, 800, '#fff', name, 'letter-spacing="-2"');
  left += text(colX, 522, 27, 600, 'rgba(255,255,255,0.88)', tech);

  // `desc` is written for the marketing site's card, not for this one, and it ranges from
  // 90 to 190 characters — Retouch's ran to five lines and straight through the badges.
  // Rather than truncate an app's own description (or hand-tune it here, which puts a
  // second copy of it in the repo), step the type down until the block fits the space
  // above the badges. Every app keeps its full sentence; the longest ones just set smaller.
  const DESC_TOP = 600;
  const DESC_LIMIT = H - PAD - 52 - 30; // badge top, less breathing room
  const ladder = [
    [29, 44, 42],
    [27, 49, 39],
    [25, 54, 36],
    [23, 60, 33],
  ];
  const [size, chars, leading] =
    ladder.find(([, ch, ld]) => DESC_TOP + (wrapLines(desc, ch).length - 1) * ld <= DESC_LIMIT) ??
    ladder[ladder.length - 1];
  wrapLines(desc, chars).forEach((ln, i) => {
    left += text(colX, DESC_TOP + i * leading, size, 500, 'rgba(255,255,255,0.95)', ln);
  });

  const tier = 'Free'; // every app is free
  let badges = pill(colX, H - PAD - 52, tier);
  badges += pill(colX + pillWidth(tier) + 14, H - PAD - 52, 'Runs on your device');

  // --- right column: the three highlights ---------------------------------
  // Rows are measured, not assumed: the points run from 24 to 57 characters, so a fixed row
  // height either wastes space on the short ones or lets a three-line point (Clipboard's)
  // run into the row below it. Each row is as tall as its own wrapped text, and the card
  // and its vertical centring follow from the total.
  const cardX = 872;
  const cardW = W - cardX - PAD;
  const wrapped = points.map((p) => wrapLines(p, 34));
  const heights = wrapped.map((ls) => Math.max(96, ls.length * 34 + 62));
  const cardH = 56 + heights.reduce((a, b) => a + b, 0);
  const cardY = Math.round((H - cardH) / 2) + 10;
  let right =
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="30" ` +
    `fill="#ffffff" fill-opacity="0.13" stroke="#ffffff" stroke-opacity="0.28"/>`;
  let rowY = cardY + 28;
  wrapped.forEach((lines, i) => {
    const mid = rowY + heights[i] / 2;
    right += `<circle cx="${cardX + 62}" cy="${mid}" r="22" fill="#fff"/>`;
    // A typographic check, not a pictograph — CLAUDE.md bans emoji, and this glyph has no
    // icon asset behind it.
    right += text(cardX + 62, mid + 9, 25, 800, B1, '✓', 'text-anchor="middle"');
    const top = mid - ((lines.length - 1) * 34) / 2 + 9;
    lines.forEach((ln, li) => {
      right += text(cardX + 104, top + li * 34, 25, 600, '#fff', ln);
    });
    rowY += heights[i];
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${brandBand(W, H)}
    ${watermark}
    ${lockup(PAD, 82, 54, 36)}
    <text x="${W - PAD}" y="${136}" font-family="${FONT}" font-size="26" font-weight="500"
      fill="rgba(255,255,255,0.85)" text-anchor="end">${esc('Free and open source')}</text>
    ${left}
    ${badges}
    ${right}
  </svg>`;
}

const apps = loadApps();
for (const app of apps) {
  const name = `app-${app.id}.png`;
  await sharp(Buffer.from(card(app)))
    .resize(W, H)
    .flatten({ background: '#5b6cff' }) // no alpha: some networks composite a transparent PNG on white
    .png()
    .toFile(`${OUT}/${name}`);
  console.log(`${name.padEnd(24)} ${app.name}`);
}
console.log(`\n${apps.length} app cards written to ${OUT}/`);
