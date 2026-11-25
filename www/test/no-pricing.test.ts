// v1 is free for everyone, forever. This pins that none of the user-facing marketing
// surfaces talks about Pro, pricing, trials or checkout again, and that the generated app
// catalog has no tier. It reads the sources the home page is built from, so it needs no
// mounting. (Dated history — blog posts, the changelog — is deliberately not checked.)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FAQ } from '../data/faq'
import { APPS } from '../data/apps'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Whole-word "Pro" (not "Product", "process"), plus the paid-product vocabulary.
const PAID = /\bPro\b|pricing|\btrial\b|checkout|\bupgrade\b|subscribe|subscription|\bbilling\b|\bpromo\b/i

const HOME_SURFACES = [
  '../pages/index.vue',
  '../components/TheHero.vue',
  '../components/TheNav.vue',
  '../components/TheFooter.vue',
  '../components/AppGrid.vue',
  '../components/AvailableOn.vue',
  '../components/StatStrip.vue',
  '../components/WhyOnDevice.vue',
  '../components/VerifyPrivacy.vue',
  '../components/CtaBand.vue',
]

// Prose only: drop comments so a historical note in a source file is not a false positive.
const prose = (src: string) =>
  src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('v1 has no accounts: the account machinery is gone', () => {
  test('no login, signup, account or auth store files remain', () => {
    for (const f of [
      'stores/auth.ts',
      'pages/login.vue',
      'pages/signup.vue',
      'pages/account.vue',
      'pages/forgot-password.vue',
      'pages/reset-password.vue',
      'pages/verify-email.vue',
      'pages/uninstall-survey.vue',
      'plugins/support.client.ts',
      'utils/authedRequest.ts',
    ])
      assert.equal(existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))), false, f)
  })

  test('the home surfaces never invite anyone to sign in or create an account', () => {
    for (const f of HOME_SURFACES) assert.doesNotMatch(prose(read(f)), /sign in|sign up|log in|create an account/i, f)
  })
})

describe('v1 is free: no Pro / pricing copy on the home page', () => {
  for (const f of HOME_SURFACES) {
    test(`${f.replace('../', '')} has no paid-product copy`, () => {
      assert.doesNotMatch(prose(read(f)), PAID)
    })
  }

  test('the FAQ never mentions Pro, pricing or trials', () => {
    for (const { q, a } of FAQ) assert.doesNotMatch(`${q} ${a}`, PAID, q)
  })

  test('the FAQ says there are no accounts', () => {
    const acct = FAQ.find((f) => /account/i.test(f.q))
    assert.ok(acct)
    assert.match(acct.a, /no account/i)
  })

  test('the FAQ says KimtOS is open source under the MIT licence', () => {
    assert.ok(FAQ.some((f) => /open source/i.test(f.q) && /MIT/.test(f.a)))
  })

  test('the app catalog has no plan tier', () => {
    for (const a of APPS) assert.equal('plan' in a, false, `${a.id} still carries a plan`)
  })

  test('the pricing/billing machinery is gone', () => {
    for (const f of [
      'utils/plan.ts',
      'utils/checkout.ts',
      'utils/promo.ts',
      'composables/usePricing.ts',
      'components/PricingSection.vue',
      'pages/billing.vue',
      'pages/refunds.vue',
    ])
      assert.equal(existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))), false, f)
  })
})
