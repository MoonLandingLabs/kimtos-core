<script setup lang="ts">
import { postBySlug } from '~/data/blog'

const route = useRoute()
const post = postBySlug(String(route.params.slug))

// Every /blog/<slug> route is prerendered from the same generated list the page reads
// (data/crawlable.mjs -> POST_SLUGS), so a miss here means someone typed a URL, not that a post
// failed to build. A 404 is the honest answer; rendering an empty article is not.
if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })

// The site hard-codes no origin, so the social image is a site-relative path.
const image = post.ogImage ?? '/assets/screenshot-newtab.png'

const published = new Date(`${post.date}T00:00:00Z`)
const fmt = published.toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

useSeoMeta({
  title: `${post.title} · Kimtos`,
  description: post.dek,
  ogType: 'article',
  ogTitle: post.title,
  ogDescription: post.dek,
  ogImage: image,
  twitterTitle: post.title,
  twitterDescription: post.dek,
  twitterImage: image,
  articlePublishedTime: published.toISOString(),
})

// JSON-LD is what earns the dated result with an author in search; the meta tags above do not.
// Built from the SAME post record rather than restated, so a corrected date cannot end up right
// on the page and wrong in the structured data.
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.dek,
        datePublished: published.toISOString(),
        dateModified: published.toISOString(),
        author: { '@type': 'Organization', name: post.author },
        publisher: { '@type': 'Organization', name: 'Kimtos' },
        image,
      }),
    },
  ],
})
</script>

<template>
  <main class="article">
    <NuxtLink to="/blog" class="back">Blog</NuxtLink>
    <header class="article-head">
      <p class="article-meta">
        <time :datetime="post.date">{{ fmt }}</time>
        <span aria-hidden="true">·</span>
        <span>{{ post.minutes }} min read</span>
      </p>
      <h1>{{ post.title }}</h1>
      <p class="article-dek">{{ post.dek }}</p>
    </header>
    <!-- eslint-disable-next-line vue/no-v-html -- rendered at build time by scripts/gen-blog.mjs
         from markdown we author and commit; markdown-it runs with html:false, so a post cannot
         introduce raw markup and there is no user input anywhere on this path. -->
    <div class="prose" v-html="post.html" />
    <footer class="article-foot">
      <NuxtLink to="/blog">More from the blog</NuxtLink>
    </footer>
  </main>
</template>

<style scoped>
/* Clears the fixed nav. */
.article {
  max-width: 44rem;
  margin: 0 auto;
  padding: calc(var(--nav-h) + 2rem) 1.25rem 6rem;
}
.back {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
  text-decoration: none;
}
.back:hover {
  color: var(--text);
}
.article-head {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.75rem 0 2.25rem;
  border-bottom: 1px solid var(--line);
}
.article-head h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 2.75rem);
  line-height: 1.15;
  letter-spacing: -0.025em;
  text-wrap: balance;
}
.article-meta {
  margin: 0;
  display: flex;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-2);
}
.article-dek {
  margin: 0;
  color: var(--text-2);
  font-size: 1.1rem;
  line-height: 1.6;
}

/* The body is generated HTML, so these are element selectors rather than classes. */
.prose {
  padding-top: 2rem;
  font-size: 1.05rem;
  line-height: 1.75;
}
.prose :deep(h2) {
  margin: 2.75rem 0 0.85rem;
  font-size: 1.5rem;
  letter-spacing: -0.015em;
  line-height: 1.3;
  text-wrap: balance;
}
.prose :deep(h3) {
  margin: 2rem 0 0.6rem;
  font-size: 1.2rem;
}
.prose :deep(p) {
  margin: 0 0 1.15rem;
}
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0 0 1.15rem;
  padding-left: 1.35rem;
}
.prose :deep(li) {
  margin-bottom: 0.4rem;
}
.prose :deep(a) {
  color: var(--accent);
}
.prose :deep(strong) {
  color: var(--text);
}
.prose :deep(blockquote) {
  margin: 1.5rem 0;
  padding: 0.25rem 0 0.25rem 1.25rem;
  border-left: 2px solid var(--accent);
  color: var(--text-2);
  font-style: italic;
}
.prose :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--bg-2);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.prose :deep(pre) {
  overflow-x: auto;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem 1.15rem;
  margin: 0 0 1.15rem;
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
}
.prose :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 2.5rem 0;
}

.article-foot {
  display: flex;
  gap: 1.5rem;
  margin-top: 3.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--line);
  font-size: 0.9rem;
}
.article-foot a {
  color: var(--text-2);
  text-decoration: none;
}
.article-foot a:hover {
  color: var(--text);
}
</style>
