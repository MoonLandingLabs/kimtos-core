<script setup lang="ts">
const { mode, setTheme } = useTheme()

// The choice lives in localStorage (client-only) and the page is prerendered, so the
// server can't know it. Gate on mount: server and first client render agree (neutral),
// then the real state settles — no hydration mismatch, no flash.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

const isDark = computed(() => mode.value === 'dark')
const toggle = () => setTheme(isDark.value ? 'light' : 'dark')

const svg = (p: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
const SUN = svg(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
)
const MOON = svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>')
</script>

<template>
  <!-- A light/dark switch in the Kimtos app's own control style (extension `.switch`):
       a pill track, a sliding knob, sun and moon at the ends. role="switch" so a screen
       reader announces on/off; it is a <button>, so Space/Enter toggle for free. -->
  <button
    type="button"
    class="ts-switch"
    :class="{ 'is-dark': mounted && isDark, 'is-ready': mounted }"
    role="switch"
    :aria-checked="mounted && isDark"
    aria-label="Dark theme"
    title="Switch between light and dark"
    @click="toggle"
  >
    <span class="ts-ico ts-sun" v-html="SUN" />
    <span class="ts-ico ts-moon" v-html="MOON" />
    <span class="ts-knob" aria-hidden="true" />
  </button>
</template>
