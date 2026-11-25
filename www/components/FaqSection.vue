<script setup lang="ts">
import { FAQ } from '~/data/faq'
</script>

<template>
  <section id="faq" class="section band">
    <div v-reveal class="sec-head">
      <h2>Questions, answered.</h2>
    </div>
    <div v-reveal class="faq">
      <details v-for="item in FAQ" :key="item.q">
        <summary>{{ item.q }}</summary>
        <p>{{ item.a }}</p>
      </details>
    </div>
  </section>
</template>
