import { defineMeta } from '../meta';

export default defineMeta({
  id: 'clipboard',
  name: 'Clipboard',
  accent: '#0ea5e9',
  order: 45,
  optIn: true,
  marketing: {
    tech: 'On-device clipboard history',
    desc: 'Everything you copy on any site, saved privately on your device — search it, favorite it, tag it, and paste it back into any field without leaving the page.',
    points: [
      'Auto-saves every copy, on-device',
      'Paste anywhere — hotkey, right-click, or on-field button',
      'Search, favorite, tag, merge — nothing leaves your device',
    ],
    featured: false,
  },
});
