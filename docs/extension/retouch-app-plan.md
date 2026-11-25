# Retouch — on-device image editor (plan + status)

A KimtOS app (`retouch`) for editing images **entirely in the browser tab** —
crop, rotate, flip, resize, and adjust (brightness/contrast/saturation/blur/
grayscale/sepia/invert), then export or copy. Nothing is uploaded; no model or
WASM download. Free, like every app, and added from the App Store.

## Research → tech choice

We studied the references (Photopea/UTIF, tldraw, Photon-WASM, Filerobot,
WebGPU compute shaders). For a **lightweight, private, zero-download** MVP the
right base is **HTML5 Canvas 2D**:

- Transforms (rotate/flip/crop/resize) are plain `drawImage` on an off-screen
  canvas — instant, no dependencies.
- Adjustments use the **native `ctx.filter`** string (`brightness() contrast()
saturate() blur() grayscale() sepia() invert()`) — GPU-accelerated by the
  browser, live preview via `canvas.style.filter`, baked into pixels on apply.
- No WASM/WebGPU in v1 → keeps the new-tab bundle small and the app instant.
  Photon (Rust→WASM) or WebGPU compute shaders are the natural **later** upgrade
  for heavy/custom filters on very large images; the editor is structured so a
  filter can be swapped to a WASM/WebGPU path without touching the UI.

This matches the KimtOS ethos: fast, offline, on-device, nothing leaves the tab.

## MVP (shipped)

- **Open:** file picker, drag-and-drop, and paste (Ctrl/Cmd-V).
- **Transform:** rotate ±90°, flip H/V, **crop** (drag a rectangle), **resize**.
- **Adjust:** brightness, contrast, saturation, blur, grayscale, sepia, invert —
  live preview, "Apply" bakes them; "Reset" clears.
- **Undo:** undo / redo (bounded snapshot stack) + reset-to-original.
- **Zoom:** `-` / percentage / `+` / Fit, plus Ctrl/Cmd + scroll; a zoomed image
  scrolls inside the canvas area.
- **Saved images (#652):** a history sidebar backed by `history:retouch` — Save
  keeps the pixels **and** the pending adjustments, so reopening resumes the edit.
  Right-click for Open / Rename / Download PNG / Delete; multi-select deletes in
  bulk with one confirm and one undo. Capped at the newest 24.
- **Export:** download **PNG**/**JPEG**, or **copy to clipboard** (pairs nicely
  with the Clipboard app). Filenames derive from the source.
- **Checkerboard** canvas backdrop so transparency reads clearly.

## Agent tools (KimtAI)

Interactive editing needs a live gesture, so it is **not** exposed. Stateless
transforms on an **attached image** are (like denoise/snaptext), returning a
processed image artifact via `ctx.addAttachment({ kind:'image', … })`:
`grayscale_image`, `invert_image`, `rotate_image`, `resize_image`. The saved-image
library adds `list_images`, `get_image`, `rename_image`, `delete_image`. All eight
are **dormant** — they are declared, and nothing runs them today.

## Conventions

- `meta.ts` — `id: 'retouch'`, accent `#f43f5e`, marketing block
  (auto-publishes the App Store card + the marketing-site grid via `gen-apps`).
- Icon — a crop-marks glyph in `@kimtos/icons` (`APP_GLYPHS.retouch`); the dock,
  App Store, and marketing site all render it.
- First-time `tip` + a dock tip in `data/tips.ts`.
- **Floating window** (`popout: true`).
- **Storage** — the shared `dataStore` under `history:retouch` (records + blobs)
  via `createBlobHistory`, so AnubisDB attributes it automatically and
  `dataLabel` / `hasData` / `clearData` offer it for erasure on uninstall.
  Saving is **explicit**: there is no autosave, and an unsaved image is warned
  about before it is discarded.

## Not built (deliberate, possible follow-ups)

- Layers / text / brushes (that's NotaBoard's territory for freehand).
- WASM/WebGPU filter backend for very large images.
- Saving straight into KimtFS.
- Persisting the undo stack with a saved image (12 uncompressed frames per
  image is far too much to store).
