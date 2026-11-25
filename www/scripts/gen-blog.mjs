// Generates www/data/blog.ts and www/data/blog-index.mjs from the
// markdown in www/content/blog/ (#1361).
//
// The same shape as gen-apps.mjs: a source of truth that is NOT a Vue file, compiled to a typed
// data module at build time and committed, so the site stays statically generated and the pages
// stay dumb. Runs from the predev/prebuild/pregenerate/pretypecheck hooks beside gen-apps.mjs.
//
//   node scripts/gen-blog.mjs
//
// TWO OUTPUTS, ONE DERIVATION, and the second one is the point. `data/blog.ts` is TypeScript and
// is read by the pages through Vite. `nuxt.config.ts` and `data/crawlable.mjs` are loaded by
// Node, which cannot import TypeScript — so the slug list is emitted a second time as plain
// `.mjs`. Both come out of this one walk of the directory, because the alternative is
// crawlable.mjs re-deriving slugs from filenames itself, and a second derivation of the same fact
// is precisely what #366 was: a list of public pages that had drifted from what the site actually prerenders.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import MarkdownIt from 'markdown-it'
import { format, resolveConfig } from 'prettier'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTENT = join(HERE, '..', 'content', 'blog')
const OUT_TS = join(HERE, '..', 'data', 'blog.ts')
const OUT_MJS = join(HERE, '..', 'data', 'blog-index.mjs')

/** Frontmatter keys we understand. Anything else is an error -- see `frontmatter`. */
const REQUIRED = ['title', 'dek', 'date', 'author']
const OPTIONAL = ['ogImage']

/**
 * Parse the `---` block at the top of a post.
 *
 * Deliberately NOT a YAML parser and deliberately strict: every key must be one we know, every
 * required key must be present, and the date must be a real ISO day. A frontmatter field that is
 * silently ignored is a post that publishes with no date or the wrong title, and finds out on the
 * live site. Failing the build is the cheaper end of that trade.
 *
 * @param {string} src the file contents
 * @param {string} file the filename, for the error message
 * @returns {{ meta: Record<string, string>, body: string }}
 */
export function frontmatter(src, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!match) throw new Error(`${file}: no --- frontmatter block at the top of the file`)
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const pair = /^([a-zA-Z][\w]*):\s*(.+?)\s*$/.exec(line)
    if (!pair) throw new Error(`${file}: frontmatter line is not \`key: value\`: ${line}`)
    const [, key, raw] = pair
    if (![...REQUIRED, ...OPTIONAL].includes(key)) {
      throw new Error(`${file}: unknown frontmatter key \`${key}\``)
    }
    if (key in meta) throw new Error(`${file}: frontmatter key \`${key}\` appears twice`)
    meta[key] = raw.replace(/^['"]|['"]$/g, '')
  }
  for (const key of REQUIRED) {
    if (!meta[key]) throw new Error(`${file}: frontmatter is missing \`${key}\``)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date) || Number.isNaN(Date.parse(meta.date))) {
    throw new Error(`${file}: \`date\` must be an ISO day (YYYY-MM-DD), not \`${meta.date}\``)
  }
  return { meta, body: src.slice(match[0].length) }
}

/** `2026-04-01-hello.md` -> `hello`. The date lives in the frontmatter; the file name orders it. */
export function slugOf(file) {
  const match = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$/.exec(file)
  if (!match) throw new Error(`${file}: name a post \`YYYY-MM-DD-kebab-slug.md\``)
  return { datePrefix: match[1], slug: match[2] }
}

/** Whole minutes at 200 words a minute, never zero. */
export const readingMinutes = (body) => Math.max(1, Math.round(body.split(/\s+/).length / 200))

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

/** Read every post, newest first. */
export function collectPosts(dir = CONTENT) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  const posts = files.map((file) => {
    const { datePrefix, slug } = slugOf(file)
    const { meta, body } = frontmatter(readFileSync(join(dir, file), 'utf8'), file)
    if (meta.date !== datePrefix) {
      // The file name orders the directory and the frontmatter dates the page. If they disagree
      // the listing order and the published date disagree, which is invisible until someone
      // notices the blog is out of order.
      throw new Error(`${file}: the name says ${datePrefix} and the frontmatter says ${meta.date}`)
    }
    return {
      slug,
      title: meta.title,
      dek: meta.dek,
      date: meta.date,
      author: meta.author,
      ...(meta.ogImage ? { ogImage: meta.ogImage } : {}),
      minutes: readingMinutes(body),
      html: md.render(body),
    }
  })
  return posts.reverse()
}

// Only when RUN, never when imported: the tests import the parsing and rendering above, and a
// module that writes three files as a side effect of being imported cannot be tested without
// writing them.
async function main() {
  const posts = collectPosts()

  const ts =
    `// GENERATED by scripts/gen-blog.mjs from www/content/blog/*.md — DO NOT EDIT.\n` +
    `// Add or change a markdown file, then re-run \`npm run gen:blog\` (auto-runs on dev/build).\n` +
    `\n` +
    `export interface Post {\n` +
    `  slug: string\n` +
    `  title: string\n` +
    `  /** The standfirst under the title — also the meta description. */\n` +
    `  dek: string\n` +
    `  /** ISO day. */\n` +
    `  date: string\n` +
    `  author: string\n` +
    `  /** Absolute or site-relative social image; the site default is used when absent. */\n` +
    `  ogImage?: string\n` +
    `  /** Reading time in whole minutes. */\n` +
    `  minutes: number\n` +
    `  /** The body, already rendered to HTML at build time. */\n` +
    `  html: string\n` +
    `}\n` +
    `\n` +
    `export const POSTS: Post[] = ${JSON.stringify(posts, null, 2)}\n` +
    `\n` +
    `export const postBySlug = (slug: string): Post | undefined =>\n` +
    `  POSTS.find((p) => p.slug === slug)\n`

  const mjs =
    `// GENERATED by scripts/gen-blog.mjs — DO NOT EDIT.\n` +
    `// The slugs only, as plain JS: nuxt.config.ts and data/crawlable.mjs are loaded by Node,\n` +
    `// which cannot import data/blog.ts. Same walk, same order — see the generator's header.\n` +
    `export const POST_SLUGS = ${JSON.stringify(posts.map((p) => p.slug))}\n`

  const prettierConfig = await resolveConfig(OUT_TS)
  writeFileSync(OUT_TS, await format(ts, { ...prettierConfig, filepath: OUT_TS }))
  writeFileSync(OUT_MJS, await format(mjs, { ...prettierConfig, filepath: OUT_MJS }))

  console.log(`gen-blog: ${posts.length} post(s) → data/blog.ts, data/blog-index.mjs`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
