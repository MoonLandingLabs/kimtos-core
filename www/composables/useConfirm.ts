// A themed confirm shared across the site (rendered by ConfirmHost.vue), replacing the
// browser-native confirm() — which ignores our tokens and blocks the main thread. Mirrors
// the useToast bus: one pending request, resolved by ConfirmHost on answer.
//
// Usage:  if (!(await confirm({ title: 'Cancel?', message: '…' }))) return
//
// A module-level ref (not useState) is deliberate: a confirm only ever exists after a user
// click, so it is client-only and never crosses an SSR request boundary. `ref` is imported
// explicitly rather than auto-imported so this module is testable outside Nuxt.
import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** Style the confirm action as destructive. */
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  confirmText: string
  cancelText: string
  danger: boolean
  /** The control that opened the dialog, so focus can be handed back to it on close. */
  opener: HTMLElement | null
  resolve: (ok: boolean) => void
}

const current = ref<ConfirmRequest | null>(null)

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      // A pending request being replaced (it shouldn't happen — the overlay swallows the
      // clicks that would open a second one) resolves false so its caller never hangs.
      current.value?.resolve(false)
      current.value = {
        ...opts,
        confirmText: opts.confirmText ?? 'Confirm',
        cancelText: opts.cancelText ?? 'Cancel',
        danger: opts.danger ?? false,
        // Captured HERE, synchronously, and not when the dialog opens: a caller typically
        // raises a `busy` flag before awaiting, which disables the very button that was
        // clicked. Vue applies that to the DOM on the next flush, so this is the last
        // moment the opener is still the focused, enabled element.
        opener: import.meta.client ? (document.activeElement as HTMLElement | null) : null,
        resolve,
      }
    })
  }

  function answer(ok: boolean) {
    const req = current.value
    if (!req) return
    current.value = null
    req.resolve(ok)
  }

  return { current, confirm, answer }
}
