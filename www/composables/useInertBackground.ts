// The focus trap behind ConfirmDialog (#784). `aria-modal="true"` already walls screen
// readers off from the page behind the overlay; nothing walled off SIGHTED keyboard users,
// so Tab past the last button left the dialog and landed on a control behind a
// scroll-locked page — frequently off-screen and impossible to scroll to.
//
// The fix is `inert` on everything in <body> that is not the open dialog, rather than a
// hand-rolled keydown cycle. The browser then removes the background from the tab order AND
// from the accessibility tree, which is exactly what `aria-modal` was already promising.
// It also gives us the same Tab behaviour a native `<dialog>.showModal()` has: tabbing off
// the last control goes to the browser chrome and comes back at the top of the document —
// which, with the background inert, is the top of the dialog. A JS cycle can only imitate
// that, and gets it wrong for shadow DOM, iframes and `<video controls>`.
//
// Module scope, and a stack rather than a boolean, for the same reason useScrollLock is
// refcounted: a page can mount two dialogs (the global ConfirmHost plus its own), and whether the background is inert is a property of the PAGE, not of any one
// dialog. A per-instance flag would let the first dialog to close un-inert the page behind
// the one still open. Note that a counter is not enough here — which elements to inert
// depends on WHICH dialog is topmost, so we keep the overlays themselves.
const stack: HTMLElement[] = []

// Only the elements this module turned inert. An element that was already inert for its
// own reasons must stay inert when the dialog closes; clearing the attribute blindly would
// silently take someone else's inert away.
const marked = new Set<HTMLElement>()

// <body> holds more than the page: Nuxt injects <script> tags into it, and an inline SVG
// sprite would be an SVGElement, which has no `inert` at all — assigning to it silently
// creates a dead expando that we would then track forever. Neither can hold focus, so
// skipping them keeps the attribute off elements it does nothing for.
const UNRENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT'])

// Tested for the capability rather than `instanceof HTMLElement`: it is the property we
// are about to assign to that matters, and an SVGElement simply does not have it.
function inertable(el: Element): el is HTMLElement {
  return typeof (el as HTMLElement).inert === 'boolean' && !UNRENDERED.has(el.tagName)
}

function recompute() {
  // The topmost dialog is the only interactive one: with two open, the one underneath is
  // background too.
  const top = stack[stack.length - 1] ?? null

  for (const child of Array.from(document.body.children)) {
    if (!inertable(child)) continue
    if (top && !child.contains(top)) {
      if (!child.inert) {
        child.inert = true
        marked.add(child)
      }
    } else if (marked.has(child)) {
      child.inert = false
      marked.delete(child)
    }
  }

  // A marked element that has since left <body> (a Teleport target torn down while the
  // dialog was up) is never visited by the loop above, so drop it here rather than leak a
  // detached node for the lifetime of the page.
  for (const el of marked) if (!el.isConnected) marked.delete(el)
}

export function useInertBackground() {
  /**
   * Make everything outside `overlay` inert. Call it once the overlay is in the DOM —
   * before `v-if` has flushed there is nothing to exclude, and the whole page would be
   * inerted with no way out.
   */
  function trap(overlay: HTMLElement) {
    // Defensive against a double-open: the same overlay twice would need two releases.
    if (!stack.includes(overlay)) stack.push(overlay)
    recompute()
  }

  /** Release this dialog's claim. The background stays inert if another dialog is open. */
  function release(overlay: HTMLElement) {
    const i = stack.lastIndexOf(overlay)
    if (i !== -1) stack.splice(i, 1)
    recompute()
  }

  return { trap, release }
}
