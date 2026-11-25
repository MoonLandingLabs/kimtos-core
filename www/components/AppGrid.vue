<script setup lang="ts">
import { appTileGradient, appGlyphSvg } from '@kimtos/icons'
import { isNewApp } from '@kimtos/config'
import { APPS, APP_WORDS, type MarketingApp } from '~/data/apps'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Feature a handful up-front; the rest stay behind a "+N more" card that
// expands the grid in place (no navigation).
const featured = APPS.filter((a) => a.featured)
const rest = APPS.filter((a) => !a.featured)
const ordered = [...featured, ...rest]

const expanded = ref(false)
const visible = computed(() => (expanded.value ? ordered : featured))

// A few glyph previews stacked on the "+N more" card.
const peek = rest.slice(0, 5)

// The "New" badge is decided from the app's first-release date (its oldest CHANGELOG entry,
// #1114). The site is PRERENDERED, so a build-time decision would freeze the badge and let it
// linger past its 30 days until the next deploy. We re-check on the client.
//
// `clock` must be IDENTICAL on the server and on the first client render, or hydration warns
// about a mismatched badge. useState captures the prerender-time value into the page payload,
// and the client reuses that serialized value verbatim (the initializer does not re-run) — so
// hydration reproduces exactly the badges the prerender emitted. onMounted then advances the
// clock to the real current time, which can only REMOVE a badge whose 30 days have elapsed
// since the deploy, never add one. The rule itself is @kimtos/config's, shared with the
// extension and docs so all three agree on what "new" means.
const clock = useState('appgrid-clock', () => Date.now())
onMounted(() => {
  clock.value = Date.now()
})
const isNew = (a: MarketingApp) => isNewApp(a.firstReleased, new Date(clock.value))
</script>

<template>
  <section id="apps" class="section">
    <div v-reveal class="sec-head">
      <h2>{{ cap(APP_WORDS.total) }} tools. One tab.</h2>
      <p>
        Each opens in a draggable window from the dock. Every one is free, forever — including everything powered by an
        on-device AI model.
      </p>
    </div>
    <div class="app-grid">
      <article
        v-for="a in visible"
        :key="a.id"
        v-reveal
        class="app-card"
        :style="{ '--c': a.c }"
        tabindex="0"
        :aria-label="a.name"
      >
        <div class="flip">
          <div class="face face-front">
            <div class="app-head">
              <span class="app-ic" :style="{ background: appTileGradient(a.c) }" v-html="appGlyphSvg(a.id)" />
              <h3>{{ a.name }}</h3>
              <span v-if="isNew(a)" class="app-badge is-new">New</span>
            </div>
            <p>{{ a.desc }}</p>
            <span class="app-tech">{{ a.tech }}</span>
          </div>
          <div class="face face-back">
            <div class="app-head">
              <span class="app-ic" :style="{ background: appTileGradient(a.c) }" v-html="appGlyphSvg(a.id)" />
              <h3>{{ a.name }}</h3>
              <span v-if="isNew(a)" class="app-badge is-new">New</span>
            </div>
            <ul class="back-points">
              <li v-for="p in a.points" :key="p">{{ p }}</li>
            </ul>
            <span class="app-tech">{{ a.tech }}</span>
          </div>
        </div>
      </article>

      <!-- Expand / collapse card -->
      <button
        v-if="!expanded"
        v-reveal
        type="button"
        class="app-more"
        :aria-expanded="false"
        aria-controls="apps"
        @click="expanded = true"
      >
        <span class="more-tiles" aria-hidden="true">
          <span
            v-for="a in peek"
            :key="a.id"
            class="app-ic"
            :style="{ background: appTileGradient(a.c) }"
            v-html="appGlyphSvg(a.id)"
          />
        </span>
        <span class="more-n">+{{ rest.length }}</span>
        <span class="more-label">more apps</span>
        <span class="more-cta"
          >See them all
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <button
        v-else
        type="button"
        class="app-more is-less"
        :aria-expanded="true"
        aria-controls="apps"
        @click="expanded = false"
      >
        <span class="more-cta"
          >Show less
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </span>
      </button>
    </div>
  </section>
</template>
