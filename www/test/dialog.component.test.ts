// Component-level tests for www's two string-rendering dialogs (#759, #770, #784, #786), the
// last hop #861 could not previously reach: www had no way to mount a `.vue`, so the XSS guard
// in test/escaping.test.ts had to read component SOURCE instead of rendered output — and its
// own header admits the gap that leaves (a CHILD component rendering the message with `v-html`
// passes a source scan of the parent). This mounts the real components and asserts on the DOM
// they produce, which closes that gap and pins the focus behaviour the source scan cannot see.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ToastHost from '../components/ToastHost.vue'
import { useToast } from '../composables/useToast'

// A string that is harmless as text and an attack as HTML: if it is ever rendered with v-html,
// the <img> lands in the DOM and its onerror runs. Rendered as text, it stays literal.
const INJECTION = '<img src=x onerror="globalThis.__xss=true">'

const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(w: T): T {
  wrappers.push(w)
  return w
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__xss
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
})

describe('server-derived strings render as text, not HTML (#759)', () => {
  test('ToastHost escapes a message that contains markup', async () => {
    const wrapper = track(mount(ToastHost, { attachTo: document.body }))
    useToast().show(INJECTION)
    await flushPromises()

    const toast = wrapper.get('.toast').element
    assert.equal(toast.querySelector('img'), null, 'the markup must NOT become a real <img> node')
    assert.equal(toast.textContent?.trim(), INJECTION, 'the markup must survive as literal text')
    assert.notEqual((globalThis as Record<string, unknown>).__xss, true, 'no injected script ran')
  })

  test('ConfirmDialog escapes a message that contains markup', async () => {
    track(
      mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Heads up', message: INJECTION } }),
    )
    await flushPromises()

    const copy = document.querySelector('.confirm-copy') as HTMLElement
    assert.ok(copy, 'the message paragraph renders')
    assert.equal(copy.querySelector('img'), null, 'the markup must NOT become a real <img> node')
    assert.equal(copy.textContent, INJECTION, 'the markup must survive as literal text')
    assert.notEqual((globalThis as Record<string, unknown>).__xss, true, 'no injected script ran')
  })
})

describe('ConfirmDialog keyboard dispatch (#770)', () => {
  const card = () => document.querySelector('.confirm-card') as HTMLElement
  const cancelBtn = () => document.querySelector('.confirm-cancel') as HTMLElement
  function press(el: Element, key: string): KeyboardEvent {
    const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    return ev
  }

  test('Enter on the card confirms a non-destructive dialog', async () => {
    const wrapper = track(mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Publish?' } }))
    await flushPromises()
    const ev = press(card(), 'Enter')
    assert.equal(ev.defaultPrevented, true)
    assert.equal(wrapper.emitted('confirm')?.length, 1)
  })

  test('Enter on Cancel does NOT confirm and does NOT preventDefault', async () => {
    const wrapper = track(mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Publish?' } }))
    await flushPromises()
    const ev = press(cancelBtn(), 'Enter')
    assert.equal(ev.defaultPrevented, false, 'the focused Cancel button keeps its own activation')
    assert.equal(wrapper.emitted('confirm'), undefined)
  })

  test('Enter never confirms a destructive dialog', async () => {
    const wrapper = track(
      mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Delete?', danger: true } }),
    )
    await flushPromises()
    const ev = press(card(), 'Enter')
    assert.equal(ev.defaultPrevented, false)
    assert.equal(wrapper.emitted('confirm'), undefined)
  })

  test('Escape cancels', async () => {
    const wrapper = track(mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Publish?' } }))
    await flushPromises()
    const ev = press(card(), 'Escape')
    assert.equal(ev.defaultPrevented, true)
    assert.equal(wrapper.emitted('cancel')?.length, 1)
  })
})

describe('ConfirmDialog focus management (#784, #786)', () => {
  test('moves focus into the card on open and hands it back on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = track(mount(ConfirmDialog, { attachTo: document.body, props: { open: false, title: 'Delete?' } }))
    await wrapper.setProps({ open: true })
    await flushPromises()
    const card = document.querySelector('.confirm-card') as HTMLElement
    assert.equal(document.activeElement, card, 'focus moves into the dialog on open')

    await wrapper.setProps({ open: false })
    await flushPromises()
    // Focus is restored in a frame, not a tick (see ConfirmDialog.onClose) — wait one out.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    assert.equal(document.activeElement, opener, 'focus returns to the opener on close')

    opener.remove()
  })
})
