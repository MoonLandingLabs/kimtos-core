// A single shared toast (status message that auto-dismisses).
//
// `show()` takes PLAIN TEXT, never markup. ToastHost.vue renders it as text
// (`{{ message }}`, never `v-html`) and that is deliberate: callers may forward
// arbitrary error strings straight in, so rendering them as HTML
// would turn every one of those call sites into an injection sink. Anything a
// caller passes is escaped; markup arrives as literal angle brackets, which is the
// intended outcome, not a bug to fix in the renderer (#759).
let timer: ReturnType<typeof setTimeout> | undefined

/** How long a toast stays up. The default suits an acknowledgement ("Saved"); a message
 *  the user must READ AND ACT ON — a failed payment (#754) — passes a longer one rather
 *  than slowing down every toast on the site. */
const DEFAULT_MS = 3200

export function useToast() {
  const message = useState('toast-message', () => '')
  const visible = useState('toast-visible', () => false)

  const show = (text: string, ms: number = DEFAULT_MS) => {
    message.value = text
    visible.value = true
    if (import.meta.client) {
      clearTimeout(timer)
      timer = setTimeout(() => (visible.value = false), ms)
    }
  }

  return { message, visible, show }
}
