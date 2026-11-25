import { store, type Settings } from '../models/store.js';
import { createDialog } from '../components/dialog.js';
import { renderSettings } from '../views/settings.js';
import { anyDownloading } from '../lib/installManager.js';
import { showSnackbar } from '../components/snackbar.js';

type Wallpaper = Parameters<typeof renderSettings>[1]['wallpaper'];

export function createSettingsController({
  buttonEl,
  onApply,
  wallpaper,
}: {
  // The toolbar's gear button; optional so a surface without one can still deep-link in.
  buttonEl?: HTMLElement;
  onApply?: (patch: Partial<Settings>) => void;
  wallpaper?: Wallpaper;
}): { open: (initialTab?: string) => void } {
  const dialog = createDialog({
    title: 'Settings',
    size: 'lg',
    appDialog: false,
    // A download-affecting setting (bigger model, new OCR language, AI grammar…)
    // kicks off a background re-fetch; closing Settings doesn't cancel it.
    onClose: () => {
      if (anyDownloading())
        showSnackbar('Download continues in the background.', {
          actionLabel: 'Reopen',
          onAction: () => open(),
          duration: 6000,
        });
    },
  });
  // A touch wider than `md` so all the settings tabs fit on one row.
  dialog.el.classList.add('settings-dialog');

  function open(initialTab?: string): void {
    renderSettings(dialog.body, {
      initialTab,
      wallpaper,
      onChange: async (patch) => {
        await store.set(patch);
        onApply?.(patch);
      },
    });
    dialog.open();
  }

  buttonEl?.addEventListener('click', () => open());
  // Deep link: #settings or #settings=<tab> (e.g. #settings=apps).
  const match = location.hash.match(/^#settings(?:=(.+))?$/);
  if (match) open(match[1]);

  return { open };
}
