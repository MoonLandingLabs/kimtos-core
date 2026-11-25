<script setup lang="ts">
// The docs site's footer. Rendered from the `layout-bottom` slot (theme/index.ts) rather
// than VitePress's own `themeConfig.footer`, because that one only renders on pages
// WITHOUT a sidebar — which is almost none of a docs site. This renders everywhere.
//
// It carries the outbound links (the ones that leave the docs: the source, the issue tracker,
// the licence and the privacy policy source), all on the public GitHub repository. The docs
// site hard-codes no host of its own.
import { useData } from 'vitepress';

declare const __REPO_URL__: string;
declare const __ISSUES_URL__: string;

const repoUrl = __REPO_URL__;
const issuesUrl = __ISSUES_URL__;
const year = new Date().getFullYear();

// The light/dark switch lives in the footer here too, matching www. VitePress's `isDark`
// is a writable ref (its own nav switch just flips it), so toggling it is the supported
// way to drive appearance — no class or storage hacks, no desync. The default nav switch
// is hidden in custom.css so there is one control, in the footer, on both sites.
const { isDark } = useData();
const svg = (p: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const SUN = svg(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
);
const MOON = svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
</script>

<template>
  <footer class="kimtos-docs-footer">
    <div class="kdf-grid">
      <nav aria-label="Documentation">
        <h2>Documentation</h2>
        <a href="/guides/install">Guides</a>
        <a href="/apps/">Apps</a>
      </nav>
      <nav aria-label="Product">
        <h2>Product</h2>
        <a :href="repoUrl">Open source (MIT)</a>
      </nav>
      <nav aria-label="Legal">
        <h2>Legal</h2>
        <a :href="`${repoUrl}/blob/main/www/pages/privacy.vue`">Privacy policy</a>
        <a :href="`${repoUrl}/blob/main/LICENSE`">MIT licence</a>
      </nav>
      <nav aria-label="Help">
        <h2>Help</h2>
        <a :href="issuesUrl">Report an issue</a>
        <a href="/guides/troubleshooting">Troubleshooting</a>
      </nav>
    </div>
    <div class="kdf-base">
      <span>&copy; {{ year }} KimtOS &middot; Free and open source, MIT licensed</span>
      <div class="kdf-theme">
        <span class="kdf-theme-label">Theme</span>
        <button
          type="button"
          class="ts-switch is-ready"
          :class="{ 'is-dark': isDark }"
          role="switch"
          :aria-checked="isDark"
          aria-label="Dark theme"
          title="Switch between light and dark"
          @click="isDark = !isDark"
        >
          <span class="ts-ico ts-sun" v-html="SUN" />
          <span class="ts-ico ts-moon" v-html="MOON" />
          <span class="ts-knob" aria-hidden="true" />
        </button>
      </div>
    </div>
  </footer>
</template>
