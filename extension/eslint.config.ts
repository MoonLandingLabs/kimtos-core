import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { base } from '@kimtos/config/eslint.base';

// Extends the shared @kimtos base (JS + TS recommended, unused-vars policy) with
// the extension's browser/webextension environment, then prettier last.
export default tseslint.config(
  ...base,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  // No native dialogs. A chrome-rendered prompt/confirm/alert ignores our CSS token
  // system (so it cannot follow Light/Dark), blocks the main thread, and does not
  // render inside a popped-out floating window — it lands on the new-tab page behind
  // it, which reads to the user as "the button does nothing". Use our own dialogs.
  //
  // Both rules are needed: no-restricted-globals catches a bare `prompt(...)`, but
  // NOT the `window.`-qualified form — which is the form this codebase actually had
  // (apps/retouch, #62). no-restricted-properties covers that one.
  {
    files: ['src/**/*.{js,ts}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'prompt', message: 'Use promptDialog()/promptFields() from components/promptDialog.ts.' },
        { name: 'confirm', message: 'Use confirmDialog() from components/confirm.ts.' },
        { name: 'alert', message: 'Use infoDialog() from components/infoDialog.ts.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'prompt',
          message: 'Use promptDialog()/promptFields() from components/promptDialog.ts.',
        },
        { object: 'window', property: 'confirm', message: 'Use confirmDialog() from components/confirm.ts.' },
        { object: 'window', property: 'alert', message: 'Use infoDialog() from components/infoDialog.ts.' },
      ],
    },
  },
  // An overlay must open in the document of the UI it belongs to. An app popped out
  // into a floating window lives in ANOTHER document, so a component's own
  // `document.body` is the new-tab page — the overlay lands behind the window the
  // user is looking at and the action reads as doing nothing (#85). Mount via
  // ownerBody(owner) instead (lib/dom.ts).
  {
    files: ['src/components/**/*.{js,ts}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'body',
          message: 'Use ownerBody(owner) from lib/dom.ts so the overlay opens in a popped-out app’s window (#85).',
        },
      ],
    },
  },
  // The two components that legitimately belong to the new-tab page, not to an app:
  // dialog.ts is the app WINDOW itself (it is what gets popped out, not what pops),
  // and uninstallDialog.ts belongs to the App Store, which never runs inside an app.
  {
    files: ['src/components/dialog.ts', 'src/components/uninstallDialog.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  // Node build scripts (e.g. the docs generator, the Web Store asset generator) run under
  // Node, not the browser.
  {
    files: ['scripts/**/*.{js,mjs}', 'store-assets/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Build config (vite.config.ts, etc.) runs under Node — process, __dirname, …
  {
    files: ['*.config.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
