---
name: dialogs
description: >-
  How dialogs work in the kimtos extension, and the ONE rule for making them:
  every dialog uses the single reusable createDialog component
  (extension/src/components/dialog.ts) — never hand-roll an overlay, never spin up
  a parallel dialog system. Covers the two modes (app window vs static utility
  dialog), the ONE uniform size every app window mounts at, why every size is
  viewport-responsive, when to disable maximize, the API, and the conventions a
  dialog must follow (z-index bands, theme, focus, the focused-input re-render
  rule). Use whenever adding, changing, or reviewing any modal / popup /
  dialog / window / overlay / confirm in the extension. Trigger on: "dialog",
  "modal", "popup", "overlay", "window", "createDialog", "confirm dialog", "app
  window", "launcher/settings/store dialog", "picture-in-picture window".
---

# dialogs — one reusable dialog, done one way

There are **two** deliberate dialog patterns — pick the right one, and don't invent
a third:

- **A window / panel → `createDialog`** (`extension/src/components/dialog.ts`). A
  **non-modal** surface with window chrome (title, minimize/maximize/close), the
  app-window/utility z-bands, theme, open/close animation, and (for app windows) drag
  - resize. Everything that is a panel — Settings, App Store, launcher, Report,
    app detail, release notes — and every app window is a `createDialog`. **Never
    hand-roll a window overlay.**
- **A confirm / prompt → `confirmDialog`** (`components/confirm.ts`), or
  **`uninstallDialog`** (`components/uninstallDialog.ts`) for the erase-data variant.
  A **modal**: a full-screen scrim + blur, the **top** z-band (`Z_INDEX.confirm`,
  above every window and utility dialog), blocking, Enter/Escape/backdrop-cancel,
  resolves `Promise<boolean>`, and takes an `owner` so it opens inside a pop-out
  window. **Never hand-roll a confirm, and never rebuild it as a `createDialog`** —
  a modal blocking prompt is a different thing from a floating window, on purpose
  (that is why the z-bands are `appWindow < utilityDialog < confirm`). Both confirm
  call sites already share the one `confirm-overlay`; keep it that way.

The rest of this skill is about the **window** pattern (`createDialog`).

## Two modes — pick with `appDialog`

- **`appDialog: true` (default) — an app window.** Draggable by its header,
  resizable from every edge, maximizable to full-width, raises above other windows
  on click. This is what an installed app opens in (`appsController`). **Every app
  window mounts at the ONE uniform size — you do not pick one** (see below).
- **`appDialog: false` — a static utility dialog.** Centered, fixed size, not
  draggable or resizable. This is Settings, the App Store, the app launcher, the
  Report-an-issue form, app detail, release notes — anything that is a panel, not an
  app. It still keeps the minimize/maximize/close chrome for consistency.

## Size

**App windows (`appDialog: true`) all mount at ONE size — you do not choose it.**
`appsController` opens every app at `size: 'app'` (`.dialog-app` in `styles/shell.css`
— `min(720px, 92vw) × min(620px, 88vh)`) and always `maximizable: true`. A **new app
does NOT declare a window size** — there is no `dialog` field on an app descriptor.
A consistent window on open matters more than each app's ideal footprint, and any app
can Maximize for full width. This is app-convention 4 in `CLAUDE.md`; keep the skill
and that convention in step.

**Utility dialogs (`appDialog: false`) share `size: 'lg'`** (`min(720px, 92vw)`) so
they feel like one system — Settings, App Store, launcher, Report, app detail, release
notes. Prefer `'lg'` for a new utility dialog unless it has a documented reason to
differ. The size classes are `sm | md | lg | xl` (`.dialog-<size>`); these apply to
utility dialogs only now. Don't invent a per-dialog width in CSS — pick a size class.
(Small message prompts are a _confirm_, not a small window — use `confirmDialog`.)

## Responsive — every size is viewport-capped, and the body scrolls

A dialog must fit **any** viewport, not just a desktop one. This is already true of the
shared component, and your content must not break it:

- **Widths and heights cap to the viewport.** Every size is `min(px, vw/vh)` —
  `.dialog-app` is `min(720px, 92vw) × min(620px, 88vh)`, and `.dialog` itself caps at
  `max-width: 96vw; max-height: 88vh`. So a window never exceeds the screen; on a phone
  it shrinks to the `vw/vh` term. **Never set a fixed `px` width/height on a dialog or
  its content** that ignores this — use the size class and let the caps do their job.
- **Content taller than the window scrolls; the window never grows.** For a **utility
  dialog** (`.dialog-static`) `.dialog-body` is a plain `flex: 1 1 auto; min-height: 0;
overflow-y: auto` scroll region — long content scrolls inside `body`. For an **app
  window** the body is a flex column and your `.app-root` flex-fills it (below), so the
  overflow scrolls **inside your root's own scroll region**, not the body. Either way,
  build your UI to live in a scroll region: put a fixed toolbar/sidebar outside the
  scrolling list, and **never assume the window is tall enough to show everything** — an
  empty state must center in the _visible_ window, not in an overflowing pane below the
  fold. (That was #1089: NotaBoard's empty-state CTA sat below the fold because its root
  grew past the mounted window.)
- **Maximize is full-screen and responsive.** `.dialog.is-max` fills the viewport; the
  same stretch carries the layout, so a maximized app must reflow, not assume a wider
  fixed layout. Test both the mounted (720×620) and maximized states — the guarantee
  below now holds identically in both.
- **Your app's root pane is stretched for you in EVERY state — mount exactly ONE.**
  `appsController` tags the element your `render()` leaves in the body with `.app-root`
  (`markAppRoot`), and `styles/shell.css` gives that tag `flex: 1; min-height: 0` in
  **every** app-window state — the default mounted 720×620, maximized, manually sized
  and full-screen alike (the four are folded into one selector set scoped to
  `.dialog-app` so they cannot drift apart). So `body.replaceChildren(root)` with a
  single root, size the root with `height: 100%` (never a `vh` guess — the window is not
  the viewport; a `vh` guess overflows the mounted window, which is exactly #1089), and
  it fills every window state with no CSS of your own. This used to be a hand-written
  list of app layout class names, and an app missing from it silently sat at its own
  fixed height in a maximized window (#651); the stretch was then gated on the
  maximized/sized states only, so at the mounted size the same class of overflow
  returned (#1089). Leave **more than one** element in the body and nothing is tagged —
  several stretched siblings would just split the height between them.

## Maximize — always on for app windows; OFF only for fixed utility palettes

**App windows are always maximizable** — `appsController` forces `maximizable: true`
and you don't set it. (Calculator used to opt out; it no longer does — every app is a
normal maximizable window now.)

`maximizable` defaults to **`true`** for utility dialogs too, and that is wrong for a
**utility** surface whose content can't fill a full screen: a Spotlight-style palette
(the app launcher). Maximizing it leaves a mostly-empty full-screen window — the exact
bug in #498, where the launcher's results are capped at `52vh`.

**Pass `maximizable: false` only for a fixed _utility_ dialog that shouldn't be
full-screen** (the app launcher does this). The control stays visible but greyed, so
the window chrome is still consistent.

## The API

```ts
import { createDialog } from '../components/dialog.js';

const dialog = createDialog({
  title: 'Open an app',
  size: 'lg',
  appDialog: false, // static utility dialog (not an app window)
  maximizable: false, // a fixed palette — no full-screen
  accent, // optional app accent for the header tint
  onClose, // fires when the user (or code) closes it
  onReport,
  onPopOut,
  onMinimize, // optional title-bar affordances
});

dialog.body.append(myContent); // put your UI in `body`, not `el`
dialog.open(); // show
dialog.close(); // hide (fires onClose)
dialog.isVisible(); // -> boolean
dialog.setTitle('…');
```

`createDialog` returns `{ el, body, open, close, minimize, setTitle, isVisible,
setPopOutEnabled }`. Append your content to **`body`** (the scroll region), never to
`el` (the frame).

## Conventions a dialog must honour

- **Focused-input re-render rule (#217).** If your dialog has a search/filter box,
  its `input` handler must repaint **only the results region**, never the container
  that holds the input — rebuilding an ancestor of the focused field kicks the user
  out mid-type. See `appLauncher.ts` (search built once, only the results repaint)
  and the note in `docs/extension/architecture.md`.
- **Theme + colours.** No hard-coded colours — use the tokens (see the `theming`
  skill). The PiP path (`popout: true`, `lib/pip.ts`) mirrors the stylesheets so a
  floating window looks identical.
- **No emoji** anywhere (CLAUDE.md; `scripts/check-emoji.mjs`).

## When you're tempted to make a new dialog component

Don't. A window? Build the content, `createDialog` it, `body.append` it. A yes/no
prompt? `await confirmDialog(message, { danger, owner })`. Either is a few lines
around the shared component — not a new file full of overlay plumbing.
