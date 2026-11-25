// The two components that render caller-built strings must render them as TEXT.
//
// Toasts and confirms both display copy that callers may build from an arbitrary error
// string. Vue escapes `{{ }}` interpolation; `v-html` does not. So a single
// character of a diff — `{{ message }}` becoming `v-html="message"` — silently converts
// both into injection sinks.
//
// Until this file existed, the only thing standing between the codebase and that edit was
// a comment in each component, and `useToast` actively argued the other way by naming its
// parameter `html` and documenting it as an HTML string (#759). The name is fixed; this
// test is the part that keeps it fixed, because a comment cannot fail a build.
//
// This reads the component SOURCE rather than mounting it: the invariant is about what the
// template is allowed to CONTAIN, and a source scan states that directly and runs without a
// DOM. It is the fast first line of defence; test/dialog.component.test.ts now MOUNTS the same
// two components and asserts the injection stays literal in the rendered DOM, which is the part
// a source scan cannot reach (see the note at the foot of this file). Keep both — they guard
// the same rule from opposite ends (the directive that may appear vs. the output produced).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Components that render a string a caller may have built from a server response. */
const TEXT_ONLY_COMPONENTS = [
  { file: 'ToastHost.vue', source: 'useToast', binding: 'message' },
  { file: 'ConfirmDialog.vue', source: 'useConfirm', binding: 'message' },
] as const

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../components/${name}`, import.meta.url)), 'utf8')

/** Every spelling that hands a string to the HTML parser, ANCHORED ON THE `=` that makes it
 *  a real binding or assignment. That anchor is the whole trick, and it is why this file does
 *  no comment-stripping:
 *
 *    - A real sink always assigns a value — `v-html="expr"`, `:innerHTML="expr"`,
 *      `el.innerHTML = expr`. The `=` is never optional.
 *    - The ban COMMENTS these components carry ("no v-html", "Text only") merely NAME the
 *      directive, with no `=`, so they can never match. Prose is ignored for free.
 *
 *  An earlier draft stripped `<!-- -->` and `<script>` comments first, then searched for the
 *  bare word. That reintroduced an HTML parser as a regex, and CodeQL rightly flagged three
 *  separate incompletenesses in it in a row (js/incomplete-multi-character-sanitization on
 *  the `<!-- -->` strip, js/bad-tag-filter on `<script>` twice — case, then `</script >`).
 *  An HTML-parsing regex is never complete; the `=`-anchored match needs no HTML parsing at
 *  all, so there is nothing left to be incomplete.
 *
 *  Vue camelizes a hyphenated attribute, so `:inner-h-t-m-l="x"` binds `innerHTML` just as
 *  `:innerHTML="x"` does — the optional hyphens cover that spelling. */
const RENDERS_AS_HTML = /v-html\s*=|\binner-?h-?t-?m-?l\s*=/i

describe('server-derived strings are rendered as text, never as HTML', () => {
  for (const { file, source, binding } of TEXT_ONLY_COMPONENTS) {
    test(`${file} does not render a string as HTML`, () => {
      assert.doesNotMatch(
        read(file),
        RENDERS_AS_HTML,
        `${file} renders strings from ${source}(), which callers build from backend error ` +
          `text. Rendering that as HTML is an injection sink. Keep {{ ${binding} }}.`,
      )
    })

    test(`${file} still interpolates {{ ${binding} }}`, () => {
      // Guards the other direction: a refactor that drops the interpolation entirely would
      // pass the v-html check above while rendering nothing at all.
      assert.match(read(file), new RegExp(`\\{\\{\\s*${binding}[\\s\\S]*?\\}\\}`))
    })
  }
})

describe('useToast advertises text, not HTML', () => {
  const src = readFileSync(fileURLToPath(new URL('../composables/useToast.ts', import.meta.url)), 'utf8')

  test('show() does not name its parameter `html`', () => {
    // The name is the trap this issue was filed about: `show(html)` reads as an HTML sink,
    // so the next reader "fixes" the renderer to match the name and ships the XSS.
    assert.doesNotMatch(
      src,
      /const show = \(\s*html\b/,
      'show() takes plain text that gets escaped. A parameter named `html` invites someone ' +
        'to make ToastHost.vue render markup to match it.',
    )
  })
})

// The guard is a source-text search, so it is only as good as its own pattern. These pin
// what it must and must not match — including the cases that a comment-stripping predecessor
// existed to handle, now handled for free by anchoring on `=`.
describe('the guard itself', () => {
  test('a real v-html binding is caught, even sharing a line with a URL', () => {
    // The URL case that broke the stripping approach (a `//` in `https://` swallowing the
    // rest of the line) cannot arise here: nothing is stripped, and `v-html=` still matches.
    assert.match('<a href="https://example.test/help" v-html="message" />', RENDERS_AS_HTML)
  })

  test('prose that only names v-html is not mistaken for a directive', () => {
    // No `=`, so no match — no comment-stripping required. This is exactly what the real
    // components contain ("Text only (no v-html): ...").
    assert.doesNotMatch('<!-- Text only (no v-html): never render server strings -->', RENDERS_AS_HTML)
    assert.doesNotMatch('// never use v-html here', RENDERS_AS_HTML)
  })

  test('a hyphenated innerHTML binding is caught, because Vue camelizes it', () => {
    assert.match('<div :inner-h-t-m-l="message" />', RENDERS_AS_HTML)
  })

  test('a raw innerHTML assignment in script is caught', () => {
    assert.match('el.innerHTML = userInput', RENDERS_AS_HTML)
  })

  // Stated rather than asserted, so the next reader knows what this SOURCE scan does NOT cover:
  // extracting the body into a child (`<ToastBody :text="message" />`) that itself uses
  // v-html would pass every check here. That gap is closed by the mounted render assertions in
  // test/dialog.component.test.ts, which check the DOM the components actually produce — a
  // child rendering the message as HTML shows up there as a real node. Re-run this reasoning if
  // a refactor moves the rendering somewhere neither the scan nor that render test can see.
})
