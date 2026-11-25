import { defineMeta } from '../meta';

export default defineMeta({
  id: 'devtools',
  name: 'DevTools',
  accent: '#7c3aed',
  order: 2,
  marketing: {
    tech: 'On-device dev utils',
    desc: 'JSON, Base64, JWT, hashing, regex and more — a developer toolbox that never phones home.',
    points: ['Decode JWTs & Base64 locally', 'Format JSON, hash, test regex', 'No secrets pasted into a website'],
  },
});
