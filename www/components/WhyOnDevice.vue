<template>
  <section id="private" class="section band">
    <div class="split">
      <div v-reveal class="split-lead">
        <h2>We can’t see your data.<br />Neither can anyone else.</h2>
        <p>
          Most “AI” tools quietly ship your notes and recordings to a server. Kimtos does the opposite: the models run
          inside your browser tab with WebAssembly and WebGPU. There’s no backend to leak, subpoena, or get breached —
          because there isn’t one.
        </p>
        <p class="signoff">— Built for people who’d rather not find out the hard way.</p>
      </div>
      <ul v-reveal class="points">
        <li>
          <h3>Nothing is uploaded</h3>
          <p>Transcription, OCR, denoising and chat all happen locally. The network isn’t in the loop.</p>
        </li>
        <li>
          <h3>You keep the files</h3>
          <p>Everything lives in your browser’s storage. Export a portable backup anytime — it’s yours.</p>
        </li>
        <li>
          <h3>Works offline</h3>
          <p>Models download once, then cache. After that, pull the plug and everything still works.</p>
        </li>
        <li>
          <h3>No account to start</h3>
          <p>There are no accounts at all. Install, open a tab, go. Free and open source under the MIT licence.</p>
        </li>
      </ul>
    </div>
  </section>
</template>
