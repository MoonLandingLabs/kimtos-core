// Tiny DOM helpers shared across the whole app.

// Create an element. With a literal tag you get the precise element type
// (e.g. el('input') → HTMLInputElement); a dynamic tag falls back to HTMLElement.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string | null,
): HTMLElementTagNameMap[K];
export function el(tag: string, className?: string, text?: string | null): HTMLElement;
export function el(tag: string, className?: string, text?: string | null): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Empty a node (clearer than node.replaceChildren() at call sites).
export const clear = (node: ParentNode): void => node.replaceChildren();

// Where an overlay belonging to `node` should be mounted, and which document/window
// it should talk to.
//
// An app that is popped out into a floating window lives in a DIFFERENT document, so
// this module's `document` is always the new-tab page. An overlay put there sits
// behind the window the user is looking at; an Esc listener bound there never fires
// for keys pressed in the window; and `window.innerWidth` is the page's, not the
// window's, so anything positioned with it lands off-screen. Everything follows the
// element it belongs to instead. All three fall back to this page when there is no
// node, so a caller that has nothing to pass behaves exactly as before (#85).
//
// The node must be one that actually MOVES into the floating window: popOut() moves
// the app body's CHILDREN, so the app's root element is the owner — not `body`, which
// stays behind.
// A FULL-SCREEN window is the second way the host can be wrong, and it hides an overlay just as
// completely as the popped-out case above (#1251 gave every app window a full-screen control, so
// this went from one app's problem to every app's).
//
// A full-screen element is promoted to the browser's TOP LAYER and painted over an opaque
// `::backdrop`. Nothing outside its subtree is visible, whatever its z-index — and the confirm
// overlay asks for 1000000, which is exactly the sort of number that makes this look impossible
// until you remember the top layer is not part of the z-index game at all. So a "Delete this
// recording?" confirm, or an app's own settings window, opened from a full-screen app rendered
// UNDER it and could not be reached or dismissed.
//
// Mounting into the full-screen element puts the overlay in the top layer with it. `.dialog` sets
// no transform, so a `position: fixed` overlay still resolves against the viewport rather than
// against its new parent.
export const overlayHost = (node?: Element | null): HTMLElement => {
  const doc = ownerDoc(node);
  const fs = doc.fullscreenElement;
  return fs instanceof HTMLElement ? fs : doc.body;
};
export const ownerDoc = (node?: Element | null): Document => node?.ownerDocument ?? document;
export const ownerView = (node?: Element | null): Window => ownerDoc(node).defaultView ?? window;

// Escape the HTML special characters &, <, > for safe text interpolation.
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>]/g, (c) => HTML_ESCAPES[c] ?? c);

// An image URL we are willing to put on an <img src>. We only ever show the user's own
// pictures — object URLs and data URIs — so anything else (a remote `https:` image, which would
// be a request to an outside host, or a `javascript:` or other exotic scheme) is dropped rather than
// assigned. Defensive: an <img> does not execute script, but this keeps an untrusted string from ever
// reaching the sink.
export const safeImgSrc = (src: unknown): string =>
  typeof src === 'string' && /^(?:blob:|data:image\/)/i.test(src) ? src : '';
