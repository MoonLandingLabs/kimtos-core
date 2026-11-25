// The site's crawlable pages — THE single source of truth (#366). A path listed
// here is prerendered by Nuxt (nuxt.config.ts builds its `prerender: true` rules
// from this list) — one edit, no drift.
// The site is fully static: every page is prerendered, there are no app routes.
//
// The blog routes are DERIVED, not listed (#1361). A hand-written array is fine for a fixed set
// of pages and wrong the moment a route appears per article: every new post would need a second
// edit here that nobody would remember, which is exactly the drift #366 records. `POST_SLUGS` is
// generated from www/content/blog/*.md by scripts/gen-blog.mjs, which the same predev/prebuild/
// pregenerate hooks run before this file is ever read.
import { POST_SLUGS } from './blog-index.mjs'

/** Hand-written pages. A new fixed page goes here. */
export const STATIC_PAGES = ['/', '/vision', '/privacy', '/terms']

export const CRAWLABLE = [...STATIC_PAGES, '/blog', ...POST_SLUGS.map((slug) => `/blog/${slug}`)]
