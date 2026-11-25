// The FILE-TYPE glyphs — the inner markup of a 24×24 line icon per kind of file, for a
// file listing (KimtFS's explorer today, its grid view next). Drawn with `currentColor`.
//
// THIS IS THE SECOND GLYPH SET, AND IT IS NOT THE APP ONE. Keep them apart:
//
//   APP_GLYPHS (glyphs.ts)  one per app id. A WHITE mark, made to sit on the app's
//                           coloured accent squircle. Rendered by appGlyphSvg/paintAppTile.
//   FILE_GLYPHS (here)      one per file KIND. BACKGROUND-LESS — a bare mark that inherits
//                           the surrounding text colour, the way a Finder-style list wants.
//                           Rendered by fileGlyphSvg.
//
// A file's kind is NOT decided here: the KimtFS viewer's `detectKind(name, mime)` already
// maps a file to one of these by extension and MIME, and it is what the viewer itself
// switches on. This set is keyed by that same vocabulary on purpose — a second
// extension-to-icon table would be a copy of a fact that already exists, and the copies
// would drift the first time someone taught the viewer a new extension (#220).
//
// So: adding a file type means adding a kind THERE and a glyph HERE, and the type system
// will not let you do only the first — `fileGlyphSvg` takes a `FileKind`, so a `ViewKind`
// with no glyph fails the typecheck instead of quietly rendering a blank row.

/** The kinds a listing can show: every `ViewKind` the viewer detects, plus a folder. */
export type FileKind =
  'folder' | 'image' | 'pdf' | 'audio' | 'video' | 'json' | 'markdown' | 'code' | 'text' | 'archive' | 'binary';

// The page-with-a-folded-corner that most of these are built on. Repeated rather than
// abstracted: each glyph is a flat string of markup, same as APP_GLYPHS, and a builder would
// make them harder to read and to tweak by eye.
const PAGE = '<path d="M6.5 3h7l4.5 4.5V21H6.5z"/><path d="M13.5 3v4.5H18"/>';

export const FILE_GLYPHS: Record<FileKind, string> = {
  folder:
    '<path d="M3.25 6.4a1.9 1.9 0 0 1 1.9-1.9h3.6l2 2.3h8.1a1.9 1.9 0 0 1 1.9 1.9v9.2a1.9 1.9 0 0 1-1.9 1.9H5.15a1.9 1.9 0 0 1-1.9-1.9z"/>',

  // A picture: the frame, the sun, and the hill horizon — the mark everyone reads as "image".
  image:
    '<rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.4"/><circle cx="8.6" cy="9.9" r="1.6"/><path d="M4 16.4l4.3-3.7 3.2 2.8 3.2-2.7 4.3 3.7"/>',

  // Page + the two rules of a text block, with the PDF corner kept: it is a document first.
  pdf: `${PAGE}<path d="M9 12.4h2.2a1.35 1.35 0 0 1 0 2.7H9zM9 12.4V18"/><path d="M13.6 18v-5.6h1.5a1.5 1.5 0 0 1 1.5 1.5v2.6a1.5 1.5 0 0 1-1.5 1.5z"/>`,

  // A waveform, not a musical note: it is what audio LOOKS like in this product (denoise,
  // televoica), so the vocabulary is already the user's.
  audio: '<path d="M4 11v2M7.5 8.6v6.8M11 6.2v11.6M14.5 9.2v5.6M18 7.4v9.2M21 11v2" stroke-width="2"/>',

  video: '<rect x="3.25" y="5.25" width="17.5" height="13.5" rx="2.4"/><path d="M10.4 9.6l4.6 2.65-4.6 2.65z"/>',

  // Braces — the universal "this is JSON" without spelling it out.
  json: `${PAGE}<path d="M10.4 11.4c-1.1 0-1.1 1.4-1.1 2.1s0 2.1-1 2.1c1 0 1 1.4 1 2.1"/><path d="M13.9 11.4c1.1 0 1.1 1.4 1.1 2.1s0 2.1 1 2.1c-1 0-1 1.4-1 2.1"/>`,

  // The angle brackets of every code editor's file icon.
  code: `${PAGE}<path d="M10.6 12.9L8.6 15l2 2.1M13.7 12.9L15.7 15l-2 2.1"/>`,

  // Markdown's own mark: the M and the down-arrow, the way the spec's badge draws it.
  markdown: `${PAGE}<path d="M8.9 17.6v-4.6l1.9 2.1 1.9-2.1v4.6"/><path d="M15.6 13.2v3.4M14.3 15.3l1.3 1.5 1.3-1.5"/>`,

  // Plain text: the page and the lines on it. The base case a reader recognises instantly.
  text: `${PAGE}<path d="M9.4 12.6h5.2M9.4 15.4h5.2M9.4 18.2h3.2"/>`,

  // A box with a band and a clasp — a zip, not a document.
  archive:
    '<rect x="3.5" y="4.75" width="17" height="14.5" rx="2.3"/><path d="M3.5 9.4h17"/><path d="M11.1 12.5h1.8v2.4h-1.8z"/>',

  // The fallback: a page with nothing claimed about it. Anything we cannot name lands here,
  // so a row is never iconless.
  binary: PAGE,
};

/** The glyph markup for a file kind, or `undefined` if there is none. */
export const fileGlyphFor = (kind: string): string | undefined =>
  (FILE_GLYPHS as Record<string, string | undefined>)[kind];
