<script setup lang="ts">
import { APPS } from '~/data/apps'
import { FAQ } from '~/data/faq'

// Structured data (schema.org) so Google can render rich results — the org, the
// app (free, with a feature list), and the FAQ as expandable Q&As.
const DESC =
  'KimtOS turns every new browser tab into a private workspace — notes, PDFs, a whiteboard, ' +
  'voice-to-text, on-device AI and more. Everything runs in your browser; nothing is uploaded.'

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'KimtOS',
    logo: '/assets/icon128.png',
    description: DESC,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'KimtOS',
    applicationCategory: 'BrowserApplication',
    operatingSystem: 'Chrome',
    description: DESC,
    screenshot: '/assets/screenshot-newtab.png',
    featureList: APPS.map((a) => a.name),
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Every app is free — no account, no servers, open source (MIT).',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
]

useHead({
  script: jsonLd.map((o) => ({ type: 'application/ld+json', innerHTML: JSON.stringify(o) })),
})
</script>

<template>
  <main>
    <TheHero />
    <StatStrip />
    <AppGrid />
    <WhyOnDevice />
    <VerifyPrivacy />
    <AvailableOn />
    <FaqSection />
    <CtaBand />
  </main>
</template>
