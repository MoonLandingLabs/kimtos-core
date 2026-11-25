<script setup lang="ts">
import { LEGAL } from '~/data/legal'

useHead({
  title: 'Terms · Kimtos',
  meta: [
    { name: 'description', content: 'Kimtos is free, open-source software under the MIT licence, provided as is.' },
  ],
})
</script>

<template>
  <LegalPage title="Terms of Use" intro="Short and in plain English, because terms nobody reads protect nobody.">
    <h2>Who publishes Kimtos</h2>
    <p>
      Kimtos is published by <strong>{{ LEGAL.entity }}</strong>, of {{ LEGAL.address }}, as free and open-source
      software. By installing or using Kimtos you agree to these terms. If you do not agree, please do not use it.
    </p>

    <h2>What Kimtos is</h2>
    <p>
      Kimtos v1 is a browser extension that replaces your new-tab page with a set of apps, plus a static website and
      documentation. The apps run on your own device and store their data there. There are no accounts, no sign-in and
      no Kimtos servers. Kimtos is <strong>free</strong>: every app is available at no charge, and there is nothing to
      buy.
    </p>

    <h2>Open source and licence</h2>
    <p>
      The source code is public on <a :href="LEGAL.repoUrl" rel="noopener">GitHub</a> and is released under the
      <strong>{{ LEGAL.license }} licence</strong>. That licence, not this page, governs what you may do with the code:
      you may use, copy, modify, merge, publish, distribute, sublicense and sell copies of it, provided the copyright
      and permission notice are kept. Third-party components and model files carry their own licences, listed in the
      repository's third-party notices.
    </p>

    <h2>Your data and your content</h2>
    <p>
      Whatever you create in Kimtos stays yours. It is stored on your own device, not on any server of ours — we claim
      no licence over it, and we could not use it if we wanted to. What is and is not collected is set out in our
      <NuxtLink to="/privacy">Privacy policy</NuxtLink>.
    </p>
    <p>
      Because your content lives on your device, <strong>you are responsible for backing it up</strong>. Use the export
      in Settings. If you clear your browser storage, uninstall the extension, or lose the machine, your content is gone
      and nobody can recover it for you — there is no copy.
    </p>

    <h2>Third-party services</h2>
    <p>
      The only third-party host Kimtos contacts is Hugging Face (huggingface.co and its hf.co download hosts), directly
      from your browser, for the AI model downloads you start, as listed in the Privacy policy. That service is not
      operated by us and is subject to its own terms.
    </p>

    <h2>Fair use</h2>
    <p>Do not use Kimtos to break the law, and do not pass modified builds off as the official one.</p>

    <h2>No warranty</h2>
    <p>
      Kimtos is provided <strong>"as is"</strong>, without warranty of any kind, express or implied, including
      merchantability, fitness for a particular purpose and non-infringement. The on-device AI models can be wrong — do
      not rely on them for anything consequential without checking.
    </p>
    <p>
      To the fullest extent the law allows, the author is not liable for any claim, damages or other liability arising
      from the use of Kimtos, including loss of data you did not back up. That is the same limitation as the
      {{ LEGAL.license }} licence.
      <strong>Nothing in these terms takes away rights you have by law as a consumer.</strong>
      Where local consumer law gives you a right that conflicts with something here, that law wins.
    </p>

    <h2>Ending it</h2>
    <p>
      You can stop using Kimtos whenever you like by uninstalling the extension. Your content is on your device and
      remains yours.
    </p>

    <h2>Changes</h2>
    <p>
      These terms may be updated. The date at the top of this page shows when they last changed, and the history is
      public in the repository.
    </p>
  </LegalPage>
</template>
