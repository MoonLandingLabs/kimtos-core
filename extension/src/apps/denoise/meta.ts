import { defineMeta } from '../meta';

export default defineMeta({
  id: 'denoise',
  name: 'Denoise',
  accent: '#22d3ee',
  order: 7,
  optIn: true,
  marketing: {
    tech: 'DeepFilterNet3',
    desc: 'Strip background noise from audio with an A/B player. Processed locally.',
    points: ['DeepFilterNet3 cleanup', 'A/B the before and after', 'Everything processed locally'],
  },
});
