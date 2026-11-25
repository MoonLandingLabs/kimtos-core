// Where focus lands when a ConfirmDialog closes (#786). The regression: confirming an action
// that removes or disables its own trigger — a page swapping one control for
// "Resume" — left focus on <body>, because the restore focus()ed a detached/disabled node
// (a silent no-op) with nothing chosen instead. restoreFocus falls back to the page's <main>.
//
// Pinned on bare node with a fake DOM: the rest of www/test runs without jsdom, and the two
// behaviours that matter are both easy to break silently — quietly stealing focus to <main>
// when the opener was fine (the decline path), and failing to fall back when it was not.
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { restoreFocus } from '../utils/focusRestore'

// A stand-in for the slice of DOM restoreFocus touches: focus tracking, `disabled`,
// `isConnected`, and the attribute pair it uses to make <main> focusable. `focus()` mirrors
// the real no-op rules — a detached or disabled element cannot take focus.
class FakeEl {
  isConnected = true
  disabled = false
  private attrs = new Map<string, string>()

  constructor(
    readonly tag: string,
    private doc: FakeDoc,
  ) {}

  focus() {
    if (!this.isConnected || this.disabled) return // silent no-op, exactly like the browser
    this.doc.activeElement = this
  }

  hasAttribute(name: string) {
    return this.attrs.has(name)
  }

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value)
  }

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null
  }
}

// A document whose activeElement starts on <body>, like a real one, and whose querySelector
// only needs to answer for 'main'.
class FakeDoc {
  body = new FakeEl('body', this)
  activeElement: FakeEl = this.body
  main: FakeEl | null = null

  querySelector(sel: string) {
    return sel === 'main' ? this.main : null
  }
}

let doc: FakeDoc
beforeEach(() => {
  doc = new FakeDoc()
})

describe('restoreFocus (#786)', () => {
  // `instanceof HTMLElement` inside restoreFocus must accept a FakeEl, and bare node has no
  // HTMLElement at all. Alias it only while this suite runs, and restore it after, so the
  // global does not leak into the other www/test files sharing this process.
  let originalHTMLElement: unknown
  before(() => {
    originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement
    ;(globalThis as { HTMLElement?: unknown }).HTMLElement = FakeEl
  })
  after(() => {
    ;(globalThis as { HTMLElement?: unknown }).HTMLElement = originalHTMLElement
  })

  test('focuses the opener when it can still take focus (the decline path)', () => {
    const opener = new FakeEl('button', doc)
    doc.main = new FakeEl('main', doc)

    restoreFocus(opener as unknown as HTMLElement, doc as unknown as Document)

    assert.equal(doc.activeElement, opener)
    // The fallback must NOT run — stealing focus to <main> when the opener was fine would be
    // its own regression, moving the caret away from where the user was.
    assert.equal(doc.main.hasAttribute('tabindex'), false)
  })

  test('falls back to <main> when the opener was removed by the confirmed action', () => {
    const opener = new FakeEl('button', doc)
    opener.isConnected = false // v-if/v-else tore it out, as a page swap does
    doc.main = new FakeEl('main', doc)

    restoreFocus(opener as unknown as HTMLElement, doc as unknown as Document)

    assert.equal(doc.activeElement, doc.main, 'focus must land on the content landmark, not <body>')
    assert.equal(doc.main.getAttribute('tabindex'), '-1', 'and <main> is made programmatically focusable')
  })

  test('falls back to <main> when the opener is still disabled mid-request', () => {
    const opener = new FakeEl('button', doc)
    opener.disabled = true // busy stayed true across the round-trip
    doc.main = new FakeEl('main', doc)

    restoreFocus(opener as unknown as HTMLElement, doc as unknown as Document)

    assert.equal(doc.activeElement, doc.main)
  })

  test('falls back to <main> when there was no opener at all', () => {
    doc.main = new FakeEl('main', doc)

    restoreFocus(null, doc as unknown as Document)

    assert.equal(doc.activeElement, doc.main)
  })

  test('leaves an author-set tabindex on <main> alone', () => {
    const opener = new FakeEl('button', doc)
    opener.isConnected = false
    doc.main = new FakeEl('main', doc)
    doc.main.setAttribute('tabindex', '0')

    restoreFocus(opener as unknown as HTMLElement, doc as unknown as Document)

    assert.equal(doc.main.getAttribute('tabindex'), '0', 'must not clobber a tabindex the page set')
    assert.equal(doc.activeElement, doc.main)
  })

  test('does not throw when the opener is gone and the page has no <main>', () => {
    const opener = new FakeEl('button', doc)
    opener.isConnected = false
    // doc.main stays null.

    assert.doesNotThrow(() => restoreFocus(opener as unknown as HTMLElement, doc as unknown as Document))
    // Nothing to focus — focus stays where it was, same as before the fix, but no crash.
    assert.equal(doc.activeElement, doc.body)
  })
})
