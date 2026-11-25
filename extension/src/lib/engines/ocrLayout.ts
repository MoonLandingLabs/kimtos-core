// The page-layout → Tesseract page-segmentation mapping, split out from ocr.ts so the
// OCR settings UI (snaptext) can import these lightweight constants STATICALLY without
// pulling the tesseract-backed engine (ocr.ts) into its eager bundle. ocr.ts stays
// dynamic-import-only; this module has no runtime dependencies of its own.

// How Tesseract should segment the page before reading it. We MUST pass one:
// the Tesseract *library* default is PSM 6 ("assume a single uniform block of
// text"), while the Tesseract CLI defaults to PSM 3 (full automatic layout
// analysis). Leaving it unset therefore silently gave us the single-block
// assumption, which fits one block over the whole image and DROPS every line
// that does not match it — a document's title, a page's hero headline — and
// interleaves a sidebar into the body text. That is #725: on a heading-varied
// page it lost 3 of 17 lines, including the title, and never did better than
// PSM 3 on any test image.
export type PageLayout = 'auto' | 'column' | 'block' | 'sparse';

export const DEFAULT_LAYOUT: PageLayout = 'auto';

// ONE table: the label the Settings select shows and the Tesseract PSM it maps
// to (values from Tesseract's publictypes.h). The app's setting builds its
// options from this rather than restating the list, so the two cannot drift.
const LAYOUTS: Record<PageLayout, { label: string; psm: string }> = {
  auto: { label: 'Automatic', psm: '3' }, // PSM_AUTO — full page analysis, no orientation detection
  column: { label: 'Single column', psm: '4' }, // PSM_SINGLE_COLUMN — one column, variable text sizes
  block: { label: 'Single block', psm: '6' }, // PSM_SINGLE_BLOCK — one uniform block (the library default)
  sparse: { label: 'Scattered text', psm: '11' }, // PSM_SPARSE_TEXT — as much text as possible, no order
};

/** The Layout setting's choices, in declaration order. */
export const LAYOUT_OPTIONS: { value: PageLayout; label: string }[] = (Object.keys(LAYOUTS) as PageLayout[]).map(
  (value) => ({ value, label: LAYOUTS[value].label }),
);

/** Tesseract page-segmentation mode for a layout choice, falling back to the default. */
export function pageSegMode(layout?: string): string {
  return (LAYOUTS[layout as PageLayout] ?? LAYOUTS[DEFAULT_LAYOUT]).psm;
}
