# Reference

A quick reference for tools, keyboard shortcuts, and settings.

## Tools

| Tool        | Shortcut | What it does                                       |
| ----------- | -------- | -------------------------------------------------- |
| Select      | `V`      | Select, move, resize, and marquee-select elements. |
| Pen         | `P`      | Freehand drawing.                                  |
| Highlighter | `H`      | Translucent, thick freehand.                       |
| Eraser      | `E`      | Drag across elements to remove them.               |
| Line        | `L`      | Straight line.                                     |
| Arrow       | `A`      | Line with an arrowhead.                            |
| Rectangle   | `R`      | Rectangle, optionally filled.                      |
| Ellipse     | `O`      | Ellipse, optionally filled.                        |
| Text        | `T`      | Click to place a text box and type.                |
| Sticky note | `N`      | Drop a colored sticky note and type.               |
| Image       | —        | Insert from a file, or paste from the clipboard.   |

Tap an active **pen, highlighter, shape, text, or note** tool a second time to
open its color/thickness popover.

## Keyboard shortcuts

| Keys                                         | Action                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| `V` `P` `H` `E` `L` `A` `R` `O` `T` `N`      | Pick a tool                                          |
| `⌘/Ctrl` + `Z`                               | Undo                                                 |
| `⌘/Ctrl` + `Shift` + `Z` (or `⌘/Ctrl` + `Y`) | Redo                                                 |
| `⌘/Ctrl` + `A`                               | Select all                                           |
| `⌘/Ctrl` + `D`                               | Duplicate selection                                  |
| `Delete` / `Backspace`                       | Delete selection                                     |
| `Shift` (while drawing a shape)              | Constrain — straight line, square, circle            |
| `Space` + drag                               | Pan the canvas                                       |
| `⌘/Ctrl` + scroll                            | Zoom in / out                                        |
| `Esc`                                        | Close a popover, finish editing, or exit full screen |

## Page setup

Opened from the sliders button on the tool bar.

| Setting   | Options                  |
| --------- | ------------------------ |
| Paper     | Grid, Dots, Lines, Plain |
| Theme     | Light, Dark              |
| Navigator | Shown, Hidden            |

Paper and theme are saved per board.

## Tool-bar actions

| Control                       | Action                                         |
| ----------------------------- | ---------------------------------------------- |
| Undo / Redo                   | Step backward / forward through history        |
| Bring to front / Send to back | Re-order the selection                         |
| Delete                        | Remove the selection                           |
| Zoom out / **%** / Zoom in    | Zoom; click the **%** to reset to 100%         |
| Fit                           | Frame all content in view                      |
| Page setup                    | Paper, theme, navigator                        |
| Full screen                   | Fill the display; `Esc` or click again to exit |
| Export                        | Save the board as a PNG                        |

## Data & storage

| Item                                    | Where it lives                                |
| --------------------------------------- | --------------------------------------------- |
| Boards (scene, paper, theme, thumbnail) | IndexedDB records                             |
| Inserted images                         | IndexedDB blobs, keyed per board              |
| Backup                                  | Included in the suite's local Export / Import |

Deleting a board also deletes its images. Nothing is ever uploaded.
