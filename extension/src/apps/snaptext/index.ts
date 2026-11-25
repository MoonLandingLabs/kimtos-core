// Image to Text — extract text from an image. Built on the shared media→text
// factory, so it gets the same history sidebar (with multi-select + drag-select),
// result view, and uninstall data handling as Voice to Text. OCR runs entirely in
// the browser (Tesseract.js / WASM) — the image never leaves the device.

import { createMediaTextApp } from '../../lib/createMediaTextApp.js';
import { createImageInput } from '../../components/imageInput.js';
// Type-and-constant only: tesseract.js itself stays behind the dynamic import below,
// so this does not pull the OCR engine into the app bundle.
import { DEFAULT_LAYOUT, LAYOUT_OPTIONS } from '../../lib/engines/ocrLayout.js';
import appMeta from './meta.js';

interface ToolCtx {
  attachment?: (kind: string) => { blob: Blob } | null | undefined;
  onProgress?: (p: unknown) => void;
  [key: string]: unknown;
}

export default createMediaTextApp({
  id: appMeta.id,
  name: appMeta.name,
  description: 'Extract text from an image',
  tip: 'Each extraction is saved to the history sidebar — drag across items (or tap Select) to delete several at once.',
  accent: appMeta.accent,
  order: appMeta.order,

  // KimtAI agent tool — OCR the image the user attached.
  tools: [
    {
      name: 'read_text_from_image',
      description: 'Extract text (OCR) from the image the user attached.',
      parameters: { type: 'object', properties: {}, required: [] },
      needs: { attachment: 'image' },
      run: async (_args: Record<string, unknown>, ctx: ToolCtx) => {
        const att = ctx.attachment?.('image');
        if (!att)
          return { ok: false, result: 'No image is attached — ask the user to attach one.', summary: 'no image' };
        const { recognizeText } = await import('../../lib/engines/ocr.js');
        const opts = { lang: 'eng', onProgress: ctx.onProgress };
        const text = await recognizeText(att.blob, opts); // layout omitted → automatic
        return { ok: true, result: text || '(no text found)', summary: `read ${text.length} chars` };
      },
    },
  ],

  dataLabel: 'extracted text & images',
  itemNoun: 'scan',
  mediaFirst: false, // show the extracted text first, the image preview below

  intro: 'Upload, drop, or paste an image and pull the text out of it.',
  note: 'Runs entirely in your browser — the image never leaves your device. The OCR model downloads once and is then cached for offline use.',
  actionLabel: 'Extract text',
  processingHeading: 'Reading the image…',
  resultLabel: 'Extracted text',
  emptyText: '(no text found)',
  downloadName: 'snaptext.txt',

  settings: [
    {
      key: 'language',
      label: 'Language',
      hint: 'Tesseract code: eng, ara, fra, deu… (English is built in; other languages download when you set them)',
      type: 'text',
      default: 'eng',
      affectsDownload: true, // non-English data is fetched on change, not at use time
    },
    {
      key: 'layout',
      label: 'Layout',
      hint: 'How the page is arranged. Automatic suits almost everything; switch only if an image reads better another way — Scattered text for signs, labels and screenshots with text dotted around.',
      type: 'select',
      default: DEFAULT_LAYOUT,
      options: LAYOUT_OPTIONS,
    },
  ],

  createInput() {
    const img = createImageInput();
    return {
      el: img.el,
      onChange: img.onChange,
      getData: () => img.getData(), // { blob, filename } | null
    };
  },

  run: async (data, cfg, { onProgress, signal }) => {
    const { recognizeText } = await import('../../lib/engines/ocr.js');
    const lang = typeof cfg.language === 'string' && cfg.language ? cfg.language : 'eng';
    const layout = typeof cfg.layout === 'string' ? cfg.layout : DEFAULT_LAYOUT;
    if (!data?.blob) return '';
    return recognizeText(data.blob, { lang, layout, onProgress, signal });
  },
});
