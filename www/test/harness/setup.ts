// Component-test harness for www (#861). Loaded via `--import` from the `test` script BEFORE
// any test file, so three things are in place by the time a `.vue` is imported and mounted:
//
//   1. A DOM. happy-dom is registered onto the global scope (`document`, `window`,
//      `KeyboardEvent`, `requestAnimationFrame`, …) so @vue/test-utils can mount into it.
//   2. A `.vue` loader (./sfc-loader.mjs), so `import X from '../components/X.vue'` works
//      under the `node:test` runner with no second framework.
//   3. Nuxt's auto-imports. A Nuxt SFC uses `ref`, `watch`, `useToast`, `restoreFocus`, …
//      without importing them; unimport injects them at build time. Outside Nuxt they are free
//      identifiers, so we put the same names on `globalThis` — Vue's own reactivity/lifecycle
//      APIs, plus this workspace's composables and utils.
//
// Registering happy-dom globally is safe for the existing pure-logic tests: they run in
// separate `node:test` child processes and, where they stub `globalThis.document`, the global
// is writable so their stub still wins.
//
// Nothing here may hold the event loop open after the tests finish. The test script used to
// paper over that risk with `--test-force-exit`, which killed the process while suites were
// still registering and silently dropped whole files from the run -- 168, 153 and 143 tests on
// one unchanged tree, every run reporting fail 0 (#1011). The flag is gone and banned
// (scripts/check-test-force-exit.mjs), so this harness has to release what it allocates: the
// root `after` below closes the happy-dom window it opened. If this suite ever hangs anyway,
// find the handle still open and close it here too -- do not bring the flag back.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { after } from 'node:test'
import { register } from 'node:module'

GlobalRegistrator.register({ url: 'http://localhost:3000/', width: 1024, height: 768 })
register('./sfc-loader.mjs', import.meta.url)

// Runs once, after every test in this child process. `unregister()` closes the window, which
// clears the timers and pending tasks happy-dom owns, so the process can exit on its own. Any
// `after` a test file registers is scoped to its own suite and has already run by this point.
after(() => GlobalRegistrator.unregister())

// Import Vue and the app code only AFTER the DOM exists, so anything that reads `document` at
// module-evaluation time sees happy-dom's.
const vue = await import('vue')
Object.assign(globalThis, {
  ref: vue.ref,
  shallowRef: vue.shallowRef,
  computed: vue.computed,
  reactive: vue.reactive,
  readonly: vue.readonly,
  watch: vue.watch,
  watchEffect: vue.watchEffect,
  nextTick: vue.nextTick,
  onMounted: vue.onMounted,
  onBeforeMount: vue.onBeforeMount,
  onUnmounted: vue.onUnmounted,
  onBeforeUnmount: vue.onBeforeUnmount,
  onUpdated: vue.onUpdated,
  provide: vue.provide,
  inject: vue.inject,
  toRef: vue.toRef,
  toRefs: vue.toRefs,
  unref: vue.unref,
  isRef: vue.isRef,
  useId: vue.useId,
  useSlots: vue.useSlots,
  useAttrs: vue.useAttrs,
})

// Nuxt's `useState` is a keyed, app-wide shared ref. Reproduce just that contract with a
// module-level map so `useToast()` (which stores its message in `useState`) shares state
// between the component under test and the test's own `useToast()` handle.
const nuxtState = new Map<string, ReturnType<typeof vue.ref>>()
Object.assign(globalThis, {
  useState: <T>(key: string, init?: () => T) => {
    if (!nuxtState.has(key)) nuxtState.set(key, vue.ref(init ? init() : undefined))
    return nuxtState.get(key)
  },
})

// Composables (auto-imported from composables/) and utils (auto-imported from utils/) that the
// components under test reference as free identifiers.
const [{ useScrollLock }, { useInertBackground }, { useToast }, { restoreFocus }] = await Promise.all([
  import('../../composables/useScrollLock'),
  import('../../composables/useInertBackground'),
  import('../../composables/useToast'),
  import('../../utils/focusRestore'),
])
Object.assign(globalThis, {
  useScrollLock,
  useInertBackground,
  useToast,
  restoreFocus,
})
