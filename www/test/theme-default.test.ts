// The site opens LIGHT for a visitor who has chosen nothing (#1217) — and, more importantly,
// says so in only one place.
//
// The default used to be written four times: the inline head script in nuxt.config and its
// comment, `useState`'s initial value, and `initTheme`'s fallback. That script runs BEFORE
// hydration, so any two of them disagreeing paints one theme and then jumps to the other —
// precisely the flash the script exists to prevent, and a flash nothing would have caught.
//
// nuxt.config now imports the constants and builds the script from them, so these tests pin
// the thing that cannot be expressed as a shared import: that the emitted script really is
// derived from them, rather than a hand-written copy that drifted back.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_THEME, THEME_COLORS, THEME_KEY, THEME_MODES } from '../composables/useTheme'

const WWW = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = readFileSync(join(WWW, 'nuxt.config.ts'), 'utf8')
const composable = readFileSync(join(WWW, 'composables/useTheme.ts'), 'utf8')

describe('the default theme (#1217)', () => {
  test('is light', () => {
    assert.equal(DEFAULT_THEME, 'light', 'both public sites open light for a visitor who has chosen nothing')
  })

  test('the pre-paint script is built from the constants, not a second copy of them', () => {
    // A literal fallback in that string is the drift this whole change exists to remove: it
    // would keep working, and silently disagree with the composable on the next edit.
    assert.match(config, /\$\{DEFAULT_THEME\}/, 'nuxt.config must interpolate DEFAULT_THEME')
    assert.match(config, /\$\{THEME_KEY\}/, 'and the storage key')
    assert.doesNotMatch(
      config,
      /getItem\('kimtos-theme'\)/,
      'the storage key must not be hand-typed in the head script — import it',
    )
  })

  test('the composable does not restate the default either', () => {
    assert.doesNotMatch(
      composable.replace(/^.*DEFAULT_THEME: ThemeMode = .*$/m, ''),
      /\? stored : '(light|dark)'/,
      'initTheme must fall back to DEFAULT_THEME, not to a literal',
    )
    assert.doesNotMatch(composable, /useState<ThemeMode>\('theme-mode', \(\) => '(light|dark)'\)/)
  })

  test('the OS is not consulted anywhere in the theme decision', () => {
    // The whole point of the change: `prefers-color-scheme` decides nothing here.
    //
    // Comments are stripped first — both files EXPLAIN that the OS is ignored, and matching
    // that prose would fail on the very sentences documenting the behaviour. The assertion is
    // about code.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code(composable), /prefers-color-scheme/, 'the composable must not read the OS')
    assert.doesNotMatch(code(config), /prefers-color-scheme/, 'and neither must the head config')
    // …and not the STYLESHEET either, which is the one that decides for a visitor the inline
    // script never reaches (JS off, storage blocked). The first version of this test checked
    // only the TypeScript, so it passed while main.css still handed the OS the decision.
    const css = readFileSync(join(WWW, 'assets/css/main.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(
      css,
      /prefers-color-scheme/,
      'main.css must not pick the palette from the OS — `:root:not([data-theme])` IS the default',
    )
  })

  test('the browser chrome tint follows the page, and covers every mode', () => {
    // It used to follow the OS via media queries, which the site itself no longer does — a
    // dark-OS visitor would have got a light page with a dark address bar.
    for (const mode of THEME_MODES) {
      assert.match(THEME_COLORS[mode], /^#[0-9a-f]{6}$/i, `THEME_COLORS is missing a colour for ${mode}`)
    }
    const plugin = readFileSync(join(WWW, 'plugins/theme.client.ts'), 'utf8')
    assert.match(
      plugin,
      /useHead[\s\S]*theme-color[\s\S]*THEME_COLORS\[mode\.value\]/,
      'the tint must go through unhead, or it is overwritten when the head hydrates',
    )
  })
})
