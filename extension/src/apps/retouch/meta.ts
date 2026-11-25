import { defineMeta } from '../meta';

export default defineMeta({
  id: 'retouch',
  name: 'Retouch',
  accent: '#f43f5e',
  order: 46,
  optIn: true,
  marketing: {
    tech: 'On-device image editor',
    desc: 'Crop, rotate, resize and adjust images right in your browser — fast Canvas editing with live filters, zoom, undo, and one-click export. Save your images on-device; nothing is ever uploaded.',
    points: [
      'Crop, rotate, flip & resize — with zoom',
      'Live brightness, contrast, saturation & filters',
      'Save your images on your device — nothing is uploaded',
    ],
    featured: false,
  },
});
