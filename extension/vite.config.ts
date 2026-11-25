import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// A vendored file may sit in the workspace-hoisted root node_modules or in the
// package's own — resolve against both so paths hold regardless of how npm
// hoists. (Resolving via require + package.json trips `exports` guards, e.g.
// onnxruntime-web, so we probe the file path directly.)
const here = dirname(fileURLToPath(import.meta.url));
const nmRoots = [join(here, 'node_modules'), join(here, '..', 'node_modules')];
const dep = (name: string, file: string): string => {
  for (const root of nmRoots) {
    const p = join(root, name, file);
    if (existsSync(p)) return p;
  }
  throw new Error(`vendored asset not found: ${name}/${file}`);
};

// Runtime assets we self-host because an MV3 extension's CSP forbids CDNs:
// Tesseract's worker + the SIMD/LSTM core, and the ONNX Runtime wasm builds. The
// plain SIMD+threaded build powers Whisper/OCR/grammar; the ASYNCIFY build is the
// one Transformers.js loads for the WebGPU EP (KimtAI's LLM). Copied flat into
// dist/<dir>/<basename> — see ocr.js and the *.worker.js wasmPaths for the
// expected /ocr and /ort URLs.
const VENDOR: [string, string, string][] = [
  ['ocr', 'tesseract.js', 'dist/worker.min.js'],
  ['ocr', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'],
  ['ort', 'onnxruntime-web', 'dist/ort-wasm-simd-threaded.mjs'],
  ['ort', 'onnxruntime-web', 'dist/ort-wasm-simd-threaded.wasm'],
  ['ort', 'onnxruntime-web', 'dist/ort-wasm-simd-threaded.asyncify.mjs'],
  ['ort', 'onnxruntime-web', 'dist/ort-wasm-simd-threaded.asyncify.wasm'],
];
function copyVendorAssets(): Plugin {
  return {
    name: 'copy-vendor-assets',
    apply: 'build',
    async closeBundle() {
      for (const [destDir, name, file] of VENDOR) {
        const out = join('dist', destDir, basename(file));
        await mkdir(dirname(out), { recursive: true });
        await copyFile(dep(name, file), out);
      }
    },
  };
}

// Transformers.js imports `onnxruntime-web/webgpu`, whose `new URL(...wasm)` calls
// make Vite bundle the full ORT backend (the ~22 MB asyncify build) into assets/.
// We never use it — Whisper is pinned to the self-hosted plain build in /ort/ (see
// transcribe.js) — so strip the auto-bundled ORT wasm after the build.
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'drop-unused-ort-wasm',
    apply: 'build',
    async closeBundle() {
      // Vite 8/Rolldown can fire closeBundle before the assets are flushed to disk
      // (seen on macOS): existsSync() reports the dir present but readdir() then throws
      // ENOENT — a TOCTOU race that spuriously failed the build. Retry briefly for the
      // dir to settle; if it never does, skip (stripping the unused ORT wasm is a
      // size optimization, not correctness — Rolldown doesn't auto-bundle it anyway).
      const dir = join('dist', 'assets');
      let files: string[] = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          files = await readdir(dir);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      for (const f of files) {
        if (/^ort-wasm.*\.wasm$/.test(f)) await rm(join(dir, f));
      }
    },
  };
}

// kimtos is a Manifest V3 new-tab extension.
// Vite bundles the new-tab page (index.html) and its JS/CSS into dist/,
// and we copy the manifest + icons alongside so dist/ is loadable as-is.
export default defineConfig(() => {
  return {
    // @kimtos/icons resolves via the npm workspace (node_modules symlink); Vite
    // auto-allows the workspace root, so no alias or fs.allow is needed.
    plugins: [
      dropUnusedOrtWasm(),
      copyVendorAssets(),
      viteStaticCopy({
        targets: [
          { src: 'manifest.json', dest: '.' },
          { src: 'public/icons', dest: '.' },
        ],
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: { newtab: 'index.html', sidepanel: 'sidepanel.html', popup: 'popup.html' },
      },
      // The big chunks are vendor libs that are already lazy-loaded on demand
      // (transformers.js for televoica, pdf.js + its worker for the reader), so
      // they never touch the initial load. Raise the advisory limit accordingly.
      chunkSizeWarningLimit: 2000,
    },
  };
});
