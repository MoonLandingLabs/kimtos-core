<template>
  <section id="verify" class="section band">
    <div class="split">
      <div v-reveal class="split-lead">
        <h2>Don’t trust us. Check.</h2>
        <p>
          A privacy product that asks for your trust has it backwards. So don’t take our word for it — open your
          browser’s own tools and watch KimtOS do nothing over the network.
        </p>

        <div class="verify-recipe">
          <h3>Verify it in 30 seconds</h3>
          <ol>
            <li>Open your browser’s <strong>DevTools</strong> (<kbd>F12</kbd>, or <kbd>⌘⌥I</kbd>).</li>
            <li>Switch to the <strong>Network</strong> tab.</li>
            <li>Use any app — take notes, run OCR, denoise a clip, draw on the whiteboard.</li>
          </ol>
          <p>The request list stays empty. Nothing is uploaded, because there is nowhere to upload it to.</p>
        </div>
      </div>

      <div v-reveal class="verify-exceptions">
        <h3>The only times KimtOS uses the network</h3>
        <p class="lede">
          We would rather list them than pretend there are none — an undisclosed call would damage the claim far more
          than an honest one.
        </p>
        <ul>
          <li>
            <strong>Open source</strong> — there is no KimtOS server to call. The full source (MIT licensed) is on
            GitHub, so you can read exactly what runs.
          </li>
          <li>
            <strong>Weather and trending-article cards</strong> — if you turn them on, they fetch from public feeds
            (Open-Meteo and developer news).
          </li>
          <li><strong>Importing a PDF by URL</strong> — fetches the file from an address you paste. You start it.</li>
          <li>
            <strong>One-time model downloads</strong> — a model file is fetched once from Hugging Face, then cached.
            After that it works fully offline.
          </li>
        </ul>
        <p class="verify-arch">
          Under the hood: every piece of your content lives in your browser’s IndexedDB; inference runs on-device via
          WebAssembly and WebGPU. There is no backend and there are no accounts.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.verify-recipe {
  margin-top: 1.75rem;
  padding: 1.25rem 1.5rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.verify-recipe h3 {
  margin: 0 0 0.75rem;
}
.verify-recipe ol {
  margin: 0 0 0.75rem;
  padding-left: 1.25rem;
  color: var(--text-2);
}
.verify-recipe ol li {
  margin: 0.4rem 0;
}
.verify-recipe > p {
  margin: 0;
  color: var(--text);
  font-weight: 600;
}
kbd {
  font-family: var(--font, inherit);
  font-size: 0.85em;
  padding: 0.1em 0.45em;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--fill);
  color: var(--text);
  white-space: nowrap;
}
.verify-exceptions h3 {
  margin: 0 0 0.5rem;
}
.verify-exceptions .lede {
  color: var(--text-2);
  margin: 0 0 1rem;
}
.verify-exceptions ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.85rem;
}
.verify-exceptions ul li {
  padding-left: 1rem;
  border-left: 2px solid var(--accent);
  color: var(--text-2);
}
.verify-exceptions ul li strong {
  color: var(--text);
}
.verify-arch {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--text-3);
  font-size: 0.95rem;
}
</style>
