<script setup lang="ts">
import { DEFAULTS } from '@kimtos/config'
import { REPO_URL } from '~/data/site'
const storeUrl = DEFAULTS.chromeWebStoreUrl
</script>

<template>
  <section v-reveal class="cta-band">
    <h2>Take back your new tab.</h2>
    <p>
      Every tool, on your device. Free and open source under the MIT licence — no card, no account, no servers, no
      catch.
    </p>
    <a class="btn btn-primary btn-lg" :href="storeUrl" rel="noopener">Add to Chrome</a>
    <a class="btn btn-ghost btn-lg" :href="REPO_URL" rel="noopener">View the source on GitHub</a>
  </section>
</template>
