<script setup lang="ts">
import { LEGAL, LEGAL_DRAFT, lastUpdated } from '~/data/legal'

defineProps<{ title: string; intro?: string }>()
</script>

<template>
  <main class="section legal">
    <!-- Loud on purpose: these pages are a draft until `published` is flipped in
         data/legal.ts, so they are not yet binding. Better a banner in everyone's
         face than a document that quietly claims to be in force before it is. -->
    <p v-if="LEGAL_DRAFT" class="legal-draft" role="alert">
      <strong>Draft — not yet in force.</strong> These pages are being finalised and are not yet legally binding.
    </p>

    <header class="legal-head">
      <h1>{{ title }}</h1>
      <p v-if="intro" class="legal-intro">{{ intro }}</p>
      <p class="legal-meta">Last updated {{ lastUpdated() }}</p>
    </header>

    <div class="legal-body">
      <slot />
    </div>

    <footer class="legal-foot">
      <p>
        Questions about this page? Open an issue on
        <a :href="LEGAL.contactUrl" rel="noopener">GitHub</a>. Kimtos is free and open source ({{ LEGAL.license }}) —
        <a :href="LEGAL.repoUrl" rel="noopener">read the source</a>.
      </p>
      <p class="legal-entity">{{ LEGAL.entity }} · {{ LEGAL.address }}</p>
    </footer>
  </main>
</template>
