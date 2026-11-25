import { defineMeta } from '../meta';

export default defineMeta({
  id: 'kimtmanager',
  name: 'KimtManager',
  accent: '#5b8def',
  order: 21,
  // The window onto work the user cannot otherwise see: a model downloading, a denoise run that
  // outlived its page, an app still holding the microphone. Uninstalling it would not stop any of
  // that — it would only take away the one place the user can watch it and stop it, which is the
  // opposite of the promise. So it is required, exactly like AnubisDB is for data (#176).
  required: true,
  marketing: {
    tech: 'On-device task manager',
    desc: 'See everything Kimtos is doing in the background — downloads, transcriptions, open apps — and stop any of it.',
    points: [
      'Watch model downloads finish, with live progress',
      'Find work that outlived the tab it started in',
      'Stop anything still running, in one click',
    ],
  },
});
