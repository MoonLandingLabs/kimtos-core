// App Store — a macOS App Store-style card grid (2–3 per row). Each app card
// (icon · name + tags · description · Install/Uninstall) is clickable to open a
// detail "product page" dialog on top of the store. Installs run through the
// global install manager, so they continue in the background if the store is
// closed and show live progress when reopened. Installing an app with an
// on-device model downloads it; model-less apps are instant.

import { apps } from '../apps/index.js';
import { monogram } from '../lib/format.js';
import { appModel } from '../lib/appModels.js';
import { appMeta } from '../apps/metaIndex.js';
import { opError, onProgress } from '../lib/installManager.js';
import { isInstalled } from '../models/installed.js';
import { paintAppTile } from '../components/appIcon.js';
import { createInstallButton } from '../components/installButton.js';
import { newBadge } from '../components/newBadge.js';
import { openAppDetail, type DetailApp } from '../components/appDetail.js';
import { el } from '../lib/dom.js';
import { setAccent } from '../lib/accent.js';

const appList = apps as unknown as DetailApp[];

/**
 * Render the store. Returns a `refresh()` that re-evaluates every row against the CURRENT state.
 *
 * The rows are built once and live for the page's lifetime, so their labels are only as fresh as
 * whatever last re-ran them — which used to be the install bus and nothing else. The updaters
 * existed; they were simply not reachable from outside.
 */
export function renderAppStore(container: HTMLElement, onOpen?: (id: string) => void): () => void {
  const list = el('div', 'store-list');
  const updaters: (() => void)[] = [];
  const rows: { el: HTMLElement; hay: string }[] = [];

  function row(app: DetailApp): HTMLElement {
    const meta = appMeta(app.id);
    const model = appModel(app.id);
    const item = el('div', 'store-row');
    if (app.accent) setAccent(item, app.accent);
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${app.name} — details`);

    const tile = el('span', 'store-tile');
    if (!paintAppTile(tile, app)) tile.textContent = monogram(app.name);

    const rowMeta = el('div', 'store-rowmeta');
    const top = el('div', 'store-name-row');
    top.append(el('span', 'store-name', app.name));
    const badge = newBadge(app.id);
    if (badge) top.append(badge);
    if (app.widget) top.append(el('span', 'store-tag', 'Home widget'));
    if (model) top.append(el('span', 'store-tag', model.size));
    const sub = meta?.marketing?.tech ? `${meta.marketing.tech} — ${app.description || ''}` : app.description || '';
    rowMeta.append(top, el('p', 'store-desc', sub));
    const err = el('p', 'store-error');
    err.hidden = true;
    rowMeta.append(err);

    // "Open" launches an installed app straight from the Store (no dock hunt, #452).
    // Shown only while installed — update() toggles it as install state changes.
    const openBtn = el('button', 'store-btn-action button-secondary store-btn-open', 'Open') as HTMLButtonElement;
    openBtn.type = 'button';
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger the row (which opens the detail dialog)
      onOpen?.(app.id);
    });

    const { el: btn, update: updateBtn } = createInstallButton(app);
    const cta = el('div', 'store-row-cta');
    cta.append(openBtn, btn);

    // Icon + meta share a header that grows to fill the card, so every card is
    // the same height and its CTA sits on the same baseline (see .store-rowhead).
    const head = el('div', 'store-rowhead');
    head.append(tile, rowMeta);

    function update(): void {
      updateBtn();
      openBtn.hidden = !onOpen || !isInstalled(app.id);
      const error = opError(app.id);
      err.hidden = !error;
      if (error) err.textContent = `Couldn't ${isInstalled(app.id) ? 'remove' : 'download'} the model: ${error}`;
    }
    updaters.push(update);
    update();

    const open = () => openAppDetail(app, onOpen);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    item.append(head, cta);
    rows.push({ el: item, hay: `${app.name} ${meta?.marketing?.tech || ''} ${app.description || ''}`.toLowerCase() });
    return item;
  }

  list.replaceChildren(...appList.map(row));

  // Header: a short intro + a search field (macOS-style).
  const search = el('input', 'store-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search apps';
  search.setAttribute('aria-label', 'Search apps');
  const empty = el('p', 'store-empty', 'No apps match your search.');
  empty.hidden = true;
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const match = !q || r.hay.includes(q);
      r.el.hidden = !match;
      if (match) shown++;
    }
    empty.hidden = shown > 0;
  });

  const header = el('div', 'store-header');
  header.append(
    el(
      'p',
      'store-intro',
      'Install the tools you want — they appear in the dock. On-device tools download their model on install and free it on uninstall; installs keep running in the background.',
    ),
    search,
  );

  container.replaceChildren(header, list, empty);

  const refresh = (): void => updaters.forEach((u) => u());

  // Live-update the buttons as installs progress (subscribed once).
  onProgress(refresh);

  return refresh;
}
