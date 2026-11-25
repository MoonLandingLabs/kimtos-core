<script setup lang="ts">
import { DEFAULTS } from '@kimtos/config'
import { brandMarkSvg } from '@kimtos/icons'
import { APP_WORDS } from '~/data/apps'
import { REPO_URL } from '~/data/site'

// The Kimtos logo at hero size — the browser is Kimtos, so its page carries the Kimtos
// mark (#1115). Same shared source as the availability strip, so there is one mark, not two.
const browserMark = brandMarkSvg(72)

// The extension's Chrome Web Store listing — the ONE config fact (#1007). Kimtos is
// real and on Chrome today; the vision does not replace that, it grows out of it.
const storeUrl = DEFAULTS.chromeWebStoreUrl

useHead({
  title: 'Vision · Kimtos',
  meta: [
    {
      name: 'description',
      content:
        'Where Kimtos is heading: a productivity browser with every local-first tool built in, ' +
        'MCP tools across every app, and a Personal Intelligence Workspace that runs on your own machine.',
    },
  ],
})

// A real line of reasoning, so it earns numbered markers: each step depends on the one
// before it. Kept as data so the markup stays a single loop.
const steps = [
  {
    title: 'Local-first is the whole product',
    body: `Nothing you write, say or scan leaves your machine, because there is no server to send it
      to. That is not a privacy setting bolted onto a cloud product — it is a decision about where
      the computation happens. A browser is where it happens most, so it is where that decision has
      the most to give.`,
  },
  {
    title: 'An extension is a guest',
    body: `An extension lives inside rules another browser sets — what it may reach, how deeply it may
      integrate, when it is allowed to run. Kimtos does a great deal within those rules, but they are
      still someone else's. Owning the browser ends the guest status: the tools stop being a layer on
      top of the surface and become the surface.`,
  },
  {
    title: 'Apps as tools, not islands',
    body: `Every Kimtos app already declares its actions as MCP-shaped tools. Today those declarations
      are dormant, but the shape is deliberate: the goal is to make each app addressable as a set of
      tools across the whole browser, so notes, tasks, PDFs and the rest stop being isolated windows
      and start being building blocks a piece of work can compose.`,
  },
  {
    title: 'Intelligence that stays home',
    body: `The AI models run on your own hardware now, and the browser is designed to carry that promise
      further — a Personal Intelligence Workspace, where the intelligence that helps you work runs on
      the machine in front of you rather than in someone else's data centre.`,
  },
]
</script>

<template>
  <main class="vision">
    <section class="vision-hero">
      <span class="vision-mark" aria-hidden="true" v-html="browserMark" />
      <p class="vision-kicker">Where Kimtos is heading</p>
      <h1>
        A browser,
        <span class="vision-hl">not an extension.</span>
      </h1>
      <p class="vision-lede">
        Kimtos began as a new tab: a set of local-first tools that open the moment you need them. The tools kept getting
        better, and the shape they wanted kept getting clearer. The destination is a browser — one built around the work
        you do, with the tools inside it rather than bolted on.
      </p>
      <div class="vision-cta">
        <a class="btn btn-primary btn-lg" :href="storeUrl" rel="noopener">Add to Chrome</a>
        <a class="btn btn-ghost btn-lg" :href="REPO_URL" rel="noopener">View the source</a>
      </div>
    </section>

    <section class="vision-thesis">
      <p>
        The useful things are scattered: twenty tabs, twenty accounts, twenty subscriptions. Notes in one service, tasks
        in another, a PDF reader here, a transcription tool there — each behind its own login, each sending your work to
        its own server.
      </p>
      <p>
        Kimtos already gathers {{ APP_WORDS.total }} of those tools into one place, on your machine. The
        <strong>productivity browser</strong> is where that idea stops being an add-on and becomes the thing itself:
        notes, tasks, PDFs, clipboard, whiteboard, transcription and on-device AI, native to the browser you already
        live in.
      </p>
    </section>

    <section class="vision-steps-sec">
      <div class="sec-head">
        <h2>Why a browser follows</h2>
        <p>
          Four steps, each leaning on the one before it — the reason the destination is a browser and not another app.
        </p>
      </div>
      <ol class="vision-steps">
        <li v-for="(step, i) in steps" :key="step.title">
          <span class="vision-step-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <div class="vision-step-body">
            <h3>{{ step.title }}</h3>
            <p>{{ step.body }}</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="vision-honesty">
      <div class="vision-honesty-inner">
        <h2>Said honestly</h2>
        <p>
          The models that would drive those tools without you are not there yet. No on-device model we ship is reliable
          enough to be trusted with your work unattended, and we will not pretend it is — so the tool declarations stay
          dormant until one is. This is the shape, described plainly: the plumbing is laid, the autonomy is future.
        </p>
        <p>
          This is a vision page, and we mean the word. There is no date here, no waitlist, no half-built thing dressed
          up as shipped. Kimtos is real and on Chrome today; Kimtos Browser is where a local-first workspace leads if we
          keep pulling the thread. When there is something to try, you will be the first to know.
        </p>
        <div class="vision-cta">
          <a class="btn btn-primary btn-lg" :href="storeUrl" rel="noopener">Add to Chrome</a>
          <NuxtLink class="btn btn-ghost btn-lg" to="/#apps">See the apps</NuxtLink>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* Prefixed .vision-* throughout so nothing here collides with the home page's
   .kicker/.lede/.hl (those are scoped to .hero). Tokens only — the page re-themes
   with the rest of the site. */
.vision {
  --vision-maxw: 760px;
}

.vision-hero {
  max-width: var(--maxw);
  margin: 0 auto;
  padding: clamp(72px, 12vh, 140px) clamp(16px, 4vw, 36px) clamp(40px, 6vw, 64px);
  text-align: center;
}
.vision-mark {
  display: inline-flex;
  line-height: 0;
  margin: 0 0 26px;
  /* A soft brand-tinted halo so the roundel reads as a hero mark, not a stray favicon. */
  filter: drop-shadow(0 10px 26px color-mix(in srgb, var(--accent) 40%, transparent));
}
.vision-mark svg {
  display: block;
  width: clamp(60px, 9vw, 76px);
  height: clamp(60px, 9vw, 76px);
}
.vision-kicker {
  margin: 0 0 22px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--accent);
}
.vision-hero h1 {
  font-size: clamp(40px, 7vw, 72px);
  line-height: 1.03;
}
.vision-hl {
  color: var(--text-2);
}
.vision-lede {
  max-width: 40em;
  margin: 24px auto 0;
  font-size: clamp(16px, 1.7vw, 19px);
  line-height: 1.6;
  color: var(--text-2);
}
.vision-cta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}

.vision-thesis {
  max-width: var(--vision-maxw);
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px) clamp(16px, 4vw, 36px) clamp(48px, 7vw, 80px);
}
.vision-thesis p {
  margin: 0;
  font-size: clamp(18px, 2.2vw, 23px);
  line-height: 1.55;
  color: var(--text);
  letter-spacing: -0.01em;
}
.vision-thesis p + p {
  margin-top: 22px;
}
.vision-thesis strong {
  font-weight: 600;
  color: var(--accent);
}

.vision-steps-sec {
  max-width: var(--maxw);
  margin: 0 auto;
  padding: clamp(48px, 7vw, 80px) clamp(16px, 4vw, 36px);
  border-top: 1px solid var(--line);
}
.vision-steps {
  list-style: none;
  max-width: var(--vision-maxw);
  margin: 0 auto;
  padding: 0;
}
.vision-steps li {
  display: flex;
  gap: clamp(16px, 3vw, 32px);
  padding: clamp(24px, 3.5vw, 34px) 0;
}
.vision-steps li + li {
  border-top: 1px solid var(--line);
}
.vision-step-num {
  flex: 0 0 auto;
  font-size: clamp(15px, 1.8vw, 18px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  padding-top: 0.2em;
  min-width: 2ch;
}
.vision-step-body h3 {
  font-size: clamp(19px, 2.4vw, 24px);
  line-height: 1.2;
}
.vision-step-body p {
  margin: 12px 0 0;
  font-size: clamp(15px, 1.6vw, 17px);
  line-height: 1.62;
  color: var(--text-2);
}

.vision-honesty {
  background: var(--bg-2);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.vision-honesty-inner {
  max-width: var(--vision-maxw);
  margin: 0 auto;
  padding: clamp(56px, 8vw, 96px) clamp(16px, 4vw, 36px);
  text-align: center;
}
.vision-honesty h2 {
  font-size: clamp(26px, 3.6vw, 38px);
  line-height: 1.1;
}
.vision-honesty p {
  max-width: 42em;
  margin: 22px auto 0;
  font-size: clamp(15px, 1.7vw, 17px);
  line-height: 1.65;
  color: var(--text-2);
}
.vision-honesty .vision-cta {
  margin-top: 36px;
}

@media (max-width: 560px) {
  .vision-steps li {
    flex-direction: column;
    gap: 6px;
  }
}
</style>
