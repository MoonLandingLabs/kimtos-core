<script setup lang="ts">
const { message, visible } = useToast()
</script>

<template>
  <!-- Text only (no v-html): messages can carry server error strings, so never
       render them as HTML. Enforced by test/escaping.test.ts (source scan) and
       test/dialog.component.test.ts (mounted render), not just by this comment (#759). -->
  <div class="toast" :class="{ 'is-show': visible }" role="status" aria-live="polite">
    {{ message }}
  </div>
</template>
