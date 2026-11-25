// Where focus goes when a ConfirmDialog closes (#786).
//
// ConfirmDialog hands focus back to whatever opened it. That is right whenever the opener
// still exists and can take focus — the decline path, and most confirm paths. It is wrong
// for the one case this fixes: an action whose own side effect destroys or disables the
// control that opened the dialog. For example, a confirmed action that flips a flag, after which
// the page's v-if/v-else tears the opener out of the DOM and renders another control in its place. The captured opener is now detached, `focus()` is a
// silent no-op, and a keyboard user is dumped on <body> at the top of the document with no
// way back but tabbing from the start.
//
// The decline path already guarded `isConnected`, but a guard that declines to focus a dead
// element without choosing anything instead is exactly what leaves focus on <body>. The
// component cannot know the right per-caller target (the replacement control, the card, a
// landmark), so the honest default that fixes every caller at once is the page's <main>
// landmark: focus lands on the content region, and the next Tab enters it near where the
// user was, rather than at the very top of the page.
//
// Pure + auto-imported (Nuxt `utils/`) with the document injected, so the rule is named and
// unit-testable on bare node without jsdom — the rest of www/test runs there too.

/**
 * Restore focus after a dialog closes.
 *
 * Tries `opener` first; if it did not actually end up focused — it was removed, disabled or
 * left inert by the action just confirmed — falls back to the page's `<main>` landmark so
 * focus is never dropped to `<body>`.
 *
 * Detecting failure by "did focus actually land on the opener" is deliberate: it covers
 * detached, `disabled` and inert in one check, none of which throw and all of which leave
 * `focus()` a silent no-op. Enumerating each reason would drift the moment a fourth appears.
 *
 * @param opener the control that opened the dialog, or `null` if nothing was focused.
 * @param doc    the document to act on (injected for testing; defaults to the global one).
 */
export function restoreFocus(opener: HTMLElement | null, doc: Document = document): void {
  // Only worth attempting on a connected node — focus() on a detached one is a no-op, and
  // reading activeElement against it below would always fail anyway.
  if (opener?.isConnected) opener.focus()
  if (opener && doc.activeElement === opener) return

  // The opener could not take focus. Fall back to the page's <main>. www renders exactly one
  // <main> per page (the layout wraps every route), so the first match IS the nearest one.
  const main = doc.querySelector('main')
  if (!(main instanceof HTMLElement)) return
  // A landmark is not focusable by default; make it programmatically focusable without
  // adding it to the Tab order. Leave an author-set tabindex alone.
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
  // preventScroll: the fix is about focus POSITION (a keyboard user having to tab back from
  // the top), not the viewport. Scrolling <main>'s top into view would yank the page upward
  // and re-create the "dumped at the top" feeling — worse, it would move the replacement
  // control (Resume) the user is about to reach out from under them. Keep the view put.
  main.focus({ preventScroll: true })
}
