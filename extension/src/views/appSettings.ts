// An app's own settings, opened from the settings control in its window header.
//
// The apps controller offers that control to EVERY app that declares a settings
// schema, so this view is deliberately app-agnostic: it renders whatever the
// descriptor declares, through the shared renderer that Settings > Apps also uses
// (components/appSettingsFields.ts). Nothing app-specific belongs here.

import { el } from '../lib/dom.js';
import { createDialog } from '../components/dialog.js';
import { appSettingsPanel, type SettingsSchemaApp } from '../components/appSettingsFields.js';

interface SettingsAppDef extends SettingsSchemaApp {
  accent?: string;
}

// One dialog per app, reused across opens (like the app windows themselves).
const dialogs = new Map<string, ReturnType<typeof createDialog>>();

/** Open (or re-open) the settings dialog for one app. */
export function openAppSettings(app: SettingsAppDef): void {
  let dialog = dialogs.get(app.id);
  if (!dialog) {
    dialog = createDialog({
      title: `${app.name} settings`,
      size: 'lg', // the one utility-dialog size (#499)
      appDialog: false,
      maximizable: false, // a short form; full-screen would be mostly empty
      accent: app.accent,
    });
    dialogs.set(app.id, dialog);
  }
  // Rebuilt on every open: the values are read when the controls are built, so a
  // cached panel would show whatever was true the first time the dialog opened.
  dialog.body.replaceChildren(
    appSettingsPanel(app),
    el('p', 'field-hint', `These are also in Settings ▸ Apps, under ${app.name}.`),
  );
  dialog.open();
}
