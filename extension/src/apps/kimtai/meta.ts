import { defineMeta } from '../meta';

export default defineMeta({
  id: 'kimtai',
  name: 'KimtAI',
  accent: '#14b8a6',
  order: 6,
  optIn: true,
  marketing: {
    tech: 'On-device LLM · WebGPU',
    desc: 'A private AI chat that runs entirely in your tab — not a single token leaves your device.',
    points: [
      'A real LLM, running in your tab',
      'Works offline once the model is downloaded',
      'Not a single token sent to a server',
    ],
    featured: true,
  },
});
