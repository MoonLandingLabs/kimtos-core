// Shared inline SVG icons (stroke-based, sized to match the UI) + a button helper.
// All use `currentColor`, so they take the surrounding text/icon color.

import { el } from '../lib/dom.js';

const svg = (size: number, body: string, sw = 1.7): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
  `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const TRASH = svg(
  15,
  '<path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>',
  1.6,
);
export const PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>`;
export const BURGER = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>`;
export const DOWNLOAD = svg(
  15,
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
);
export const FOLDER = svg(
  15,
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  1.6,
);
export const PENCIL = svg(14, '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>');
export const INFO = svg(
  15,
  '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-5"></path><path d="M12 8h.01"></path>',
);
export const BOOK = svg(
  15,
  '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"></path><path d="M4 19a2 2 0 0 1 2-2h12"></path>',
  1.6,
);
// A box with a lid slot — an archive, and the "unpack it" actions in the file menu.
export const ARCHIVE = svg(
  15,
  '<path d="M3 7h18v3H3z"></path><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"></path><path d="M10 14h4"></path>',
  1.6,
);
export const BACK = svg(16, '<path d="M15 6l-6 6 6 6"></path>', 1.8);
// "Show me the rendered result" — Notes' compact preview switch pairs it with PENCIL
// for the way back to the source.
export const EYE = svg(
  15,
  '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="2.6"></circle>',
  1.6,
);

// The two view modes a listing can be in (KimtFS's explorer toggles between them, #219).
// UI CHROME, which is why they live here and not in @kimtos/icons — that package holds the
// app glyphs (a white mark on an accent tile) and the file-kind glyphs (a mark for a JSON, a
// PDF, an image). These are neither: they are this interface's furniture, shared by nobody.
export const LIST_VIEW = svg(
  16,
  '<path d="M4 6h1M4 12h1M4 18h1"></path><path d="M9 6h11M9 12h11M9 18h11"></path>',
  1.8,
);
// Sort. The grid has no column header to click, so the sort has to live somewhere a grid can
// reach it (#237). Chrome, like the two below it.
export const SORT = svg(
  16,
  '<path d="M4 7h10M4 12h7M4 17h4"></path><path d="M17.5 7v11M17.5 18l2.5-2.6M17.5 18L15 15.4"></path>',
  1.8,
);
export const GRID_VIEW = svg(
  16,
  '<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"></rect>' +
    '<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"></rect>' +
    '<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"></rect>' +
    '<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"></rect>',
  1.6,
);
export const SEARCH = svg(15, '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>', 1.7);
export const OPEN = svg(
  14,
  '<path d="M15 3h6v6"></path><path d="M10 14L21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>',
);
export const COPY = svg(
  14,
  '<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
);
export const CHECK = svg(14, '<path d="M20 6L9 17l-5-5"></path>', 1.9);
export const STAR = svg(16, '<path d="M12 3.6l2.5 5 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"></path>');
export const TAG = svg(
  14,
  '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z"></path>' +
    '<circle cx="7.5" cy="7.5" r="1.2"></circle>',
);
export const MIC = svg(
  16,
  '<rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><line x1="12" y1="18" x2="12" y2="22"></line>',
  1.6,
);
export const UPLOAD = svg(
  22,
  '<path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M5 20h14"></path>',
  1.5,
);
// Video camera — the Video Recorder app + its camera toggle.
export const CAMERA = svg(
  16,
  '<path d="M15 8.5l5-3v13l-5-3"></path><rect x="3" y="6" width="12" height="12" rx="2"></rect>',
  1.6,
);
// Monitor/screen — the screen-share toggle.
export const SCREEN = svg(
  16,
  '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>',
  1.6,
);
// Audio "equalizer" bars — used for the Denoise cross-link.
export const WAVE = svg(15, '<path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"></path>', 1.8);
// Lines of text — used for the "Extract transcript" cross-link.
export const TEXT = svg(15, '<path d="M5 7h14M5 12h14M5 17h9"></path>', 1.7);
// Pushpin — pin a conversation to the top of the list.
export const PIN = svg(14, '<path d="M12 17v5"></path><path d="M9 3h6l-1 7 3 3v1H7v-1l3-3z"></path>', 1.6);
// Sliders — per-chat generation controls (system prompt / creativity / length).
export const SLIDERS = svg(
  15,
  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"></path>' + '<path d="M2 14h4M10 8h4M18 16h4"></path>',
  1.7,
);
// Rotating arrow — regenerate the last reply.
export const REGEN = svg(14, '<path d="M21 3v6h-6"></path><path d="M20.5 14a8.5 8.5 0 1 1-2-8.9L21 9"></path>', 1.7);

// Build an `.icon-button` with an SVG icon and (optional) title/handler.
export function iconButton(
  icon: string,
  { title, onClick, className = '' }: { title?: string; onClick?: (e: MouseEvent) => void; className?: string } = {},
): HTMLButtonElement {
  const btn = el('button', `icon-button ${className}`.trim());
  btn.type = 'button';
  btn.innerHTML = icon;
  if (title) {
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}
