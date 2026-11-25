# Reference

A quick reference for the reader controls, data, and limits.

## Reader controls

| Control        | What it does                                                                 |
| -------------- | ---------------------------------------------------------------------------- |
| Back (‹)       | Return to the reading list.                                                  |
| Search field   | Find a word or phrase across the whole book; press `Enter` to run / advance. |
| Match counter  | Shows _current match / total matches_.                                       |
| ‹ / › (search) | Jump to the previous / next match.                                           |
| − / + (zoom)   | Zoom out / in; the percentage shows between them. Remembered per book.       |
| Page indicator | Live _current page / total pages_, updated as you scroll.                    |
| Download       | Save the stored PDF back to your computer, named after the book's title.     |
| Notes          | Toggle the annotations sidebar (highlights + comments).                      |

## Selection popup

Appears when you select text in a page, or when you click an existing highlight.

| Action             | Result                                                   |
| ------------------ | -------------------------------------------------------- |
| Color swatch       | Highlight the selection in yellow, green, blue, or pink. |
| Note               | Highlight and open a comment box for a typed note.       |
| Comment box + Save | Attach or edit a note on the highlight.                  |
| Trash              | Delete the highlight (and its note).                     |

## Annotations sidebar

| Element        | Meaning                                       |
| -------------- | --------------------------------------------- |
| Color dot      | The highlight's color.                        |
| Text + note    | The highlighted text and any comment.         |
| Page N         | The page the highlight is on.                 |
| Click an entry | Scroll to the highlight (it flashes briefly). |
| Trash icon     | Delete that annotation.                       |

## Reading list

| Control             | Action                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| Title field         | Optional name; falls back to the file name or URL.                     |
| Import              | Add a PDF from a pasted URL.                                           |
| Upload a PDF        | Add a PDF file from your computer.                                     |
| All / Unread / Read | Filter the list.                                                       |
| Read checkbox       | Mark a book read / unread (updates the dock badge).                    |
| Download            | Save that book's PDF to your computer. Nothing in the library changes. |
| Trash / Select      | Remove one book, or batch-delete several.                              |

## Data & storage

| Item                                                               | Where it lives                        |
| ------------------------------------------------------------------ | ------------------------------------- |
| Books (title, source, read state, last page, last-read time, zoom) | IndexedDB records                     |
| PDF files                                                          | IndexedDB blobs, keyed `pdf:<bookId>` |
| Annotations (highlights + comments)                                | IndexedDB records, linked by `bookId` |

Deleting a book also deletes its stored PDF and all of its annotations. Nothing
is ever uploaded.

## Limits

| Limit                                | Value                            |
| ------------------------------------ | -------------------------------- |
| Maximum file size (import or upload) | {{pdfMaxSize}}                   |
| Accepted file type                   | PDF only (validated on add)      |
| Highlight colors                     | Yellow, green, blue, pink        |
| "Continue reading" widget            | Up to 5 most recently read books |
