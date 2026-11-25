// The APP glyphs — the inner markup of a 24×24 line icon per app, keyed by the
// app's canonical id (the same id the extension descriptor uses). White marks
// meant to sit on the accent tile; drawn with `currentColor` so they invert
// cleanly. Individual shapes may override the default stroke (a filled sparkle,
// a heavier waveform). This is the single source of truth for both the
// extension dock/App Store and the marketing site.
//
// There are TWO glyph sets in this package, and they are not interchangeable:
//
//   APP_GLYPHS (here)         per APP id. A white mark ON the accent squircle.
//                             Rendered by appGlyphSvg / appTileSvg / paintAppTile.
//   FILE_GLYPHS (fileGlyphs.ts)  per FILE KIND. Background-less — a bare mark that
//                             inherits the surrounding text colour, for a file listing.
//                             Rendered by fileGlyphSvg.
//
// A new APP gets a glyph here. A new FILE TYPE gets one there. Putting a file-type mark in
// this record would give it an accent tile it was never drawn for.

/** Canonical app ids that have a glyph. */
export type AppId =
  | 'televoica'
  | 'calculator'
  | 'tasks'
  | 'snaptext'
  | 'notes'
  | 'pdflib'
  | 'kimtai'
  | 'denoise'
  | 'grammit'
  | 'notaboard'
  | 'vidrec'
  | 'anubisdb'
  | 'tabs'
  | 'devtools'
  | 'thoth'
  | 'rephrase'
  | 'kimtfs'
  | 'clipboard'
  | 'retouch'
  | 'fakeform'
  | 'voicestudio'
  | 'kimtmanager';

export const APP_GLYPHS: Record<AppId, string> = {
  // A monitor showing a live trace: the app is a window onto work in progress.
  kimtmanager:
    '<rect x="2.75" y="4.25" width="18.5" height="13" rx="2.4"/><path d="M9 21h6M12 17.25V21"/><path d="M6.4 11.4h2.3l1.5-2.9 2 5.4 1.4-2.5h2"/>',
  televoica:
    '<rect x="9" y="2.75" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3.25M8.5 20.75h7"/>',
  calculator:
    '<rect x="5" y="2.75" width="14" height="18.5" rx="2.7"/><path d="M8.2 6.6h7.6"/><path d="M9 12h.02M12 12h.02M15 12h.02M9 15.4h.02M12 15.4h.02M15 15.4h.02M9 18.7h.02M15 18.7h.02" stroke-width="2.3"/>',
  tasks: '<path d="M3.6 6.5l1.6 1.6 3-3.1M3.6 13.4l1.6 1.6 3-3.1"/><path d="M11.6 6.6h8.8M11.6 13.5h8.8"/>',
  snaptext:
    '<rect x="3.25" y="5" width="17.5" height="14" rx="2.6"/><circle cx="8.6" cy="10.1" r="1.7"/><path d="M4 16.6l4.2-3.6 3.3 2.8 3.1-2.6 4.4 3.8"/>',
  notes:
    '<path d="M12 6.2C10 4.9 7.2 4.4 4.2 5v13c3-.6 5.8-.1 7.8 1.2 2-1.3 4.8-1.8 7.8-1.2V5c-3-.6-5.8-.1-7.8 1.2z"/><path d="M12 6.2V19.2"/>',
  pdflib: '<path d="M6.5 3h7l4.5 4.5V21H6.5z"/><path d="M13.5 3v4.5H18"/><path d="M9.4 12.5h5.2M9.4 16h5.2"/>',
  kimtai:
    '<path fill="currentColor" stroke="none" d="M12 2.6l1.6 4.5a3 3 0 0 0 1.8 1.8l4.5 1.6-4.5 1.6a3 3 0 0 0-1.8 1.8L12 18.4l-1.6-4.5a3 3 0 0 0-1.8-1.8L4.1 10.5l4.5-1.6a3 3 0 0 0 1.8-1.8z"/><path fill="currentColor" stroke="none" d="M18.6 14.8l.62 1.78 1.78.62-1.78.62-.62 1.78-.62-1.78-1.78-.62 1.78-.62z"/>',
  denoise: '<path stroke-width="2.1" d="M4 10.5v3M8 6.5v11M12 9v6M16 4.5v15M20 10.5v3"/>',
  grammit: '<path d="M4 7.4h11M4 12.4h7"/><path d="M12.4 15.6l2.4 2.4 5.2-5.5"/>',
  notaboard: '<path d="M4 20l1.2-4.2L16.2 4.8a2.3 2.3 0 0 1 3.2 3.2L8.4 19z"/><path d="M13.8 7.2l3 3"/>',
  vidrec: '<rect x="2.75" y="6.25" width="12.5" height="11.5" rx="2.6"/><path d="M15.25 10.5l6-3.25v9.5l-6-3.25z"/>',
  anubisdb:
    '<ellipse cx="12" cy="5.6" rx="7" ry="2.6"/><path d="M5 5.6v12.8c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6V5.6"/><path d="M5 12c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6"/>',
  tabs: '<rect x="3" y="5" width="18" height="15" rx="2.5"/><path d="M3 9.5h18M8 5v4.5M13 5v4.5"/>',
  devtools:
    '<path d="M8 4c-2.2 0-3 1-3 3v1.5c0 1.1-.6 1.8-2 2 1.4.2 2 .9 2 2V17c0 2 .8 3 3 3"/><path d="M16 4c2.2 0 3 1 3 3v1.5c0 1.1.6 1.8 2 2-1.4.2-2 .9-2 2V17c0 2-.8 3-3 3"/>',
  thoth:
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20.5 20.5l-4.7-4.7"/><path d="M10.5 6.7l.85 2 2 .85-2 .85-.85 2-.85-2-2-.85 2-.85z"/>',
  rephrase: '<path d="M4 8.5h11"/><path d="M12 5.5l3 3-3 3"/><path d="M20 15.5H9"/><path d="M12 12.5l-3 3 3 3"/>',
  kimtfs:
    '<path d="M3.5 7.5A1.8 1.8 0 0 1 5.3 5.7h3.4l1.9 1.9h8.1a1.8 1.8 0 0 1 1.8 1.8v7.3a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/>',
  clipboard:
    '<rect x="5" y="4.75" width="14" height="16.5" rx="2.5"/><rect x="8.75" y="2.75" width="6.5" height="4" rx="1.7"/><path d="M8.5 11.4h7M8.5 15.2h4.5"/>',
  retouch: '<path d="M6.5 2v13a2.5 2.5 0 0 0 2.5 2.5h13"/><path d="M17.5 22V9a2.5 2.5 0 0 0-2.5-2.5H2"/>',
  // A form card, its rows, and a bolt: the one keypress that fills it.
  fakeform:
    '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.2"/><path d="M7.3 8.3h9.4M7.3 11.8h5"/><path d="M15.7 12.4l-2.7 4.3h2.3l-.5 3 3.1-4.6h-2.3z"/>',
  // A waveform with sound arcs radiating out: text turned into voice.
  voicestudio:
    '<path stroke-width="2" d="M4 10v4M7.2 7.5v9M10.4 9.7v4.6"/><path d="M14.3 8.7a5 5 0 0 1 0 6.6"/><path d="M17.4 6.3a9 9 0 0 1 0 11.4"/>',
};

/** The glyph markup for an id, or `undefined` if the app has none. */
export const glyphFor = (id: string): string | undefined => (APP_GLYPHS as Record<string, string | undefined>)[id];
