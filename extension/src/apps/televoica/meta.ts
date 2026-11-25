import { defineMeta } from '../meta';

export default defineMeta({
  id: 'televoica',
  name: 'Voice to Text',
  accent: '#6c8cff',
  order: 1,
  optIn: true,
  marketing: {
    tech: 'Whisper · WebAssembly',
    desc: 'Transcribe recorded or uploaded voice notes. The audio never leaves your device.',
    points: ['Whisper, running in the browser', 'Record live or upload a clip', 'Your audio never leaves the device'],
    featured: true,
  },
});
