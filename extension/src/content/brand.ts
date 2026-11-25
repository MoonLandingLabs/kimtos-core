// Kimtos brand mark for content-script UI (the capture toast + the field button).
// Inlined literal colours are intentional — this renders inside shadow roots on
// arbitrary external pages where the kimtos theme tokens don't exist.
const ROOF_DOCK =
  '<path d="M18 48 L50 23 L82 48" fill="none" stroke="currentColor" stroke-width="8.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<g fill="currentColor"><rect x="26" y="58" width="14" height="15" rx="4.2"/><rect x="43" y="58" width="14" height="15" rx="4.2"/><rect x="60" y="58" width="14" height="15" rx="4.2"/></g>';

/** The gradient-squircle Kimtos mark at `px` size (ids are shadow-root-scoped). */
export function brandMark(px: number): string {
  return (
    `<svg viewBox="0 0 100 100" width="${px}" height="${px}" style="display:block"><defs>` +
    '<linearGradient id="kc-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa2ff"/>' +
    '<stop offset=".46" stop-color="#5b6cff"/><stop offset="1" stop-color="#18b6a4"/></linearGradient></defs>' +
    `<rect width="100" height="100" rx="23" fill="url(#kc-brand)"/><g style="color:#fff">${ROOF_DOCK}</g></svg>`
  );
}
