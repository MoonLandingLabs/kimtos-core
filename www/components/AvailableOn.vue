<script setup lang="ts">
import { DEFAULTS } from '@kimtos/config'
import { brandMarkSvg } from '@kimtos/icons'

// Kimtos Browser is Kimtos, so it carries the Kimtos logo (#1115) — the shared brand
// mark, not a bespoke browser icon. Full colour like the Chrome / Firefox logos it sits
// beside; inline SVG, so no image file (offline-first).
const browserMark = brandMarkSvg(22)
const { show } = useToast()

const browserSoon = (name: string) => show(`${name} support is coming soon — Kimtos is on Chrome today.`)

// The live Chrome entry links straight to the extension's Chrome Web Store listing —
// the ONE config fact (#1007), never a per-surface literal.
const storeUrl = DEFAULTS.chromeWebStoreUrl
</script>

<template>
  <section id="available" class="section">
    <div v-reveal class="sec-head">
      <h2>Free, for everyone.</h2>
      <p>Every app is free — no plan, no card, no account needed. Your data stays on your device, always.</p>
    </div>

    <div v-reveal class="avail">
      <span class="avail-label">Available on</span>
      <a class="avail-item is-live" :href="storeUrl" rel="noopener"
        ><img src="/assets/browsers/chrome.png" alt="" width="22" height="22" />Chrome</a
      >
      <button class="avail-item" type="button" @click="browserSoon('Firefox')">
        <img src="/assets/browsers/firefox.png" alt="" width="22" height="22" />Firefox <em>soon</em>
      </button>
      <button class="avail-item" type="button" @click="browserSoon('Edge')">
        <img src="/assets/browsers/edge.png" alt="" width="22" height="22" />Edge <em>soon</em>
      </button>
      <button class="avail-item" type="button" @click="browserSoon('Safari')">
        <img src="/assets/browsers/safari.png" alt="" width="22" height="22" />Safari <em>soon</em>
      </button>
      <!-- The destination, not a third-party browser we run on: our own browser with the
           tools built in (#1115). It links to the Vision page rather than firing a
           'coming soon' toast — the browser is direction, not a dated promise. The mark
           is our own full-colour roundel (browserMarkSvg), so it reads as a real browser
           brand beside Chrome/Firefox rather than a generic window outline. -->
      <NuxtLink class="avail-item is-vision" to="/vision">
        <span class="avail-mark" aria-hidden="true" v-html="browserMark" />
        Kimtos Browser <em>vision</em>
      </NuxtLink>
    </div>
  </section>
</template>
