# Architecture

FakeForm is split across four places, and the split is the design.

| Piece                   | Where                     | What it does                                                          |
| ----------------------- | ------------------------- | --------------------------------------------------------------------- |
| The app window          | `apps/fakeform/index.ts`  | Turns it on, lists the shortcuts, and runs a live demo form.          |
| The badge               | `content/fakeform.ts`     | One small control on the page. Waits for a click. Nothing else.       |
| The filler              | `content/fakeformFill.ts` | The detector, the generators and the data. Injected on demand.        |
| The gate and the wiring | `background/fakeform.ts`  | Checks the app is installed, injects the filler, forwards the action. |

## Two scripts, not one

A control the user can see on any site has to be paid for on every page load. A
form filler, unlike a clipboard watcher or a writing assistant, is not watching
anything — it acts only when asked. So the two halves are separated:

- **The badge is always on** wherever the app is installed and permitted, and it is
  deliberately tiny. It carries no detector, no generators and no name data. All it
  can do is draw itself and send a message.
- **The filler is injected on demand.** When the badge, a keyboard shortcut or a
  right-click item asks for a fill, the service worker injects the filler into that
  tab and tells it what to do. A page you never fill never loads it.

Both bundles are single self-contained files. An extension content script cannot
fetch a sibling chunk at runtime, so a split bundle would break silently on every
page; the build asserts it.

## The pure core

The parts worth being sure about have no DOM in them at all:

- **`lib/fakeform/detect.ts`** decides what a field is asking for, from a plain
  description of it. The `type` attribute wins, then `autocomplete`, then a
  first-match-wins table of word rules over the field's name, id, placeholder,
  ARIA label and `<label>` text — with `class` consulted only as a last resort,
  because a class list is mostly framework noise.
- **`lib/fakeform/values.ts`** turns a kind into a value, honouring the field's own
  `maxlength`, `min`, `max` and `step`.
- **`lib/fakeData.ts`** is the generator itself — names, addresses, phone numbers,
  passwords, card numbers, lorem text. Every generator is seeded, so the same seed
  produces the same person; that is what makes the whole thing testable rather than
  only inspectable. DevTools' Lorem ipsum and UUID tools come from here too.

Only `lib/fakeform/fill.ts` touches the page.

## Writing so the page notices

Setting `input.value` does not update React, Vue or Angular. React puts a value
tracker on the element that shadows the prototype's setter, so assigning through it
updates the tracker as well; React then compares old and new, sees no change, and
never fires its `onChange`. Its state stays empty and the form submits empty —
while the text sits there in the box, looking correct.

So every write goes through the **prototype's** native setter, which leaves the
tracker stale, and is followed by real bubbling `input` and `change` events.
Checkboxes and radio buttons are set with a real `click()`, so the page's own
activation behaviour runs and a radio group's siblings clear correctly.

Undo uses the same path in reverse, which is why restoring a value is as visible to
the page as setting one was.

## Storage

There is none. FakeForm writes nothing to the shared database, nothing to
`chrome.storage`, and has no settings schema — which is why it does not appear in
AnubisDB. Convention 6 is satisfied by having no data at all, which for a tool is
the right answer rather than a loophole.

The one exception is not FakeForm's: the badge remembers where you dragged it, in a
position shared with Grammit's and Clipboard's badges.

## The gate

Every entry point is gated through the one shared rule (the app must be installed) — the badge, the shortcuts, the right-click items, the
service worker's inject step, and the filler itself at the moment of the fill. The
badge subscribes rather than reading once, so it appears the moment the app is
installed, and disappears the moment it is removed,
without a reload.

This is a product gate, not a security boundary. The extension is on your own disk;
anyone willing to edit the bundle can bypass any check in it. The gate exists so
the app behaves correctly, which is all a check on the user's own machine can ever
do.
