// First-run onboarding: greet, ask the user's name, and let them opt into the
// opt-in tools. Every default app installs automatically (see DEFAULT_APPS); the
// opt-in tools are off by default — if the user opts in, we pre-download that
// tool's on-device model (when it has one) so the first use is instant and
// offline. Shown once (`onboarded`).
//
// The catalog is derived from the apps themselves (`optIn` lives in each
// apps/<id>/meta.ts, download size in lib/appModels), so a new app shows up here
// with no edits to this file.

import { store } from '../models/store.js';
import { DEFAULT_APPS } from '../models/installed.js';
import { apps, type App } from '../apps/index.js';
import { appMeta } from '../apps/metaIndex.js';
import { appModel } from '../lib/appModels.js';
import { loadAsJob } from '../lib/modelJob.js';
import { isHostScriptApp, requestAllSites } from '../lib/hostPermission.js';
import { createProgressBar, type ProgressInfo } from '../components/progressBar.js';
import { showSnackbar } from '../components/snackbar.js';
import { paintAppTile } from '../components/appIcon.js';
import { monogram } from '../lib/format.js';
import { el } from '../lib/dom.js';
import { setAccent } from '../lib/accent.js';

// Split the catalog by `optIn` (declared in each meta.ts): the default ones are installed
// automatically; the opt-in ones are the list the user picks from.
const includedApps = apps.filter((a) => !appMeta(a.id)?.optIn);
const optInApps = apps.filter((a) => appMeta(a.id)?.optIn);

// A macOS-style icon tile for an app (accent glyph, else a monogram) — mirrors
// the App Store so onboarding and the store read as one product.
function appTile(app: App): HTMLElement {
  const tile = el('span', 'onboarding-tile');
  if (app.accent) setAccent(tile, app.accent);
  if (!paintAppTile(tile, app)) tile.textContent = monogram(app.name);
  return tile;
}

// A short "downloads NNN" pill for an opt-in tool, or null when adding it is
// instant (no model, English-bundled OCR, or Grammit's optional deep-grammar
// model which stays off by default).
function installSize(app: App): string | null {
  if (app.id === 'grammit') return null;
  const match = appModel(app.id)?.size.match(/~?\s*[\d.]+\s*[MG]B/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

export function renderOnboarding(host: HTMLElement, { onDone }: { onDone?: () => void } = {}): void {
  host.className = 'onboarding-overlay';

  const card = el('div', 'onboarding-card');
  const head = el('div', 'onboarding-head');
  head.append(
    el('h1', 'onboarding-title', 'Welcome to KimtOS'),
    el(
      'p',
      'onboarding-lead',
      'A private developer home page. Your notes, todos, books and tools all run locally on your device — nothing is uploaded.',
    ),
  );

  // Name (optional) — used for the home greeting.
  const nameField = el('div', 'onboarding-field');
  const nameLabel = el('label', 'onboarding-field-label', 'What should I call you?');
  nameLabel.htmlFor = 'onboarding-name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'onboarding-name';
  nameInput.className = 'input';
  nameInput.placeholder = 'Your name (optional)';
  nameInput.value = store.get('name') || '';
  nameField.append(nameLabel, nameInput);
  head.append(nameField);
  card.append(head);

  // Scroll region holds the two catalog sections so a tall list never pushes the
  // "Get started" button off screen.
  const scroll = el('div', 'onboarding-scroll');

  // Installed automatically. Shown as read-only chips so the user
  // sees what they're getting; not selectable (they can uninstall later).
  const includedHead = el('div', 'onboarding-section-head');
  includedHead.append(
    el('span', 'onboarding-section-title', 'Included'),
    el('span', 'onboarding-section-note', 'Installed automatically'),
  );
  const includedGrid = el('div', 'onboarding-included');
  for (const app of includedApps) {
    const chip = el('div', 'onboarding-chip');
    chip.append(appTile(app), el('span', 'onboarding-chip-name', app.name));
    includedGrid.append(chip);
  }
  const includedSection = el('div', 'onboarding-section');
  includedSection.append(includedHead, includedGrid);
  scroll.append(includedSection);

  // Opt-in tools: each one is an opt-in checkbox (icon · name + size ·
  // pitch), added now or anytime later from the App Store.
  const optInHead = el('div', 'onboarding-section-head');
  optInHead.append(
    el('span', 'onboarding-section-title', 'Add more tools'),
    el('span', 'onboarding-section-note', 'On-device AI & media · opt in now or anytime'),
  );

  const tools = el('div', 'onboarding-tools');
  const checks = new Map<string, HTMLInputElement>();
  for (const app of optInApps) {
    const row = el('label', 'onboarding-tool');

    const text = el('div', 'onboarding-tool-text');
    const nameRow = el('div', 'onboarding-tool-namerow');
    nameRow.append(el('span', 'onboarding-tool-name', app.name));
    const size = installSize(app);
    if (size) nameRow.append(el('span', 'onboarding-tool-size', `↓ ${size}`));
    text.append(nameRow, el('span', 'onboarding-tool-hint', app.description || ''));

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'onboarding-tool-check';
    row.append(cb, appTile(app), text);
    checks.set(app.id, cb);
    tools.append(row);
  }
  const optInSection = el('div', 'onboarding-section');
  optInSection.append(optInHead, tools);
  scroll.append(optInSection);
  card.append(scroll);

  const body = el('div', 'onboarding-body');
  const note = el('p', 'onboarding-foot-note', 'Add or remove any app anytime from the App Store.');
  const actions = el('div', 'onboarding-actions');
  const start = el('button', 'button-primary', 'Get started');
  start.type = 'button';
  actions.append(start);
  body.append(note, actions);
  card.append(body);
  host.replaceChildren(card);

  function finish(): void {
    const name = nameInput.value.trim();
    const selected = optInApps.filter((a) => checks.get(a.id)?.checked).map((a) => a.id);
    // Write the chosen set under this install's workspace, not the legacy device-wide key.
    const byUser = { ...(store.get('installedAppsByUser') || {}) };
    byUser[store.workspaceId()] = [...DEFAULT_APPS, ...selected];
    store.set({ onboarded: true, installedAppsByUser: byUser, ...(name ? { name } : {}) });
    host.classList.add('is-leaving');
    setTimeout(() => {
      host.remove();
      onDone?.();
    }, 220);
  }

  // Lock the form while setup runs so nothing changes mid-download.
  function lockForm(): void {
    nameInput.disabled = true;
    checks.forEach((cb) => (cb.disabled = true));
    nameField.classList.add('is-locked');
    scroll.classList.add('is-locked');
  }

  async function prepare(): Promise<void> {
    // Grammit / Clipboard run a content script on the pages you use them on, so they need the
    // all-sites permission (#637). Ask on this click (a user gesture), before any await. On
    // refusal, drop them from the selection rather than installing an app that can't run — the
    // user can enable them (and be prompted again) from the App Store anytime.
    if (optInApps.some((a) => isHostScriptApp(a.id) && checks.get(a.id)?.checked) && !(await requestAllSites())) {
      for (const a of optInApps) if (isHostScriptApp(a.id)) checks.get(a.id)!.checked = false;
      showSnackbar(
        'Grammit and Clipboard need permission to run on your pages — skipped. Add them anytime from the App Store.',
      );
    }
    const selected = optInApps.filter((a) => checks.get(a.id)?.checked);
    // Only the opt-in tools with a model need a download; the rest install instantly.
    const toDownload = selected.filter((a) => appModel(a.id));
    if (!toDownload.length) {
      finish();
      return;
    }
    lockForm();
    const bar = createProgressBar({ hint: 'One-time setup — cached and works offline afterwards.' });
    body.replaceChildren(bar.el);
    try {
      for (const app of toDownload) {
        const model = appModel(app.id);
        if (!model) continue;
        bar.update({ phase: 'run', label: `Preparing ${app.name}…`, ratio: null });
        // First-run setup can pull every selected model — up to about 800 MB — and it used to
        // do it outside the orchestrator, with the form locked: no row, no Stop, and nothing to
        // find it by if the user opened a new tab (#1307). The bar here is what they are looking
        // at; the row is what makes the work exist anywhere else.
        await loadAsJob(
          { appId: app.id, title: `Downloading ${app.name}'s model`, cancellable: model.cancellable },
          (onProgress, signal) =>
            Promise.resolve(
              model.download((p) => {
                onProgress(p as ProgressInfo);
                bar.update(p as ProgressInfo);
              }, signal),
            ),
        );
      }
      finish();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const error = el('p', 'app-error', `Setup didn’t finish: ${msg}`);
      const retry = el('button', 'button-primary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', prepare);
      const later = el('button', 'onboarding-skip', 'Finish anyway');
      later.type = 'button';
      later.addEventListener('click', finish); // installs them; models download on first use
      const row = el('div', 'onboarding-actions');
      row.append(retry, later);
      body.replaceChildren(error, row);
    }
  }

  start.addEventListener('click', prepare);
}
