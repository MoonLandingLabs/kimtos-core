# Changelog

## 1.2.0 — 2026-08-13

- Enter now continues a Markdown list: a task item gives you a new unchecked box, a bullet gives you the same bullet, a numbered item gives you the next number, and the indentation comes with it. Enter on an item you have not typed into ends the list instead. Shift+Enter always gives a plain newline.
- Checkboxes in the preview can be ticked. Clicking one edits the note's own text, so the change is saved, exported and printed like anything else you typed.

## 1.1.0 — 2026-07-27

- Give the extension a session model, and run the apps in one tab
- Scroll a wide Markdown table inside its own block
- Unblock every open PR — admin path filter, the Semgrep rule, and a real audit gate
- Tell the browser which palette to draw its own controls in
- Give Notes' book view a measure, wrap long text, and stop parsing page names as Markdown

## 1.0.3 — 2026-07-25

- Export as Book now reads like a book: lines are held to a readable width instead of running the full window.
- Long unbroken text wraps in the book and the preview, the way it already did while you were writing it.
- A page name is shown exactly as you typed it in the book and in the PDF: one containing `*` or `#` is no longer reinterpreted as Markdown there.
- A page name spanning more than one line no longer splits the heading in an exported `.md` or `.zip` file. In those files the name is still a real Markdown heading, so `*` and `#` in it keep their Markdown meaning.

## 1.0.2 — 2026-07-22

- A delete that fails now says so and keeps the page or collection, instead of reporting success and bringing it back on the next reload.

## 1.0.1 — 2026-07-22

- Reach Preview from a narrow window, with a toggle beside the search button
- Add New page to the collection and page right-click menus

## 1.0.0 — 2026-07-10

- Initial release.
