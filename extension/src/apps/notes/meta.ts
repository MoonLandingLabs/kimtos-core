import { defineMeta } from '../meta';

export default defineMeta({
  id: 'notes',
  name: 'Notes',
  accent: '#a78bfa',
  order: 5,
  marketing: {
    tech: 'Markdown',
    desc: 'Notion-style notes in collections, with live preview, export, and internal links.',
    points: ['Markdown with live preview', 'Collections & internal links', 'Export as a book or PDF'],
    featured: true,
  },
});
