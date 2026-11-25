# Overview

**NotaBoard** is an infinite whiteboard for notes, sketches, and quick diagrams —
in the style of Notability. You draw with a pen, drop shapes, text, and sticky
notes, paste in images, and organize everything into named boards. It is part of
the kimtos new-tab app suite.

Everything is **fully on-device**. There is no backend, no account, and no
network: every board, stroke, and image lives in your browser's IndexedDB and
never leaves the machine.

## Highlights

- **Drawing tools** — pen, highlighter, and an object eraser.
- **Shapes** — line, arrow, rectangle, and ellipse, with optional fill and
  `Shift` to constrain (straight lines, perfect squares/circles).
- **Text & sticky notes** — click to place, type inline; notes come in five
  pastel colors.
- **Images** — insert from a file or paste straight from the clipboard.
- **Selection** — move, resize (corner handles), marquee-select many at once,
  duplicate, and re-order (bring to front / send to back).
- **Boards** — a sidebar of boards, each with a live thumbnail; rename, and
  batch-delete with one-tap undo.
- **Canvas navigation** — pan (hold `Space` and drag, or middle-drag), zoom
  (`⌘/Ctrl`+scroll), fit-to-content, and a **navigator minimap** for jumping
  around large boards.
- **Paper & theme** — grid, dots, ruled, or plain paper, in a light or dark
  theme.
- **Full screen** — a distraction-free mode that fills the whole display.
- **Export** — save any board as a PNG.
- **Home card** — an optional card on the Kimtos home screen listing your recent
  boards; click one to open it, or start a new board. Turn it off in
  Settings ▸ Preferences.

## Privacy model

NotaBoard writes only to local browser storage:

- **Boards** (title, scene, paper, theme, thumbnail) are records in IndexedDB.
- **Inserted images** are stored as binary blobs, keyed per board.
- Nothing is uploaded, and there are no analytics or third-party calls.

Because each board carries its own scene as plain serializable data, your work is
portable — it travels with the browser profile and is included in the suite's
local **Export / Import** backup.
