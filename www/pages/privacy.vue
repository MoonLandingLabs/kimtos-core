<script setup lang="ts">
import { CLIENT_STORAGE, LEGAL, SUBPROCESSORS } from '~/data/legal'

// Indexable on purpose (no `noindex`): the Chrome Web Store requires a public, crawlable
// privacy-policy URL for any extension that handles user data.
useHead({
  title: 'Privacy · Kimtos',
  meta: [
    {
      name: 'description',
      content:
        'Kimtos has no accounts, no backend and no servers. Everything runs and stays in your browser, and the source is open (MIT).',
    },
  ],
})
</script>

<template>
  <LegalPage
    title="Privacy"
    intro="Most privacy policies are written to protect the company. This one is written to
           tell you exactly where your data is, because for Kimtos the honest answer is short."
  >
    <div class="legal-callout">
      <p>
        <strong>The short version.</strong> Kimtos v1 has no accounts, no backend and no servers. Everything you create
        — your notes, tasks, PDFs, clipboard, recordings, whiteboards and AI chats — is stored in your own browser and
        never leaves it. We collect no data about you at all, because there is nowhere for it to go. Kimtos is free and
        open source ({{ LEGAL.license }}), so you can check every claim on this page in the
        <a :href="LEGAL.repoUrl" rel="noopener">source code</a>.
      </p>
    </div>

    <h2>What stays on your device</h2>
    <p>
      All of your app content lives in your browser's own storage (IndexedDB and extension storage), on the machine you
      are sitting at. It is never uploaded anywhere. That covers:
    </p>
    <ul>
      <li>Notes, tasks, and PDF Library documents and annotations</li>
      <li>Clipboard history, saved files, whiteboards and screen or camera recordings</li>
      <li>
        Everything you type into the AI apps — chats, transcriptions, OCR'd images, denoised audio and grammar checks
      </li>
      <li>Your wallpapers, settings and which apps you have installed</li>
    </ul>
    <p>
      The AI models run <strong>inside your browser tab</strong> using WebAssembly and WebGPU. Your audio, images and
      text are processed on your own hardware. There is no Kimtos server to send them to, so there is nothing for us to
      leak, sell, or be compelled to hand over.
    </p>
    <p>
      You can inspect, export or delete all of it yourself at any time, from the AnubisDB app or Settings, without
      asking anyone.
    </p>

    <h2>What we collect</h2>
    <p>
      <strong>Nothing.</strong> Kimtos has no accounts, so there is no name, email address, password or sign-in record
      to hold. It has no backend, so there is no database, no server log of your use, and no support inbox. We run no
      product analytics: no tracking pixel, no session recording, no crash reporter, no advertising network and no usage
      counter anywhere in the extension or on these sites. We do not know who uses Kimtos or how many people do.
    </p>

    <h2>When your browser talks to the network</h2>
    <p>
      A local-first app is not an offline app, and we would rather list every exception than imply there are none.
      Kimtos makes a network request in these cases, and only these. Every one is made directly from your browser to a
      public host; none of them goes through a Kimtos server, because there isn't one:
    </p>
    <ul>
      <li>
        <strong>Downloading an AI model</strong> — the first time you use an on-device AI app, its model file is
        downloaded once from <strong>Hugging Face</strong> (huggingface.co), a public model host, and then cached; after
        that the app works offline. Hugging Face serves large files from its own download hosts (<code>*.hf.co</code>),
        so your browser contacts those too. The download reveals your IP address and which file you asked for, like any
        file download. Nothing you have written or recorded is sent.
      </li>
      <li>
        <strong>An OCR language other than English</strong> — SnapText has English built in and needs no download. If
        you set any other language, that language's data file is fetched once from <strong>jsDelivr</strong>
        (cdn.jsdelivr.net), a public npm file host, and then cached. Your image is never sent anywhere — only the name
        of the language pack is requested.
      </li>
      <li>
        <strong>The weather and trending-article cards</strong> — if you have them enabled on your home screen, they
        fetch from <strong>Open-Meteo</strong> (api.open-meteo.com and geocoding-api.open-meteo.com) and from public
        developer feeds (DEV, Hacker News, Lobsters). The weather card sends a city name or a coordinate rounded to
        about 110 metres, so Open-Meteo can return a forecast.
      </li>
      <li>
        <strong>The search bar</strong> — typing a search on the new-tab page sends that query to whichever search
        engine you have chosen in your browser, exactly as a normal search box would.
      </li>
      <li><strong>Importing a PDF by URL</strong> — fetches the file from the address you gave it.</li>
      <li>
        <strong>Links you click</strong> — the Documentation link, the Chrome Web Store link, and "Report an issue",
        which opens a pre-filled issue on GitHub in a new tab. You read and send that text yourself; the extension sends
        nothing.
      </li>
    </ul>
    <p>
      None of these is switched on behind your back to collect anything, and Kimtos does not contact any other host.
      Because the source is open, you can confirm this list against the code and the extension's declared permissions.
    </p>

    <!-- The table is data, not prose: it renders ~/data/legal.ts CLIENT_STORAGE, whose
         names are imported from the code that sets each key, so a rename cannot leave a
         stale policy behind. The id anchors the footer's link and the docs deep-link. -->
    <h2 id="cookies">Cookies and local storage</h2>
    <p>
      Our websites set <strong>no cookies</strong> — no analytics, advertising or tracking cookies, and no functional
      ones either. The only thing they remember is your light/dark theme choice, in your browser's local storage. It
      stays on your device and is never sent anywhere.
    </p>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>What it is</th>
          <th>Why</th>
          <th>How long</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in CLIENT_STORAGE" :key="c.name">
          <td>
            <code>{{ c.name }}</code>
          </td>
          <td>{{ c.kind }}</td>
          <td>{{ c.purpose }}</td>
          <td>{{ c.lifetime }}</td>
        </tr>
      </tbody>
    </table>
    <p>
      The extension itself stores your content in your browser's IndexedDB and extension storage, as described above.
      That storage is on your machine and is not readable by us or by any website.
    </p>

    <h2>Who else sees anything</h2>
    <p>
      Kimtos operates no servers and has no processors of your data. These public third-party hosts are the only ones
      your browser may contact, each for the one feature that needs it, and each sees only what is listed:
    </p>
    <table>
      <thead>
        <tr>
          <th>Who</th>
          <th>What for</th>
          <th>What they see</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in SUBPROCESSORS" :key="s.name">
          <td>
            <strong>{{ s.name }}</strong>
          </td>
          <td>{{ s.purpose }}</td>
          <td>{{ s.sees }}</td>
        </tr>
      </tbody>
    </table>
    <p>
      Those hosts have their own privacy policies. We do not sell your data and do not share it with advertisers or data
      brokers — we do not have it.
    </p>

    <h2>Your rights over your data</h2>
    <p>
      Your content is already yours: it is on your machine, and you can export or erase it yourself without involving
      anyone. Because we hold no personal data about you, there is nothing for us to show, correct or delete. If you are
      in the EU or UK, that also means there is no controller-held record for the GDPR rights to apply to; you may still
      complain to your national data-protection authority if you believe something here is untrue.
    </p>
    <p>
      Questions about this policy go to the public
      <a :href="LEGAL.contactUrl" rel="noopener">GitHub issue tracker</a>.
    </p>

    <h2>Children</h2>
    <p>Kimtos is not directed at children under 13. It collects no data from anyone, children included.</p>

    <h2>Changes</h2>
    <p>
      If we change this policy we will update the date at the top of this page, and the history is public in the
      repository. If a change ever meant your content started leaving your device, we would tell you plainly and ask
      first — that promise is the product.
    </p>
  </LegalPage>
</template>
