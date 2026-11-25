import { createDialog } from '../components/dialog.js';
import { renderAppStore } from '../views/appStore.js';
import { clearInstallErrors, anyDownloading } from '../lib/installManager.js';
import { showSnackbar } from '../components/snackbar.js';

export function createAppStoreController({
  buttonEl,
  onOpen,
}: {
  buttonEl: HTMLElement;
  /** Launch an installed app from a card/detail "Open" button. Omit to hide it. */
  onOpen?: (id: string) => void;
}): { open: () => void } {
  const dialog = createDialog({
    title: 'App Store',
    size: 'lg',
    appDialog: false,
    // Installs keep running in the background (see installManager) — let the user
    // know closing the store didn't cancel the download.
    onClose: () => {
      if (anyDownloading())
        showSnackbar('Download continues in the background.', {
          actionLabel: 'Reopen',
          onAction: () => open(),
          duration: 6000,
        });
    },
  });
  dialog.el.classList.add('store-dialog');
  // Opening an app from a card closes the store first, so the launched app window
  // isn't buried under it (the reason for the button: no more hunting the dock).
  // Undefined when no handler is wired — the rows then hide the Open button.
  const handleOpen = onOpen
    ? (id: string): void => {
        dialog.close();
        onOpen(id);
      }
    : undefined;
  // Rendered once; the install manager keeps the rows live (installs continue in
  // the background while the dialog is closed). Clicking an app opens its detail
  // dialog on top of the store (only one detail at a time — see openAppDetail).
  const refresh = renderAppStore(dialog.body, handleOpen);

  const open = (): void => {
    clearInstallErrors(); // don't show stale errors from a previous session
    refresh();
    dialog.open();
  };
  buttonEl.addEventListener('click', open);
  if (location.hash === '#store') open(); // deep link
  return { open };
}
