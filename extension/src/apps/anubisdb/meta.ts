import { defineMeta } from '../meta';

export default defineMeta({
  id: 'anubisdb',
  name: 'AnubisDB',
  accent: '#c9a34a',
  order: 20,
  // The console over every app's on-device data — browse, back up, erase. Removing it would
  // not remove the data, only the user's control of it, so it cannot be uninstalled (#176).
  required: true,
  marketing: {
    tech: 'On-device data vault',
    desc: 'One console over everything your apps have saved on this device — browse, back up, or clear it.',
    points: [
      "Browse every app's local data",
      'Export & import per-app backups',
      'Clear one app or wipe all — with undo',
    ],
  },
});
