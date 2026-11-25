<script setup lang="ts">
import { brandMarkSvg } from '@kimtos/icons'
import { DEFAULTS } from '@kimtos/config'
import { REPO_URL } from '~/data/site'

const stuck = ref(false)
const menuOpen = ref(false)
const brandMark = brandMarkSvg(28)

// Close the mobile menu on any navigation — the links are same-page hashes, so
// watch the full path (hash included), not just the route name.
const route = useRoute()
watch(
  () => route.fullPath,
  () => (menuOpen.value = false),
)

onMounted(() => {
  const onScroll = () => (stuck.value = window.scrollY > 10)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') menuOpen.value = false
  }
  window.addEventListener('keydown', onKey)
  onUnmounted(() => window.removeEventListener('keydown', onKey))
})
</script>

<template>
  <header id="nav" class="nav" :class="{ 'is-stuck': stuck, 'is-menu-open': menuOpen }">
    <!-- Root-relative, not bare `#apps`: the nav is on every page now, and those
         sections only exist on the home page. A bare hash would leave the whole nav
         inert everywhere except `/` (#159). `/#top` rather than `/` for the brand:
         the body carries id="top" (nuxt.config bodyAttrs), so this still scrolls to
         the top when you are already home, which a bare `/` would not.

         Note vue-router ignores the hash when it computes the active state, so on `/`
         all four of these carry `router-link-active` at once. Nothing styles that
         class today, which is why it is invisible — do not add a rule for it
         expecting per-section highlighting, because you will light up all four. -->
    <NuxtLink class="brand" to="/#top" aria-label="KimtOS">
      <span class="brand-logo" v-html="brandMark" />
      <span class="brand-name">KimtOS</span>
    </NuxtLink>
    <nav class="nav-links" aria-label="Primary">
      <NuxtLink to="/#apps">Apps</NuxtLink>
      <NuxtLink to="/#private">Why on-device</NuxtLink>
      <NuxtLink to="/#faq">FAQ</NuxtLink>
      <a :href="DEFAULTS.docsUrl">Docs</a>
    </nav>
    <div class="nav-actions">
      <a class="text-link nav-desktop-only" :href="REPO_URL" rel="noopener">Open source</a>
      <!-- Burger — mobile only. Below 720px `.nav-links` and the desktop auth
           actions are hidden; this button reveals them (plus the theme toggle) in a
           dropdown, so the whole nav is reachable on a phone (#851). -->
      <button
        type="button"
        class="nav-burger"
        :aria-expanded="menuOpen"
        aria-controls="nav-menu"
        aria-label="Menu"
        @click="menuOpen = !menuOpen"
      >
        <span class="nav-burger-bars" :class="{ 'is-x': menuOpen }" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
    </div>
    <!-- Mobile dropdown. Holds the primary links and the source link — everything the
         desktop bar shows inline. The colour-theme switcher moved to the footer (its
         conventional home) for every viewport, so it is no longer duplicated here. -->
    <div id="nav-menu" class="nav-menu" :hidden="!menuOpen">
      <nav class="nav-menu-links" aria-label="Primary (mobile)">
        <NuxtLink to="/#apps">Apps</NuxtLink>
        <NuxtLink to="/#private">Why on-device</NuxtLink>
        <NuxtLink to="/#faq">FAQ</NuxtLink>
        <a :href="DEFAULTS.docsUrl">Docs</a>
      </nav>
      <div class="nav-menu-foot">
        <a class="text-link" :href="REPO_URL" rel="noopener">Open source (MIT)</a>
      </div>
    </div>
  </header>
</template>
