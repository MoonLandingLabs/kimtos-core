// The FAQ, as plain data — rendered by FaqSection.vue AND emitted as FAQPage
// structured data on the homepage (pages/index.vue) so Google can show the
// questions as rich results. One source, so the two never drift.
import { APP_WORDS } from './apps'

export interface Faq {
  q: string
  a: string
}

export const FAQ: Faq[] = [
  {
    q: 'Is my data really private?',
    a: 'Yes. The AI models run inside your browser tab — there’s no KimtOS server that sees your notes, audio, images or chats. The only network calls are optional (weather, importing a PDF by URL) and the one-time model download from Hugging Face. KimtOS has no accounts and no backend, so there is nothing for us to collect.',
  },
  {
    q: 'Is KimtOS free?',
    a: `Yes. All ${APP_WORDS.total} apps are free, including the on-device AI apps and the NotaBoard whiteboard. Nothing is behind a paywall, and there is no card to enter.`,
  },
  {
    q: 'Is KimtOS open source?',
    a: 'Yes. KimtOS v1 is free and open source under the MIT licence, and the full source is on GitHub at github.com/MoonLandingLabs/kimtos-core. You can read it, build it yourself, and verify that nothing leaves your browser.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. KimtOS v1 has no accounts at all — no sign-up, no sign-in, no server. Install the extension and use every app; everything runs and stays in your browser.',
  },
  {
    q: 'Which browsers are supported?',
    a: 'Chrome today, with Firefox, Edge and Safari next on the roadmap. Further out, the destination is KimtOS Browser — a browser with these tools built in rather than added on as an extension. It is direction, not a dated promise; our Vision page sets out why a browser follows from a local-first workspace.',
  },
]
