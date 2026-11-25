// The page scroll lock behind ConfirmDialog (#770). Refcounted because two dialogs can be
// mounted at once (/account has the global ConfirmHost plus its own delete dialog), and a
// boolean lets the first one to close unlock the page behind the one still open.
//
// This is pinned by a test because the bug is invisible on inspection: the counter was
// first written at the top of a `<script setup>` block, which LOOKS module-scoped but is
// compiled into setup(), giving every instance its own copy and silently degrading the
// refcount back to a boolean. A test that shares the module across callers catches that.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useScrollLock } from '../composables/useScrollLock'

// The composable reaches for document.documentElement; give it somewhere to write.
const el = { style: { overflow: '' } }
globalThis.document = { documentElement: el } as unknown as Document

describe('useScrollLock (#770)', () => {
  beforeEach(() => {
    // Drain any count left by a previous test, then reset the observable state.
    const { unlock } = useScrollLock()
    for (let i = 0; i < 10; i++) unlock()
    el.style.overflow = ''
  })

  test('locks on the first caller and unlocks on the last', () => {
    const { lock, unlock } = useScrollLock()
    lock()
    assert.equal(el.style.overflow, 'hidden')
    unlock()
    assert.equal(el.style.overflow, '')
  })

  test('stays locked while a second caller still holds it', () => {
    const a = useScrollLock()
    const b = useScrollLock()
    a.lock()
    b.lock()
    a.unlock()
    // The regression this guards: /account's dialog closing must not let the page scroll
    // behind a dialog that is still open.
    assert.equal(el.style.overflow, 'hidden')
    b.unlock()
    assert.equal(el.style.overflow, '')
  })

  test('the count is shared across callers, not per call site', () => {
    // Two separate useScrollLock() calls must see ONE counter. If the state were per
    // caller this would still read 'hidden' after the balancing unlock below.
    useScrollLock().lock()
    useScrollLock().unlock()
    assert.equal(el.style.overflow, '')
  })

  test('an unbalanced unlock cannot drive the count negative', () => {
    const { lock, unlock } = useScrollLock()
    unlock()
    unlock()
    lock()
    // Were the count at -2, this lock would not have taken effect.
    assert.equal(el.style.overflow, 'hidden')
    unlock()
    assert.equal(el.style.overflow, '')
  })
})
