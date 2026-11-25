// What KimtFS can actually SHOW you.
//
// Before this, `renderMain()` handled exactly two cases: a text file went into a raw
// <textarea>, and a blob whose mime began with `image/` became an <img>. EVERYTHING else —
// JSON, PDF, audio, video, markdown, code, CSV — fell through to an icon and the string
// "application/pdf · 2.1 MB". For an app whose pitch is "save folders, files and uploads on
// your device", not being able to LOOK at most of what you saved is the core defect (#188).
//
// Everything here renders from the bytes already in this browser's IndexedDB. Nothing is
// fetched, nothing is uploaded, no CDN, no worker pulled over the network. PDF.js is bundled
// (pdfjs-dist, the same copy PDF Library uses) and imported lazily, so a user who never opens
// a PDF never pays for it.

export type ViewKind =
  'image' | 'pdf' | 'audio' | 'video' | 'json' | 'markdown' | 'code' | 'text' | 'archive' | 'binary';

const EXT_KIND: Record<string, ViewKind> = {
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'text',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  css: 'code',
  html: 'code',
  xml: 'code',
  yml: 'code',
  yaml: 'code',
  sh: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  sql: 'code',
  toml: 'code',
  ini: 'code',
  // Media by NAME too. These used to be recognised by mime type alone — which quietly broke
  // the module's own rule: a .png that arrives as `application/octet-stream` (exactly the case
  // the rule exists for) fell through to the hex dump, and the Kind column called it a
  // Document. The name is the one thing the user actually chose.
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  pdf: 'pdf',
  // Archives. `zip`, `tar`, `gz` (incl. `.tar.gz`), `tgz` open natively; the rest are recognised
  // only so the viewer can say "KimtOS can't open this format yet" instead of a hex dump — none
  // has a browser decompressor, so bundling one is its own decision (see archive.ts).
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  xz: 'archive',
  zst: 'archive',
  bz2: 'archive',
};

/**
 * What kind of thing is this, for viewing purposes?
 *
 * The NAME wins over the mime type, deliberately. A `.json` uploaded from a desktop often
 * arrives as `application/octet-stream` or `text/plain` — the browser guesses from the OS,
 * and the OS is frequently wrong. The extension is what the user actually named it.
 */
export function detectKind(name: string, mime = ''): ViewKind {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const byExt = EXT_KIND[ext];
  if (byExt) return byExt;

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime === 'application/json') return 'json';
  if (mime.startsWith('text/')) return 'text';
  return 'binary';
}

/** True when the bytes are worth decoding as text rather than dumping as hex. */
export const isTextual = (k: ViewKind): boolean => k === 'json' || k === 'markdown' || k === 'code' || k === 'text';

/**
 * Pretty-print JSON. Returns the error instead of throwing, because an invalid `.json` is a
 * thing the user very much wants to SEE (that is usually why they opened it) — not an
 * exception that blanks the pane.
 */
export function formatJson(text: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/**
 * A classic hex dump — offset, 16 bytes, then the printable ASCII. For a file we cannot
 * render any other way, this is still infinitely more use than an icon and a mime type: you
 * can see the magic bytes, whether it is text in disguise, or whether it is empty.
 *
 * Capped, because a 200 MB video would otherwise build a 12 million-line string.
 */
export function hexDump(bytes: Uint8Array, maxBytes = 2048): string {
  const n = Math.min(bytes.length, maxBytes);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 16) {
    const row = bytes.subarray(i, Math.min(i + 16, n));
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > n) lines.push(`… ${(bytes.length - n).toLocaleString()} more bytes`);
  return lines.join('\n');
}

/** Render a PDF's pages into `host`, using the bundled PDF.js (never a CDN). */
export async function renderPdf(host: HTMLElement, data: ArrayBuffer): Promise<void> {
  // Lazy: a user who never opens a PDF never loads the library. Allowed here — this runs in
  // the new-tab page, which code-splits (a content script could not do this; see #115).
  const pdfjs = await import('pdfjs-dist');
  // The SAME worker specifier PDF Library uses (apps/pdflib/reader.ts) — a different one
  // bundles a SECOND copy of a 2 MB worker into the extension. Measured: 3 worker assets
  // instead of 1.
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;

  const doc = await pdfjs.getDocument({ data }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement('canvas');
    canvas.className = 'kimtfs-pdf-page';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    host.append(canvas);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  }
}
