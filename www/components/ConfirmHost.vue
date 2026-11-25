<script setup lang="ts">
// Mounted once in app.vue, beside ToastHost. Renders whatever `useConfirm().confirm()`
// asked for; the dialog itself lives in ConfirmDialog so a flow with its own dialog content can
// render the same component directly with a richer body.
const { current, answer } = useConfirm()
const route = useRoute()

// Navigating away answers "no". This host never unmounts, so without it a dialog opened on
// a page survives the browser Back button and stays painted over the next page — and
// confirming it would still run the caller's action, from a page the user has left, behind
// a title that no longer matches what is on screen. The native confirm() this replaced
// blocked the main thread, so Back was not reachable while it was up.
//
// Watches `path`, not `fullPath`: a query-only change is not a navigation the user made.
watch(
  () => route.path,
  () => answer(false),
)
</script>

<template>
  <ConfirmDialog
    :open="!!current"
    :title="current?.title ?? ''"
    :message="current?.message"
    :confirm-text="current?.confirmText"
    :cancel-text="current?.cancelText"
    :danger="current?.danger"
    :opener="current?.opener"
    @confirm="answer(true)"
    @cancel="answer(false)"
  />
</template>
