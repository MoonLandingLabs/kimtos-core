import { defineConfig } from 'vite';

// One self-contained IIFE per invocation. An MV3 content script — and a classic
// (non-module) service worker — must be a single file with NO shared hashed chunks:
// it cannot fetch a sibling chunk at runtime, so a split bundle is broken on every
// page, at runtime only. The bundler can't emit IIFE for a multi-input (code-split)
// build either, so we run this config once per entry (see the `build` script),
// selecting via `CS`. Never empties dist (the main `vite build` already filled it).
//
// `codeSplitting: false` is what enforces that — it inlines every dynamic import
// instead of emitting a chunk. It used to be spelled `inlineDynamicImports: true`,
// which Vite 8 (rolldown) DEPRECATED and now ignores: it warned on every build, and
// the guarantee was silently resting on rolldown defaulting codeSplitting to false
// for the `iife` format. Implicit is not good enough for an invariant this load-
// bearing (#115) — so it is stated here, and `scripts/assert-content-bundles.mjs`
// checks the built files really are self-contained.
//
// Why it matters, concretely: importing the 60k-word speller into the content script
// inlines it, taking writer.js from 24 kB to 543 kB on EVERY page the user visits.
// That measurement is why the dictionary is a fetched asset and why spell-checking
// happens in the service worker (#42), and why checkWriting() was deleted (#75).
const ENTRIES: Record<string, string> = {
  writer: 'src/content/writer.ts', // Grammit Anywhere
  clipboard: 'src/content/clipboardCapture.ts', // Clipboard capture
  fakeform: 'src/content/fakeform.ts', // FakeForm's in-page badge (small, always on)
  'fakeform-fill': 'src/content/fakeformFill.ts', // FakeForm's filler (injected on demand)
  background: 'src/background/index.ts', // background service worker (Clipboard sink)
};

const name = process.env.CS || 'writer';
const input = ENTRIES[name];
if (!input) throw new Error(`Unknown content entry "${name}" (set CS to one of: ${Object.keys(ENTRIES).join(', ')})`);

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    // A single-file IIFE never preloads a sibling chunk, so Vite's module-preload
    // helper is dead code — and it uses `import.meta`, which is `{}` in IIFE format,
    // so it warned on every content build (#508). Drop the helper.
    modulePreload: false,
    rollupOptions: {
      input: { [name]: input },
      output: {
        entryFileNames: `${name}.js`,
        format: 'iife',
        // Inline every dynamic import; never emit a chunk. See the note above.
        codeSplitting: false,
      },
    },
  },
});
