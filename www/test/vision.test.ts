// The Vision page (#1115) has to satisfy three structural promises that a screenshot
// cannot, so they are pinned here:
//
//   1. It is a real, crawlable page — listed in data/crawlable.mjs, which is the ONE
//      source the prerender rules read (#366). A page nobody links
//      into the crawl and never prerenders is a 404 to a search engine.
//   2. It is reachable from the site chrome — the footer's Company column links to it.
//   3. Its MCP / intelligence copy is written in the future tense, so check-agent-claims
//      stays green. That guard runs over all of www/**; this asserts the specific page at
//      the centre of the risk, using the guard's OWN exported judgement so the two cannot
//      disagree.
//
// It also guards the rename half of the change: the retired "desktop app" copy must be
// gone from the marketing surfaces, or the roadmap would tell two stories at once.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// The checker exports its judgement precisely so tests exercise what CI runs, not a copy.
import { flags, sentences } from '../../scripts/check-agent-claims.mjs'
import { CRAWLABLE } from '../data/crawlable.mjs'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('Vision page is a first-class public page (#1115)', () => {
  test('/vision is crawlable — prerendered', () => {
    // The prerender rules derive from this one list, so membership here is the whole guarantee.
    assert.ok(CRAWLABLE.includes('/vision'), '/vision must be in data/crawlable.mjs')
  })

  test('the page source exists and states its thesis', () => {
    const page = read('../pages/vision.vue')
    assert.match(page, /A browser,\s*<span class="vision-hl">not an extension/)
    assert.match(page, /Personal Intelligence Workspace/)
  })

  test('the footer Company column links to it', () => {
    assert.match(read('../components/TheFooter.vue'), /to="\/vision"/)
  })
})

describe('Vision copy keeps the agent story honest (check-agent-claims)', () => {
  test('no sentence on the page reads as a present-tense agent claim', () => {
    const offenders = sentences(read('../pages/vision.vue'))
      .filter((s: { text: string }) => flags(s.text))
      .map((s: { text: string; line: number }) => `L${s.line}: ${s.text.trim()}`)
    assert.deepEqual(offenders, [], `Vision copy claims the agent acts today:\n${offenders.join('\n')}`)
  })
})

describe('the "desktop app" roadmap item is retired everywhere it was public (#1115)', () => {
  test('the FAQ answer no longer promises a native desktop app', () => {
    const faq = read('../data/faq.ts')
    assert.doesNotMatch(faq, /desktop app/i)
    assert.match(faq, /KimtOS Browser/)
  })

  test('the availability tile is KimtOS Browser, not a desktop app', () => {
    const avail = read('../components/AvailableOn.vue')
    assert.doesNotMatch(avail, /desktop app/i)
    assert.match(avail, /KimtOS Browser/)
    assert.match(avail, /to="\/vision"/)
  })
})
