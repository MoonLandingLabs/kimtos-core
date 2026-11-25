import { defineMeta } from '../meta';

export default defineMeta({
  id: 'snaptext',
  name: 'Image to Text',
  accent: '#f59e0b',
  order: 4,
  optIn: true,
  marketing: {
    tech: 'Tesseract · OCR',
    desc: 'Pull the text out of any screenshot or photo, entirely on-device.',
    points: ['Tesseract OCR, English built in', 'Drop in any screenshot or photo', 'Copy clean, selectable text'],
  },
});
