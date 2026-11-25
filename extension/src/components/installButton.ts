// The Install / Uninstall action button, shared by the App Store rows and the
// app detail dialog so both stay in sync with the install manager. Returns the
// button plus an `update()` that reflects the live state (idle / progress %).
// Subscribe `update` to `onProgress` (and call `off()` when the surface closes).

import { el } from '../lib/dom.js';
import { isInstalled, isRequired } from '../models/installed.js';
import { appModel } from '../lib/appModels.js';
import { install, uninstall, cancel, currentOp } from '../lib/installManager.js';
import { isHostScriptApp, requestAllSites } from '../lib/hostPermission.js';
import { uninstallDialog } from './uninstallDialog.js';
import { showSnackbar } from './snackbar.js';

export interface InstallableApp {
  id: string;
  name: string;
  dataLabel?: string;
  clearData?: () => Promise<void>;
  hasData?: () => Promise<boolean>;
}

const pct = (ratio: number | null | undefined): string => `${Math.round((ratio || 0) * 100)}%`;

export function createInstallButton(app: InstallableApp): { el: HTMLButtonElement; update: () => void } {
  const btn = el('button', 'store-btn-action') as HTMLButtonElement;
  btn.type = 'button';

  btn.addEventListener('click', async (e) => {
    e.stopPropagation(); // don't trigger the surrounding row (which opens details)
    const op = currentOp(app.id);
    if (op) {
      // A download in flight: clicking cancels it. (Uninstall is fast — nothing to cancel.)
      if (op.kind === 'install') cancel(app.id);
      return;
    }
    // Infrastructure (AnubisDB, #176). The button below is disabled and reads "Required", so
    // this is only reachable if a caller bypasses update() — and there is nothing to do.
    if (isRequired(app.id)) return;
    if (isInstalled(app.id)) {
      const model = appModel(app.id);
      // Offer "erase my data" only when the app actually has data stored now.
      const hasData = !!(app.clearData && (await app.hasData?.()));
      const res = await uninstallDialog({
        appName: app.name,
        modelSize: model?.size,
        dataLabel: hasData ? app.dataLabel : undefined,
      });
      if (!res) return;
      uninstall(app.id, { eraseData: res.eraseData });
    } else {
      // Grammit / Clipboard run a content script on the pages you use them on, so they need the
      // all-sites host permission (#637). Request it here, on this click (a user gesture) —
      // requestAllSites() resolves immediately when it's already granted, and prompts otherwise.
      // If the user declines, don't install an app that can't do its job.
      if (isHostScriptApp(app.id) && !(await requestAllSites())) {
        showSnackbar(`${app.name} needs permission to run on the pages you use it on.`);
        return;
      }
      install(app.id);
    }
  });

  function update(): void {
    const op = currentOp(app.id);
    const installed = isInstalled(app.id);
    btn.title = ''; // reset; only the branches that need a tooltip set one below
    if (op?.kind === 'install' && op.cancellable) {
      // Downloading, and this engine really does stop: clickable, with the % and a ✕ affordance.
      btn.disabled = false;
      btn.className = 'store-btn-action button-primary is-loading is-cancelable';
      btn.title = 'Cancel download';
      btn.innerHTML = `<span class="btn-spinner"></span>${op.ratio != null ? pct(op.ratio) : ''}<span class="btn-cancel-x"> ✕</span>`;
    } else if (op?.kind === 'install') {
      // Downloading, but this engine owns its own network and cannot be interrupted. Show the
      // progress and NO ✕: an affordance whose cancel returns immediately and changes nothing is
      // the same lie in a different place — the one KimtManager's own row already guards against.
      btn.disabled = true;
      btn.className = 'store-btn-action button-primary is-loading';
      btn.title = 'This download cannot be stopped once it has started';
      btn.innerHTML = `<span class="btn-spinner"></span>${op.ratio != null ? pct(op.ratio) : ''}`;
    } else if (op) {
      // Uninstall (fast, no download) — not cancelable.
      btn.disabled = true;
      btn.className = 'store-btn-action button-secondary is-loading';
      btn.title = '';
      btn.innerHTML = `<span class="btn-spinner"></span>`;
    } else if (isRequired(app.id)) {
      // Not an Uninstall the user can press and have refused: say plainly that this one is
      // part of the system. AnubisDB is how you see and erase everything the apps store.
      btn.disabled = true;
      btn.className = 'store-btn-action button-secondary is-required';
      btn.textContent = 'Required';
      btn.title = 'AnubisDB is the data console — it cannot be uninstalled';
    } else {
      btn.disabled = false;
      // Uninstall reads as a danger-tinted outline (is-uninstall) — a removable app,
      // not a primary call to action; Install stays the app-accent primary.
      btn.className = installed ? 'store-btn-action button-secondary is-uninstall' : 'store-btn-action button-primary';
      btn.textContent = installed ? 'Uninstall' : 'Install';
    }
  }
  update();

  return { el: btn, update };
}
