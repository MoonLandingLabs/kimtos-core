<script setup lang="ts">
import { POSTS } from '~/data/blog'

// The list is the generated snapshot, newest first — see scripts/gen-blog.mjs. Nothing is
// fetched and nothing is sorted here: a page that re-sorts its own data is a second ordering.
const posts = POSTS

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

useHead({
  title: 'Blog · Kimtos',
  meta: [
    {
      name: 'description',
      content:
        'Notes on building a private, local-first workspace — what we shipped, what we measured, ' +
        'and what the measurements changed.',
    },
  ],
})
</script>

<template>
  <main class="blog-index">
    <header class="blog-head">
      <h1>Blog</h1>
      <p class="blog-lede">
        Notes on building a private, local-first workspace — what we shipped, what we measured, and what the
        measurements changed.
      </p>
    </header>

    <ol class="post-list">
      <li v-for="post in posts" :key="post.slug" class="post-row">
        <NuxtLink :to="`/blog/${post.slug}`" class="post-link">
          <p class="post-meta">
            <time :datetime="post.date">{{ fmt(post.date) }}</time>
            <span aria-hidden="true">·</span>
            <span>{{ post.minutes }} min read</span>
          </p>
          <h2 class="post-title">{{ post.title }}</h2>
          <p class="post-dek">{{ post.dek }}</p>
        </NuxtLink>
      </li>
    </ol>
  </main>
</template>

<style scoped>
/* The nav is fixed, so a page in normal flow starts underneath it. Same offset the other pages use. */
.blog-index {
  max-width: var(--maxw);
  margin: 0 auto;
  padding: calc(var(--nav-h) + 3.5rem) 1.25rem 6rem;
}
.blog-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  padding-bottom: 2.5rem;
  border-bottom: 1px solid var(--line);
}
.blog-head h1 {
  margin: 0;
  font-size: clamp(2.25rem, 5vw, 3rem);
  letter-spacing: -0.02em;
}
.blog-lede {
  margin: 0;
  max-width: 60ch;
  color: var(--text-2);
  font-size: 1.05rem;
  line-height: 1.65;
}

.post-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.post-row + .post-row {
  border-top: 1px solid var(--line);
}
.post-link {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 2.25rem 0;
  text-decoration: none;
  color: inherit;
}
.post-link:hover .post-title {
  color: var(--accent);
}
.post-meta {
  margin: 0;
  display: flex;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-2);
}
.post-title {
  margin: 0;
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  letter-spacing: -0.015em;
  line-height: 1.25;
  text-wrap: balance;
}
.post-dek {
  margin: 0;
  max-width: 62ch;
  color: var(--text-2);
  line-height: 1.65;
}
</style>
