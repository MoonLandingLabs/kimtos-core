// A Node module-customization hook that lets `node --test` import a real `.vue` single-file
// component, so a test can mount it (see ./setup.ts). Registered via `module.register` in
// setup.ts, which the test script loads with `--import`.
//
// Why this exists rather than a second test framework: every other workspace in the repo
// tests on the built-in `node:test` runner, and #861 asked for a component harness wired into
// THAT runner rather than bringing in Vitest and a parallel config. All this hook does is turn
// a `.vue` file into an ES module `node:test` can load; the mounting itself is @vue/test-utils.
//
// It is deliberately minimal: it compiles the `<script setup>` + `<template>` (styles are
// dropped — a jsdom-free harness renders no CSS) and strips the TypeScript. Nuxt's
// auto-imports (`ref`, `useConfirm`, …) are NOT resolved here — the SFC references them as
// free identifiers, and setup.ts puts them on `globalThis`, which is exactly how unimport
// makes them available at build time.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { transform } from 'esbuild'

let seq = 0

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.vue')) return nextLoad(url, context)

  const filename = fileURLToPath(url)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  if (errors.length) throw new Error(`Failed to parse ${filename}:\n${errors.map(String).join('\n')}`)

  // `inlineTemplate` folds the render function into the same module as the script, so template
  // refs (`ref="card"`) bind to the setup bindings of the same name — which the focus tests
  // depend on. A stable per-file id keeps scoped-style hashing deterministic (we drop styles,
  // but the option is required).
  const compiled = compileScript(descriptor, {
    id: `sfc-${(seq++).toString(36)}`,
    inlineTemplate: true,
  })

  // The script is `lang="ts"`; Node cannot parse the types, so strip them. esbuild preserves
  // the ESM imports Vue's compiler emitted (its runtime helpers, `Teleport`, …).
  const { code } = await transform(compiled.content, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    sourcefile: filename,
  })

  return { format: 'module', source: code, shortCircuit: true }
}
