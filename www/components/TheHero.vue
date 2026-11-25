<script setup lang="ts">
import { DEFAULTS } from '@kimtos/config'
import { APP_WORDS } from '~/data/apps'
import { REPO_URL } from '~/data/site'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// The extension's Chrome Web Store listing — the ONE config fact (#1007), never a
// per-surface literal. The primary hero action is installing the product (#1008).
const storeUrl = DEFAULTS.chromeWebStoreUrl
</script>

<template>
  <section class="hero">
    <p class="kicker">A private workspace on every new&nbsp;tab</p>
    <h1>
      Your new tab,
      <span class="hl">actually useful.</span>
    </h1>
    <p class="lede">
      {{ cap(APP_WORDS.total) }} focused tools — notes, PDFs, a whiteboard, voice-to-text, on-device AI and more — the
      moment you open a tab. Everything runs in your browser, so nothing you write, say, or scan ever leaves your
      machine.
    </p>
    <div class="hero-cta">
      <!-- Inline line-art Chrome mark (no image files — offline-safe, theme-aware via
           currentColor, matching the app-glyph stroke conventions). -->
      <a class="btn btn-primary btn-lg" :href="storeUrl" rel="noopener">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <path d="M21.17 8H12M3.95 6.06 8.54 14M10.88 21.94 15.46 14" />
        </svg>
        Add to Chrome
      </a>
      <a class="btn btn-ghost btn-lg" :href="REPO_URL" rel="noopener">View the source</a>
      <a class="btn btn-ghost btn-lg" href="#apps">See the apps</a>
    </div>
    <p class="hero-micro">Free and open source (MIT) · No account, no servers · Works in Chrome</p>

    <figure class="shot">
      <div class="shot-frame">
        <div class="shot-bar">
          <span class="dots"><i /><i /><i /></span>
          <span class="urlbar">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            New&nbsp;Tab
          </span>
          <span class="bar-spacer" />
        </div>
        <img
          class="shot-img shot-dark"
          src="/assets/screenshot-newtab.png"
          alt="A Kimtos new tab: a large clock, a search bar, and a dock of app icons over a dark wallpaper."
          loading="lazy"
        />
        <img
          class="shot-img shot-light"
          src="/assets/screenshot-newtab-light.png"
          alt="A Kimtos new tab: a large clock, a search bar, and a dock of app icons over a light wallpaper."
          loading="lazy"
        />
      </div>
      <figcaption>An actual new tab. The dock holds every tool — one click away.</figcaption>
    </figure>
  </section>
</template>

<style scoped>
/* The hero screenshot tracks the site theme: the light-wallpaper shot by default,
   the dark one once the user flips to dark. The prerendered default (no
   data-theme) shows the LIGHT shot, matching the site's default (#1217) — it used
   to show the dark one, which would now put a dark product screenshot on a light
   page for anyone the inline head script never reaches. That script sets
   data-theme before first paint, so there's no flash either way. */
.shot-dark {
  display: none;
}
:root[data-theme='dark'] .shot-light {
  display: none;
}
:root[data-theme='dark'] .shot-dark {
  display: block;
}
</style>
