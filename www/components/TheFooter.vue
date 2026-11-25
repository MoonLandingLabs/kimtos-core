<script setup lang="ts">
import { DEFAULTS } from '@kimtos/config'
import { APP_WORDS } from '~/data/apps'
import { ISSUES_URL, LICENSE_NAME, LICENSE_URL, REPO_URL } from '~/data/site'
const year = new Date().getFullYear()
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
</script>

<template>
  <footer class="footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <span class="fb-row">
          <img src="/assets/icon128.png" alt="" width="28" height="28" />
          <span class="brand-name">KimtOS</span>
        </span>
        <p>The private new-tab workspace. {{ cap(APP_WORDS.total) }} tools, zero servers. Free and open source.</p>
      </div>
      <!-- Root-relative, not bare `#apps`: the footer is on every page now, and those
           sections only exist on the home page (#159). -->
      <nav aria-label="Product">
        <h4>Product</h4>
        <a :href="DEFAULTS.chromeWebStoreUrl" rel="noopener">Add to Chrome</a>
        <NuxtLink to="/#apps">Apps</NuxtLink>
        <NuxtLink to="/#private">Why on-device</NuxtLink>
        <NuxtLink to="/#faq">FAQ</NuxtLink>
        <a :href="DEFAULTS.docsUrl">Docs</a>
      </nav>
      <nav aria-label="Company">
        <h4>Company</h4>
        <NuxtLink to="/#top">About</NuxtLink>
        <NuxtLink to="/vision">Vision</NuxtLink>
        <NuxtLink to="/blog">Blog</NuxtLink>
        <!-- KimtOS v1 is open source. There is no support desk or chat: GitHub issues are the channel. -->
        <a :href="REPO_URL" rel="noopener">Open source</a>
        <a :href="ISSUES_URL" rel="noopener">Report an issue</a>
      </nav>
      <nav aria-label="Legal">
        <h4>Legal</h4>
        <NuxtLink to="/privacy">Privacy</NuxtLink>
        <NuxtLink to="/privacy#cookies">Local storage</NuxtLink>
        <NuxtLink to="/terms">Terms</NuxtLink>
        <a :href="LICENSE_URL" rel="noopener">{{ LICENSE_NAME }} licence</a>
      </nav>
    </div>
    <div class="footer-base">
      <span
        >© <span>{{ year }}</span> KimtOS · Free and open source, {{ LICENSE_NAME }} licensed</span
      >
      <!-- The colour-theme switcher lives here, not in the nav: it is a set-once
           preference, not a primary action, so the footer is its conventional home and
           the top bar stays for navigation. One instance for every viewport — it used to
           be duplicated in the desktop nav and the mobile menu. -->
      <div class="footer-theme">
        <span class="footer-theme-label">Theme</span>
        <ThemeToggle />
      </div>
    </div>
  </footer>
</template>
