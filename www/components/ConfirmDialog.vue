<script setup lang="ts">
// The one confirm dialog www has (#770). Presentational: it owns the overlay, the keyboard
// and the focus behaviour, and nothing else. Two ways in — `useConfirm()` for a plain
// yes/no (rendered by ConfirmHost), or this component directly when the body needs real
// content and the dialog must stay open while the action runs.
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** Body text. Omit and pass the default slot instead when the body needs markup. */
    message?: string
    confirmText?: string
    cancelText?: string
    /** Style the confirm action as destructive. */
    danger?: boolean
    /** The action is in flight: both buttons disable and the dialog refuses to close. */
    busy?: boolean
    /** Confirm-button label while `busy` (e.g. 'Deleting…'). */
    busyText?: string
    /**
     * The control to hand focus back to on close. Pass it when the caller disables that
     * control while the dialog is up — by the time this component sees `open`, the DOM has
     * already been patched and the element has been blurred, so it cannot find it itself.
     */
    opener?: HTMLElement | null
  }>(),
  { confirmText: 'Confirm', cancelText: 'Cancel', danger: false, busy: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const slots = useSlots()
const titleId = useId()
const card = ref<HTMLElement | null>(null)
const overlay = ref<HTMLElement | null>(null)

// alertdialog is the correct role for a plain yes/no, and it is the usual choice —
// but it is explicitly wrong for a dialog whose body holds a form, which is what the
// caller slots in. Derive it rather than making every caller remember.
const role = computed(() => (slots.default ? 'dialog' : 'alertdialog'))

// A dialog that cannot be dismissed mid-request: closing while the action is in
// flight would strand the user on a page whose state no longer matches.
const dismiss = () => {
  if (!props.busy) emit('cancel')
}

function onKey(e: KeyboardEvent) {
  if (!props.open || props.busy) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
    return
  }
  // Enter confirms, restoring what the native confirm() this replaced did for free — but
  // ONLY while focus is still on the card itself, the element we focus on open. Anywhere
  // else the browser's own activation must win: with focus on a "Keep" button, preventDefault
  // here would suppress that button and confirm instead, against the user's explicit
  // keyboard input. Destructive dialogs opt out entirely; "Enter
  // deletes it" is not a default anyone wants.
  if (e.key === 'Enter' && !props.danger && e.target === card.value) {
    e.preventDefault()
    emit('confirm')
  }
}

// Focus is moved into the dialog on open and handed back to whatever opened it on close —
// without this a keyboard user's caret stays behind the overlay, on a control they cannot
// see. Neither of www's hand-rolled dialogs did this before.
let opener: HTMLElement | null = null

// The overlay this instance made the background inert for, held so the release is always
// against the same element the trap was taken on.
let trapped: HTMLElement | null = null

const { lock, unlock } = useScrollLock()
const { trap, release } = useInertBackground()

async function onOpen() {
  // Prefer the caller's own record of what was focused; fall back to reading it here,
  // which is correct whenever the opener is not disabled while the dialog is up.
  opener = props.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  lock()
  await nextTick()
  // Bail if the dialog was closed during the await: onClose already ran (its releaseTrap a
  // no-op, since nothing was trapped yet), so trapping now would leave the page inert with
  // no release to follow. The lock is symmetric — it is taken synchronously above and
  // released in onClose — but the trap cannot be, because the overlay does not exist until
  // v-if flushes on this tick.
  if (!props.open) return
  // Only now does the overlay exist (`v-if="open"`), and only now can it be excluded from
  // the inert background — so this must come after the tick, and before the focus below:
  // inerting the page blurs whatever was focused behind it, and the card is the element we
  // want to catch that focus.
  if (overlay.value) {
    trapped = overlay.value
    trap(trapped)
  }
  card.value?.focus()
}

// Released against the element we trapped, not against `overlay.value` — the ref is null
// once `v-if` has torn the overlay down, and a stack entry that never gets released leaves
// the whole page inert with no way to reach it.
function releaseTrap() {
  const el = trapped
  trapped = null
  if (el) release(el)
}

function onClose() {
  unlock()
  // Before the restore below: focus() on an element inside an inert subtree is a silent
  // no-op, and the opener is behind the overlay by definition.
  releaseTrap()
  // Restore in a frame, not a tick. The caller's continuation (which re-enables its
  // button) runs in a microtask queued AFTER this watcher's, so any fixed number of
  // nextTicks is a guess about flush ordering; a frame is after all of it, and
  // focusing a still-disabled button is a silent no-op that drops focus to <body>.
  const el = opener
  opener = null
  requestAnimationFrame(() => {
    // Hand focus back to the opener — but the confirmed action may have disabled or
    // destroyed it (e.g. the action swaps its trigger for another control), and
    // focus() on a gone/disabled/inert element is a silent no-op that drops focus to
    // <body>. restoreFocus falls back to the page's <main> landmark when that happens, so a
    // keyboard user is not stranded at the top of the document (#786). It runs in this frame
    // (not synchronously at the top of onClose) for the re-enable reason above, and so that
    // once the #784 inert focus trap lands its release has already run — a fallback into a
    // still-inert page would be swallowed the same silent way.
    restoreFocus(el)
  })
}

watch(
  () => props.open,
  (open) => void (open ? onOpen() : onClose()),
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  // A watcher without `immediate` never fires for an instance rendered already-open — and
  // `immediate` is not an option here, because it would register the callback during SSR
  // where `document` does not exist. Neither call site mounts open today, but taking the
  // lock here keeps it balanced against the release below if one ever does.
  if (props.open) void onOpen()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  // Unmounting while open (a navigation away with the dialog still up) would
  // otherwise hold the lock forever. Guarded on `open` so a closed instance
  // never releases a lock it did not take.
  if (props.open) unlock()
  // Not guarded on `open`: releaseTrap() is already a no-op unless this instance holds a
  // trap, and leaving one held would inert the entire page permanently.
  releaseTrap()
})
</script>

<!-- Teleported to <body> so the fixed overlay escapes <main>'s z-index:1 stacking context —
     otherwise the footer (a later sibling of <main>, also z-index:1) paints over the
     dialog's action buttons (#561). -->
<template>
  <Teleport to="body">
    <div v-if="open" ref="overlay" class="confirm-overlay" @click.self="dismiss">
      <div ref="card" class="confirm-card" :role="role" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <h2 :id="titleId" class="confirm-title">{{ title }}</h2>
        <!-- Text only (no v-html): a message can carry a server error string. -->
        <p v-if="message" class="confirm-copy">{{ message }}</p>
        <slot />

        <div class="confirm-actions">
          <button class="btn btn-ghost confirm-cancel" type="button" :disabled="busy" @click="dismiss">
            {{ cancelText }}
          </button>
          <button
            class="btn btn-primary confirm-ok"
            :class="{ 'is-danger': danger }"
            type="button"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ busy && busyText ? busyText : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
