import { defineMeta } from '../meta';

export default defineMeta({
  id: 'fakeform',
  name: 'FakeForm',
  accent: '#e879f9',
  order: 47,
  optIn: true,
  marketing: {
    tech: 'On-device generator',
    desc: 'Fill any form on any site with believable fake data, in one keypress — and undo it.',
    points: [
      'One keypress fills the whole form',
      'Names, emails and addresses that read like real ones',
      'Undo puts every field back',
    ],
  },
});
