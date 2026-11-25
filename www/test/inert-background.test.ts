// The focus trap behind ConfirmDialog (#784). Tab used to walk straight out of an open
// dialog and into the page behind the overlay, which is scroll-locked — so the focused
// control was often off-screen and unreachable. The fix marks everything in <body> that is
// not the dialog `inert`, which takes it out of the tab order.
//
// Pinned by tests for the same reason useScrollLock is: the state is module-scoped and
// shared by every dialog on the site, and the two failure modes are both invisible on
// inspection — a per-instance copy (which lets the first of two dialogs to close un-inert
// the page behind the other) and a leaked stack entry (which leaves the WHOLE page inert
// with no way to reach it).
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useInertBackground } from '../composables/useInertBackground'

// A stand-in for a DOM element: enough of `inert`, `contains` and `isConnected` for the
// composable, with no jsdom dependency (the rest of www/test runs on bare node too).
class FakeEl {
  // Optional because an SVGElement genuinely has no `inert`, and one test models that.
  inert?: boolean = false
  isConnected = true
  children: FakeEl[] = []
  readonly tagName: string

  constructor(
    readonly name: string,
    supportsInert = true,
  ) {
    // The composable skips non-rendered tags by name, so a fake needs a real tagName.
    this.tagName = name.replace(/^[#.]/, '').toUpperCase()
    if (!supportsInert) delete this.inert
  }

  append(child: FakeEl) {
    this.children.push(child)
    return child
  }

  contains(other: FakeEl): boolean {
    return other === this || this.children.some((c) => c.contains(other))
  }
}

const body = new FakeEl('body')
globalThis.document = { body, documentElement: { style: {} } } as unknown as Document

// Every overlay any test traps, so a test that throws mid-way cannot leave the module's
// stack dirty for the next one.
const overlays: FakeEl[] = []

function overlay(name: string) {
  const el = new FakeEl(name)
  overlays.push(el)
  return el
}

describe('useInertBackground (#784)', () => {
  beforeEach(() => {
    const { release } = useInertBackground()
    for (const el of overlays) release(el as unknown as HTMLElement)
    overlays.length = 0
    body.children = []
  })

  test('inerts every body child except the open dialog', () => {
    const { trap } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)

    // The regression: without this, Tab from the last button lands on a link in the page
    // behind the overlay.
    assert.equal(app.inert, true)
    assert.equal(dialog.inert, false)
  })

  test('excludes the dialog by containment, not identity', () => {
    // The card the user actually tabs through is nested inside the overlay.
    const { trap } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))
    const card = dialog.append(overlay('card'))

    trap(card as unknown as HTMLElement)

    assert.equal(app.inert, true)
    assert.equal(dialog.inert, false, 'the overlay holding the focused card must stay live')
  })

  test('releasing restores the background', () => {
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)
    release(dialog as unknown as HTMLElement)

    assert.equal(app.inert, false)
  })

  test('stays inert while a second dialog is still open', () => {
    // /account mounts two dialogs (the global ConfirmHost plus its own delete dialog). The
    // first to close must not hand the page back while the other is up — the same bug the
    // scroll lock is refcounted against.
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const first = body.append(overlay('first'))
    const second = body.append(overlay('second'))

    trap(first as unknown as HTMLElement)
    trap(second as unknown as HTMLElement)
    release(first as unknown as HTMLElement)

    assert.equal(app.inert, true)
    release(second as unknown as HTMLElement)
    assert.equal(app.inert, false)
  })

  test('only the topmost dialog is interactive, and the one below is restored', () => {
    const { trap, release } = useInertBackground()
    const first = body.append(overlay('first'))
    const second = body.append(overlay('second'))

    trap(first as unknown as HTMLElement)
    assert.equal(first.inert, false)

    trap(second as unknown as HTMLElement)
    assert.equal(first.inert, true, 'a dialog underneath another one is background too')
    assert.equal(second.inert, false)

    release(second as unknown as HTMLElement)
    assert.equal(first.inert, false, 'and becomes interactive again when the top one closes')
  })

  test('never clears an inert it did not set', () => {
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const hidden = body.append(new FakeEl('already-inert'))
    hidden.inert = true
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)
    release(dialog as unknown as HTMLElement)

    assert.equal(app.inert, false)
    assert.equal(hidden.inert, true, "someone else's inert must survive the dialog")
  })

  test('the state is shared across callers, not per call site', () => {
    // Two separate useInertBackground() calls must see ONE stack. Were the state per
    // caller — the trap that catches a counter written inside `<script setup>` — this
    // release would not reach the trap taken above and the page would stay inert.
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))

    useInertBackground().trap(dialog as unknown as HTMLElement)
    assert.equal(app.inert, true)
    useInertBackground().release(dialog as unknown as HTMLElement)
    assert.equal(app.inert, false)
  })

  test('a double trap needs only one release', () => {
    // The watcher and the mounted hook could both fire onOpen for an already-open instance;
    // a second stack entry would survive the single release and strand the page inert.
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)
    trap(dialog as unknown as HTMLElement)
    release(dialog as unknown as HTMLElement)

    assert.equal(app.inert, false)
  })

  test('releasing an overlay that was never trapped is a no-op', () => {
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))
    const stranger = new FakeEl('never-trapped')

    trap(dialog as unknown as HTMLElement)
    release(stranger as unknown as HTMLElement)

    assert.equal(app.inert, true, 'an unrelated release must not lift a live trap')
    release(dialog as unknown as HTMLElement)
    assert.equal(app.inert, false)
  })

  test('skips body children that cannot hold focus', () => {
    // <body> is not just the page: Nuxt injects <script> into it, and an inline SVG sprite
    // has no `inert` property at all — assigning to that one would create a dead expando
    // this module then tracks for the lifetime of the page.
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const script = body.append(new FakeEl('script'))
    const sprite = body.append(new FakeEl('svg', false))
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)

    assert.equal(app.inert, true)
    assert.equal(script.inert, false, 'a script tag cannot hold focus and must be left alone')
    assert.equal(sprite.inert, undefined, 'an element without `inert` must not gain one')

    release(dialog as unknown as HTMLElement)
    assert.equal(app.inert, false)
  })

  test('an overlay torn down while inert does not leak', () => {
    // A Teleport target removed from <body> while the dialog is up is never visited by the
    // recompute loop again, so it must be dropped from the tracking set explicitly.
    const { trap, release } = useInertBackground()
    const app = body.append(new FakeEl('#__nuxt'))
    const dialog = body.append(overlay('dialog'))

    trap(dialog as unknown as HTMLElement)
    assert.equal(app.inert, true)

    // The app root is torn out from under us.
    app.isConnected = false
    body.children = body.children.filter((c) => c !== app)
    release(dialog as unknown as HTMLElement)

    // Re-attaching must not find it still flagged as ours to clear.
    app.isConnected = true
    app.inert = true
    body.children.unshift(app)
    const next = body.append(overlay('next'))
    trap(next as unknown as HTMLElement)
    release(next as unknown as HTMLElement)
    assert.equal(app.inert, true, 'a stale entry must not clear an inert set after the fact')
  })
})
