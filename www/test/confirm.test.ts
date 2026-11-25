// The confirm bus behind the site's one modal (#770). It replaced window.confirm(), so the thing
// worth pinning is that every caller's promise settles: a
// confirm() that never resolves leaves the confirm button stuck on "Working…" forever, with
// no way back — a worse failure than the native dialog it replaced.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { useConfirm } from '../composables/useConfirm'

describe('useConfirm (#770)', () => {
  test('resolves true when the user confirms', async () => {
    const { confirm, answer } = useConfirm()
    const pending = confirm({ title: 'Delete item?' })
    answer(true)
    assert.equal(await pending, true)
  })

  test('resolves false when the user cancels', async () => {
    const { confirm, answer } = useConfirm()
    const pending = confirm({ title: 'Delete item?' })
    answer(false)
    assert.equal(await pending, false)
  })

  test('exposes the request so the host can render it, and clears it on answer', () => {
    const { current, confirm, answer } = useConfirm()
    void confirm({ title: 'Delete your account?', message: 'Cannot be undone.', danger: true })
    assert.equal(current.value?.title, 'Delete your account?')
    assert.equal(current.value?.message, 'Cannot be undone.')
    assert.equal(current.value?.danger, true)
    answer(false)
    assert.equal(current.value, null)
  })

  test('defaults the button labels and the danger flag', () => {
    const { current, confirm, answer } = useConfirm()
    void confirm({ title: 'Sure?' })
    assert.equal(current.value?.confirmText, 'Confirm')
    assert.equal(current.value?.cancelText, 'Cancel')
    assert.equal(current.value?.danger, false)
    answer(false)
  })

  // The overlay swallows the clicks that would open a second dialog, so this should not
  // happen — but if it ever does, the superseded caller must not hang.
  test('a superseded request resolves false rather than hanging', async () => {
    const { confirm, answer } = useConfirm()
    const first = confirm({ title: 'First' })
    const second = confirm({ title: 'Second' })
    assert.equal(await first, false)
    answer(true)
    assert.equal(await second, true)
  })

  // The opener is captured when confirm() is CALLED, not when the dialog opens: callers
  // raise a busy flag first, which disables the clicked button before the dialog sees it.
  // Here there is no DOM at all, which must not throw — the composable is imported by the
  // page's setup, not only by the browser.
  test('captures an opener without a DOM, rather than throwing', () => {
    const { current, confirm, answer } = useConfirm()
    void confirm({ title: 'Sure?' })
    assert.equal(current.value?.opener, null)
    answer(false)
  })

  test('answering with nothing open is a no-op', () => {
    const { current, answer } = useConfirm()
    assert.equal(current.value, null)
    assert.doesNotThrow(() => answer(true))
    assert.equal(current.value, null)
  })
})
