// Whether the page scrolls is a property of the PAGE, not of any one dialog, so the lock
// is refcounted here — module scope, shared by every caller.
//
// This lives in its own module for a reason worth stating: a counter declared at the top
// of a `<script setup>` block looks module-scoped but is not. The SFC compiler moves every
// top-level binding into `setup()`, so each component instance gets its own copy, every
// count runs 0 -> 1 -> 0, and the refcount silently degrades to the boolean it replaced.
// The bug it is meant to prevent — the first of two overlapping dialogs to close unlocking
// the page behind the other — comes straight back, under a comment claiming otherwise.
//
// `html` carries `scrollbar-gutter: stable`, so hiding the scrollbar costs no layout shift
// and no element needs padding compensation.
let locks = 0

export function useScrollLock() {
  function lock() {
    if (locks++ === 0) document.documentElement.style.overflow = 'hidden'
  }

  function unlock() {
    // Clamped at zero so an unbalanced release cannot drive the count negative and strand
    // the page locked. It can go the other way after a hot reload — module state resets
    // while mounted instances keep theirs — but that self-corrects on the next full load
    // and only ever affects dev.
    if (locks > 0 && --locks === 0) document.documentElement.style.overflow = ''
  }

  return { lock, unlock }
}
