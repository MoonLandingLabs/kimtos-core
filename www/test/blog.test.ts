// The blog pipeline (#1361). What is worth pinning here is not "markdown-it renders markdown" but
// the three things that would publish a wrong page quietly:
//
//   1. Frontmatter is STRICT. A misspelt key that parsed as nothing would publish a post with no
//      date, or with the file's name as its title, and it would look fine in review.
//   2. The file name and the frontmatter date must agree. The name orders the directory and the
//      frontmatter dates the page; when they disagree the listing order and the published date
//      disagree, which nobody notices until the blog is visibly out of order.
//   3. Every post is CRAWLABLE. The routes are derived from the posts (data/crawlable.mjs) rather
//      than hand-listed, because a hand-written list is what #366 was: a page list that had drifted
//      from what the site actually prerenders. A post that is live but not prerendered is a 404
//      on a static host.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CRAWLABLE, STATIC_PAGES } from '../data/crawlable.mjs'
import { POSTS } from '../data/blog'
import { frontmatter, slugOf, readingMinutes } from '../scripts/gen-blog.mjs'

const post = (over = '') => `---
title: A title
dek: A standfirst.
date: 2026-04-01
author: The KimtOS team
${over}---

Body text.
`

describe('frontmatter is strict, because a silently-ignored field publishes a wrong page', () => {
  test('a well-formed block parses, and the body is what follows it', () => {
    const { meta, body } = frontmatter(post(), 'a.md')
    assert.equal(meta.title, 'A title')
    assert.equal(meta.date, '2026-04-01')
    assert.equal(body.trim(), 'Body text.')
  })

  test('an unknown key is an error, not a field quietly dropped', () => {
    assert.throws(() => frontmatter(post('titel: typo\n'), 'a.md'), /unknown frontmatter key/)
  })

  test('a missing required key is an error', () => {
    const missing = post().replace(/^date: .*\n/m, '')
    assert.throws(() => frontmatter(missing, 'a.md'), /missing `date`/)
  })

  test('a date that is not an ISO day is an error', () => {
    assert.throws(() => frontmatter(post().replace('2026-04-01', '1 April 2026'), 'a.md'), /must be an ISO day/)
  })

  test('a file with no frontmatter at all is an error', () => {
    assert.throws(() => frontmatter('# Just a heading\n', 'a.md'), /no --- frontmatter block/)
  })
})

describe('file names', () => {
  test('the date prefix and the slug are read from the name', () => {
    assert.deepEqual(slugOf('2026-04-01-introducing-kimtos.md'), {
      datePrefix: '2026-04-01',
      slug: 'introducing-kimtos',
    })
  })

  test('a name that does not carry a date is an error', () => {
    assert.throws(() => slugOf('introducing-kimtos.md'), /YYYY-MM-DD-kebab-slug/)
  })
})

describe('reading time', () => {
  test('is never zero, however short the post', () => {
    assert.equal(readingMinutes('one word'), 1)
  })

  test('rounds to whole minutes', () => {
    assert.equal(readingMinutes(Array(400).fill('word').join(' ')), 2)
  })
})

describe('the published posts', () => {
  test('there are some, and each carries what a page and a feed need', () => {
    assert.ok(POSTS.length > 0, 'no posts were generated; run npm run gen:blog')
    for (const p of POSTS) {
      for (const key of ['slug', 'title', 'dek', 'date', 'author', 'html'] as const) {
        assert.ok(p[key], `post ${p.slug} has no ${key}`)
      }
      assert.ok(p.minutes >= 1, `post ${p.slug} has no reading time`)
    }
  })

  test('newest first — the listing order the page renders without re-sorting', () => {
    const dates = POSTS.map((p) => p.date)
    assert.deepEqual(dates, [...dates].sort().reverse())
  })

  test('slugs are unique, or one post would shadow another route', () => {
    assert.equal(new Set(POSTS.map((p) => p.slug)).size, POSTS.length)
  })

  test('EVERY post is prerendered, with no second edit', () => {
    // The regression this guards: adding a post and forgetting to list its route, so the page is
    // live and invisible to search. Derivation is what makes that impossible -- assert it.
    for (const p of POSTS) {
      assert.ok(CRAWLABLE.includes(`/blog/${p.slug}`), `/blog/${p.slug} is published but not crawlable`)
    }
    assert.ok(CRAWLABLE.includes('/blog'), 'the blog index itself is not crawlable')
  })

  test('the hand-written pages survived the derivation', () => {
    for (const page of STATIC_PAGES) assert.ok(CRAWLABLE.includes(page), `${page} was dropped`)
  })
})
