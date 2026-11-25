<script setup lang="ts">
import { APP_STATS } from '~/data/apps'
</script>

<template>
  <section v-reveal class="stats" aria-label="At a glance">
    <div>
      <b>{{ APP_STATS.total }}</b><span>tools in one tab</span>
    </div>
    <div><b>0</b><span>servers your data touches</span></div>
    <div><b>0</b><span>trackers or ads</span></div>
    <div><b>100%</b><span>runs on your device</span></div>
  </section>
</template>
