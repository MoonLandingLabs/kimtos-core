// Recovering text that Tesseract drops for being small *relative to the page* (#956).
//
// Tesseract's layout analysis sizes a page from its dominant text and discards blobs
// far below that size as noise, before the recogniser ever sees them. The failure is
// silent — the rest of the image reads perfectly, so the user gets a result that looks
// complete and is not. Measured on a generated slide with the bundled `eng.traineddata`:
// a 24px footer under 96px bullets is dropped completely, while the SAME 24px footer
// alone on the same canvas is read perfectly. It is a ratio problem, not an absolute
// pixel-height one, which is why no page-segmentation mode, no `user_defined_dpi`, and
// none of Tesseract's `textord_noise_*` knobs recover it.
//
// So we do not upscale the whole image — that is up to 9x the pixels for a fix that
// does not even address the cause. Instead: after the normal pass, find the horizontal
// bands of ink, keep the ones that are far thinner than the page's dominant band AND
// that the normal pass did not already return, then crop those slivers, enlarge them,
// and recognise them on their own. A band alone in its own image has no larger text to
// be measured against, so Tesseract reads it. A strip is a tiny fraction of the image,
// so this costs a fraction of a second rather than a multiple of the whole run.
//
// The maths below is deliberately pure and unit-tested; the only DOM part is
// `analyzeImage`, which turns a blob into a grayscale sample buffer.

/** A horizontal run of rows that contain ink. `top` and `height` are in image pixels. */
export interface Band {
  top: number;
  height: number;
}

/** A line the main recognition pass returned, in image coordinates. */
export interface RecognizedLine {
  y0: number;
  y1: number;
}

/** Columns sampled per row. Bounds the scan cost on a 4K image; row resolution is exact. */
const ANALYSIS_COLUMNS = 1600;
/** How far a pixel must sit from the background level to count as ink (0-255). */
const INK_DELTA = 64;
/** Bands thinner than this are rules, borders and speckle — never text worth a rescan. */
const MIN_BAND_PX = 4;
/** A band inked across more than this fraction of its widest row is a rule, not text. */
const RULE_FILL = 0.9;
/** A band this many times thinner than the dominant one is at risk of being dropped. */
const SMALL_RATIO = 2.2;
/** Enlarge a small band to about this height before re-reading it. */
const TARGET_BAND_PX = 40;
/** Never enlarge by more than this — beyond it the strip is interpolation, not detail. */
const MAX_UPSCALE = 6;
/** Bound the total work: at most this many bands are re-read, in document order. */
export const MAX_RESCAN_BANDS = 12;

/**
 * The image's background level: the most common luminance. Works for a light page
 * (white) and a dark screenshot (near-black) alike, because ink is then measured as a
 * *distance* from it rather than as "darker than".
 */
export function estimateBackground(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let best = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[best]) best = v;
  return best;
}

/** Inked samples per row, where "inked" means far enough from the background level. */
export function rowInkCounts(gray: Uint8Array, width: number, height: number, background: number): Uint32Array {
  const counts = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let n = 0;
    for (let x = 0; x < width; x++) if (Math.abs(gray[base + x] - background) > INK_DELTA) n++;
    counts[y] = n;
  }
  return counts;
}

/**
 * Contiguous runs of inked rows, with the rule-like ones dropped: a horizontal rule or
 * a table border fills nearly every column of every row it occupies, whereas text
 * leaves gaps between glyphs and words.
 */
export function bandsFromRowCounts(counts: Uint32Array, sampledWidth: number): Band[] {
  const bands: Band[] = [];
  let start = -1;
  let widest = 0;
  for (let y = 0; y <= counts.length; y++) {
    const inked = y < counts.length && counts[y] > 0;
    if (inked) {
      if (start < 0) {
        start = y;
        widest = 0;
      }
      if (counts[y] > widest) widest = counts[y];
    } else if (start >= 0) {
      const height = y - start;
      if (height >= MIN_BAND_PX && widest <= sampledWidth * RULE_FILL) bands.push({ top: start, height });
      start = -1;
    }
  }
  return bands;
}

/** The page's dominant band height — the median, so one huge headline cannot skew it. */
export function dominantBandHeight(bands: Band[]): number {
  if (!bands.length) return 0;
  const sorted = bands.map((b) => b.height).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The bands at risk of being discarded as noise: far thinner than the dominant one. */
export function smallBands(bands: Band[]): Band[] {
  const dominant = dominantBandHeight(bands);
  if (!dominant) return [];
  return bands.filter((b) => b.height * SMALL_RATIO <= dominant);
}

/**
 * Drop the bands the main pass already read. A line whose box covers most of the band's
 * rows means Tesseract did see it, so re-reading would only duplicate it. This is the
 * safety net that keeps a rescan from ever adding text twice.
 */
export function uncoveredBands(bands: Band[], lines: RecognizedLine[]): Band[] {
  return bands.filter((band) => {
    const bottom = band.top + band.height;
    return !lines.some((line) => {
      const overlap = Math.min(bottom, line.y1) - Math.max(band.top, line.y0);
      return overlap > 0 && overlap >= band.height / 2;
    });
  });
}

/** How much to enlarge a band so its text clears Tesseract's minimum readable height. */
export function upscaleForBand(band: Band): number {
  return Math.min(MAX_UPSCALE, Math.max(1, TARGET_BAND_PX / band.height));
}

/** Text worth splicing in: a rescan that found only punctuation or noise is discarded. */
export function isUsefulRecovery(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** A band's recovered text, ready to be spliced back into the page's reading order. */
export interface Recovery {
  top: number;
  text: string;
}

/**
 * Put the recovered lines back where they belong. The main pass's text is the spine:
 * each of its non-empty lines maps, in order, to one of the boxed lines it returned, so
 * a recovered band is inserted after the last line that starts above it. If that mapping
 * does not hold (a language or renderer that does not emit one line per box), fall back
 * to the only ordering we can still trust — above everything, or below everything.
 */
export function spliceRecoveries(text: string, lines: RecognizedLine[], recoveries: Recovery[]): string {
  const ordered = [...recoveries].sort((a, b) => a.top - b.top);
  if (!ordered.length) return text;
  const parts = text.length ? text.split('\n') : [];
  const nonEmpty = parts.filter((p) => p.trim().length > 0).length;

  if (nonEmpty !== lines.length) {
    const above = ordered.filter((r) => !lines.length || r.top < lines[0].y0).map((r) => r.text);
    const below = ordered.filter((r) => lines.length && r.top >= lines[0].y0).map((r) => r.text);
    return [...above, ...(text ? [text] : []), ...below].join('\n').trim();
  }

  // Walk the spine and drop each recovery in just before the first line that sits below
  // it. Inserting *before* the next line rather than after the previous one keeps the
  // blank line Tesseract puts between blocks with the block it separates.
  const out: string[] = [];
  let seen = 0;
  let next = 0;
  for (const part of parts) {
    if (part.trim().length > 0) {
      while (next < ordered.length && countLinesAbove(lines, ordered[next].top) <= seen) out.push(ordered[next++].text);
      seen++;
    }
    out.push(part);
  }
  while (next < ordered.length) out.push(ordered[next++].text);
  return out.join('\n').trim();
}

function countLinesAbove(lines: RecognizedLine[], top: number): number {
  let n = 0;
  for (const line of lines) if (line.y0 < top) n++;
  return n;
}

/** A grayscale sample of an image: `width` columns per row, every row of the original. */
export interface GraySample {
  gray: Uint8Array;
  width: number;
  height: number;
  /** Original image width, so a band can be cropped back at full resolution. */
  sourceWidth: number;
}

/**
 * Sample an already-decoded image into a grayscale buffer, striding columns so the scan
 * stays bounded on a large screenshot. Rows are never skipped: row resolution is what
 * band detection depends on.
 */
export function sampleGray(image: ImageBitmap): GraySample | null {
  const { width, height } = image;
  if (!width || !height) return null;
  const stride = Math.max(1, Math.ceil(width / ANALYSIS_COLUMNS));
  const sampledWidth = Math.ceil(width / stride);
  const canvas = new OffscreenCanvas(sampledWidth, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // Nearest-neighbour keeps a hairline stroke from being averaged away into the page.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, sampledWidth, height);
  const { data } = ctx.getImageData(0, 0, sampledWidth, height);
  const gray = new Uint8Array(sampledWidth * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Rec. 601 luma, integer-scaled; alpha is composited against the canvas' own black,
    // which is fine because a transparent page reads as a uniform background either way.
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return { gray, width: sampledWidth, height, sourceWidth: width };
}

/** The bands of a decoded image that are small enough to be at risk of being dropped. */
export function smallBandsOf(sample: GraySample): Band[] {
  const counts = rowInkCounts(sample.gray, sample.width, sample.height, estimateBackground(sample.gray));
  return smallBands(bandsFromRowCounts(counts, sample.width));
}

/**
 * Crop a band at full resolution with a little breathing room above and below — a glyph's
 * descender or an accent can sit outside the inked rows the scan found — and enlarge it.
 */
export function cropBand(image: ImageBitmap, band: Band): Promise<Blob> | null {
  const pad = Math.max(4, Math.round(band.height / 2));
  const top = Math.max(0, band.top - pad);
  const bottom = Math.min(image.height, band.top + band.height + pad);
  const height = bottom - top;
  if (height <= 0) return null;
  const scale = upscaleForBand(band);
  const canvas = new OffscreenCanvas(Math.round(image.width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, top, image.width, height, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}
