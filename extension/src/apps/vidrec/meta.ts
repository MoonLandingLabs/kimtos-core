import { defineMeta } from '../meta';

export default defineMeta({
  id: 'vidrec',
  name: 'Video Recorder',
  accent: '#f472b6',
  order: 9,
  optIn: true,
  marketing: {
    tech: 'WebCodecs',
    desc: 'Record screen and camera together, with live toggles and on-device noise reduction.',
    points: ['Screen + camera, together', 'Toggle sources mid-recording', 'On-device noise reduction'],
  },
});
