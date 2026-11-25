// App detail — a macOS App Store "product page" dialog: big icon, name, category,
// the Install/Uninstall action, description + highlights, and an Information table
// (version, category, download, privacy). Opened by clicking an App Store
// row. Reads rich metadata from the app's meta.ts (version, category,
// highlights) so it's ready for per-app versioning down the line.

import { DEFAULTS } from '@kimtos/config';
import { createDialog } from './dialog.js';
import { el, clear } from '../lib/dom.js';
import { monogram } from '../lib/format.js';
import { paintAppTile } from './appIcon.js';
import { appMeta } from '../apps/metaIndex.js';
import { appVersion, appReleases, appFirstReleased } from '../data/appChangelogs.js';
import { newBadge } from './newBadge.js';
import { appModel } from '../lib/appModels.js';
import { onProgress, opError } from '../lib/installManager.js';
import { isInstalled } from '../models/installed.js';
import { createInstallButton, type InstallableApp } from './installButton.js';

export interface DetailApp extends InstallableApp {
  description?: string;
  accent?: string;
  widget?: boolean;
  [key: string]: unknown;
}

function infoRow(label: string, value: string): HTMLElement {
  const row = el('div', 'detail-info-row');
  row.append(el('dt', 'detail-info-key', label), el('dd', 'detail-info-val', value));
  return row;
}

// Same row, but the value is a node (used for the clickable Version → docs link).
function infoRowNode(label: string, value: Node): HTMLElement {
  const row = el('div', 'detail-info-row');
  const dd = el('dd', 'detail-info-val');
  dd.append(value);
  row.append(el('dt', 'detail-info-key', label), dd);
  return row;
}

// A "read more about this version" link to the app's docs folder in the public repository.
// Opens in a new tab (the pattern used across the app for external links).
function docsChangelogUrl(appId: string): string {
  return `${DEFAULTS.docsUrl}/extension/apps/${appId}`;
}
function docsLink(appId: string, text: string, cls: string): HTMLAnchorElement {
  const a = el('a', cls, text) as HTMLAnchorElement;
  a.href = docsChangelogUrl(appId);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// Only one app-detail dialog is ever open (it sits on top of the App Store);
// opening another closes the previous.
let current: (() => void) | null = null;

// A release's lines are already clean, single-line bullets (the CHANGELOG parser stripped
// markers, issue refs and comments). Render them as a plain list.
function releaseLines(lines: string[]): HTMLElement {
  const ul = el('ul', 'detail-release-list');
  for (const line of lines) ul.append(el('li', '', line));
  return ul;
}

export function openAppDetail(app: DetailApp, onOpen?: (id: string) => void): void {
  current?.(); // close whichever detail is currently open
  const meta = appMeta(app.id);
  const model = appModel(app.id);

  let off = () => {};
  const dialog = createDialog({
    title: '',
    size: 'lg', // one size for the utility window dialogs (#499)
    appDialog: false,
    accent: app.accent,
    onClose: () => {
      off();
      dialog.el.remove(); // transient — don't leak a hidden node per open
      if (current === close) current = null;
    },
  });
  const close = () => dialog.close();
  current = close;
  dialog.el.classList.add('app-detail-dialog');

  // ── Header: icon · name/category · action ──────────────────────────────
  const tile = el('span', 'store-tile detail-tile');
  if (!paintAppTile(tile, app)) tile.textContent = monogram(app.name);

  const headMeta = el('div', 'detail-headmeta');
  headMeta.append(el('h2', 'detail-name', app.name));
  const category = meta?.marketing?.tech || (meta?.optIn ? 'On-device tool' : 'Utility');
  headMeta.append(el('p', 'detail-category', category));

  const badges = el('div', 'detail-badges');
  const newTag = newBadge(app.id);
  if (newTag) badges.append(newTag);
  if (app.widget) badges.append(el('span', 'store-tag', 'Home widget'));
  badges.append(el('span', 'store-tag', model ? model.size : 'No download'));
  headMeta.append(badges);

  // "Open" launches an installed app from its product page (#452); it closes the
  // detail (and the store, via onOpen) so the app window is front and centre.
  const openBtn = el('button', 'store-btn-action button-secondary store-btn-open', 'Open') as HTMLButtonElement;
  openBtn.type = 'button';
  openBtn.addEventListener('click', () => {
    onOpen?.(app.id);
    close();
  });

  const { el: btn, update: updateBtn } = createInstallButton(app);
  const cta = el('div', 'detail-cta');
  cta.append(openBtn, btn);

  const head = el('div', 'detail-head');
  head.append(tile, headMeta, cta);

  // ── Error (install/uninstall failure) ──────────────────────────────────
  const err = el('p', 'store-error');
  err.hidden = true;

  // ── Description + highlights ───────────────────────────────────────────
  const desc = el('p', 'detail-desc', meta?.marketing?.desc || app.description || '');
  const body = el('div', 'detail-body');
  body.append(desc);
  if (meta?.marketing?.points?.length) {
    const ul = el('ul', 'detail-points');
    for (const p of meta.marketing.points) ul.append(el('li', '', p));
    body.append(ul);
  }

  // ── Information table ──────────────────────────────────────────────────
  const info = el('dl', 'detail-info');
  const version = appVersion(app.id);
  // The oldest changelog entry's date — the fact the "New" badge above is computed from.
  // Shown raw (ISO) to match the "What's new" release dates in the same dialog.
  const released = appFirstReleased(app.id);
  info.append(
    // From the app's own CHANGELOG.md — the only place its version is declared (#132).
    // It used to read `meta.version`, which every app hard-coded to 1.0.0 forever.
    // Clickable → the app's docs page at its Changelog anchor.
    version ? infoRowNode('Version', docsLink(app.id, version, 'detail-version-link')) : infoRow('Version', '—'),
    infoRow('Category', category),
    infoRow('Download', model ? model.size : 'None — installs instantly'),
    ...(released ? [infoRow('Released', released)] : []),
    infoRow('Privacy', 'Runs on your device — nothing uploaded'),
    infoRow('Developer', 'KimtOS'),
  );
  const infoWrap = el('div', 'detail-section');
  infoWrap.append(el('h3', 'detail-section-title', 'Information'), info);

  // ── What's new ─────────────────────────────────────────────────────────
  // The app's own history, from its CHANGELOG.md. Shown here because this is the moment a
  // user is deciding whether to install or update — "what changed" is the question they
  // are actually asking.
  const releases = appReleases(app.id);
  const whatsNew = el('div', 'detail-section');
  if (releases.length) {
    const list = el('div', 'detail-releases');
    for (const r of releases.slice(0, 3)) {
      const item = el('div', 'detail-release');
      const head_ = el('div', 'detail-release-head');
      head_.append(el('span', 'detail-release-version', r.version), el('span', 'detail-release-date', r.date));
      item.append(head_, releaseLines(r.lines));
      list.append(item);
    }
    // Link out to the full history on the docs site, rather than dumping every version here.
    whatsNew.append(
      el('h3', 'detail-section-title', "What's new"),
      list,
      docsLink(app.id, 'Read more', 'detail-release-more'),
    );
  }

  clear(dialog.body);
  dialog.body.append(head, err, body, whatsNew, infoWrap);

  function refresh(): void {
    updateBtn();
    openBtn.hidden = !onOpen || !isInstalled(app.id);
    const error = opError(app.id);
    err.hidden = !error;
    if (error) err.textContent = `Couldn't ${isInstalled(app.id) ? 'remove' : 'download'} the model: ${error}`;
  }
  refresh();
  off = onProgress(refresh);

  dialog.open();
}
