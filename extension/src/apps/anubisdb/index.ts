// AnubisDB — the on-device data vault + explorer. Every other app stashes its
// data in one IndexedDB (`kimtos`); AnubisDB is the console over it: browse what
// each app has stored, export a per-app JSON backup (televoica.json, pdflib.json,
// …), import one back, and clear an app's data — or wipe everything — with a brief
// undo. It reads the store directly (it's the DB inspector, not a per-collection
// CRUD app); the introspection lives in introspect.ts, the labels in registry.ts.

import './anubisdb.css';
import { el, clear, escapeHtml } from '../../lib/dom.js';
import { plural } from '../../lib/format.js';
import { dataStore } from '../../lib/dataStore.js';
import { confirmDialog } from '../../components/confirm.js';
import { showSnackbar, type SnackbarOptions } from '../../components/snackbar.js';
import { downloadText, downloadBlob } from '../../lib/download.js';
import { paintAppTile, appTileGradient } from '../../components/appIcon.js';
import { TRASH, DOWNLOAD, UPLOAD, REGEN, COPY } from '../../components/icons.js';
import appMeta from './meta.js';
import { appMeta as ownerMeta } from './registry.js';
import { renderJson } from './prettyView.js';
import { scanModelStorage, type ModelUsage } from '../../lib/modelStorage.js';
import {
  scan,
  partitionItems,
  exportApp,
  importData,
  clearApp,
  clearAll,
  type Snapshot,
  type AppNode,
  type Partition,
} from './introspect.js';

const ACCENT = appMeta.accent; // Anubis gold — the guardian of your records

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// snackbar.ts is TypeScript and exports its own options — the local re-declaration that used
// to live here was a second, smaller copy of that type, cast away with `as`. Which is exactly
// how a failing Undo went unnoticed: the cast hid that the action was never awaited (#288).
const snack = (message: string, opts?: SnackbarOptions) => showSnackbar(message, opts);

// A cheap fingerprint of the data shape, so auto-refresh only re-renders when
// something actually changed (no flicker on unrelated writes or tab focus).
function snapshotSig(s: Snapshot | null): string {
  if (!s) return '';
  return s.apps
    .map(
      (a) =>
        `${a.id}:${a.count}:${a.bytes}:` + a.partitions.map((p) => `${p.kind}${p.key}${p.count}${p.bytes}`).join(','),
    )
    .join('|');
}

// A squircle app tile, reusing the shared icon system; monogram fallback for
// apps with no glyph (system / unmapped).
function tileEl(meta: { id: string; accent: string; name: string }, px: number): HTMLElement {
  const t = el('span', 'anubis-tile');
  t.style.width = `${px}px`;
  t.style.height = `${px}px`;
  if (!paintAppTile(t, { id: meta.id, accent: meta.accent })) {
    t.style.background = appTileGradient(meta.accent);
    t.append(el('span', 'anubis-mono', meta.name.slice(0, 1).toUpperCase()));
  }
  return t;
}

function textButton(
  label: string,
  icon: string,
  opts: { danger?: boolean; onClick: () => void; title?: string; disabled?: boolean },
) {
  const b = el('button', `anubis-btn${opts.danger ? ' is-danger' : ''}`) as HTMLButtonElement;
  b.type = 'button';
  b.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;
  if (opts.title) b.title = opts.title;
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', opts.onClick);
  return b;
}

async function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = el('input') as HTMLInputElement;
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()));
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Browse and manage everything Kimtos has stored on this device',
  tip: 'AnubisDB is your on-device data vault. Browse what each app has saved, export a per-app backup, or clear it. Deleting here is permanent — but you get a brief Undo.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tools — read-only. Destructive actions (clear) stay a live user
  // gesture, so the agent can inspect storage but never erase it.
  tools: [
    {
      name: 'db_summary',
      description: 'Summarise everything Kimtos has stored on this device: total size and per-app item counts.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const s = await scan();
        const lines = s.apps.map((a) => `${a.id} · ${plural(a.count, 'item')} · ${fmtBytes(a.bytes)}`).join('\n');
        return {
          ok: true,
          result: `Total ${fmtBytes(s.totalBytes)} across ${plural(s.apps.length, 'app')}:\n${lines || '(empty)'}`,
          summary: `${fmtBytes(s.totalBytes)} stored`,
        };
      },
    },
    {
      name: 'list_app_data',
      description:
        'List the stored partitions (collections, media blobs, settings) for one app, with counts and sizes. Use an app id from db_summary.',
      parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
      run: async (args: { app?: string }) => {
        const s = await scan();
        const node = s.apps.find((a) => a.id === String(args.app));
        if (!node)
          return {
            ok: false,
            result: `No stored data for "${args.app}". Known ids: ${s.apps.map((a) => a.id).join(', ') || '(none)'}.`,
            summary: 'not found',
          };
        const lines = node.partitions.map(
          (p) => `${p.kind}:${p.key} · ${plural(p.count, 'item')} · ${fmtBytes(p.bytes)}`,
        );
        return {
          ok: true,
          result: `${node.name} — ${fmtBytes(node.bytes)}:\n${lines.join('\n')}`,
          summary: `${plural(node.count, 'item')}`,
        };
      },
    },
    {
      name: 'get_record',
      description:
        "Fetch one stored record as JSON, by its collection and id (ids come from an app's own list_ tools or list_app_data).",
      parameters: {
        type: 'object',
        properties: { collection: { type: 'string' }, id: { type: 'string' } },
        required: ['collection', 'id'],
      },
      run: async (args: { collection?: string; id?: string }) => {
        const row = await dataStore.get(String(args.collection), String(args.id));
        if (!row) return { ok: false, result: `No record ${args.collection}/${args.id}.`, summary: 'not found' };
        return { ok: true, result: JSON.stringify(row, null, 2), summary: `record ${args.id}` };
      },
    },
  ],

  render(body: HTMLElement) {
    let snap: Snapshot | null = null;
    let selected: string | null = null;
    let models: { groups: ModelUsage[]; totalBytes: number } | null = null;
    let modelsOpen = true; // the Model storage panel starts expanded
    let sig = ''; // fingerprint of the last-rendered data (for auto-refresh diffing)
    const openParts = new Set<string>(); // `${kind} ${key}`
    const openRows = new Set<string>(); // record ids shown expanded
    const rawRows = new Set<string>(); // rows switched to raw-JSON view (default is Formatted)

    const root = el('div', 'anubis');
    body.replaceChildren(root);

    const partId = (p: Partition) => `${p.kind} ${p.key}`;

    // Per-user workspaces (#473): AnubisDB shows ONE workspace at a time (the active one by
    // default) and can switch to browse another read-only. Destructive actions only run on the
    // ACTIVE workspace — dataStore's deletes are active-scoped — so Clear is disabled while
    // viewing another.
    let viewedWs = dataStore.getWorkspace();
    let workspaces: Awaited<ReturnType<typeof dataStore.listWorkspaces>> = [];
    const isActiveView = (): boolean => viewedWs === dataStore.getWorkspace();
    function wsLabel(id: string): string {
      if (id === 'local') return 'This browser';
      // Data left behind by a profile that once had an account (older versions of the extension).
      return id === dataStore.getWorkspace() ? 'This browser' : `Older data ${id.slice(0, 8)}`;
    }

    async function reload(keepSelection = true) {
      snap = null;
      draw();
      [snap, workspaces] = await Promise.all([scan(viewedWs), dataStore.listWorkspaces()]);
      sig = snapshotSig(snap);
      if (!keepSelection || !snap.apps.some((a) => a.id === selected)) {
        selected = snap.apps[0]?.id ?? null;
      }
      draw();
      void refreshModels();
    }

    // Model weights live in Cache Storage, not the DB, so they're scanned
    // separately (and only on demand — the scan reads file sizes) and drawn when
    // ready, never blocking the database view.
    async function refreshModels() {
      try {
        models = await scanModelStorage();
      } catch {
        models = { groups: [], totalBytes: 0 };
      }
      draw();
    }

    // Silent auto-refresh: re-scan and re-render only when the data actually
    // changed, preserving selection + scroll (no "Reading database…" flash).
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await scan(viewedWs);
        const nextSig = snapshotSig(next);
        snap = next;
        if (nextSig === sig) return; // nothing material changed → keep the DOM
        sig = nextSig;
        if (!selected || !snap.apps.some((a) => a.id === selected)) {
          selected = snap.apps[0]?.id ?? null;
        }
        const dTop = root.querySelector('.anubis-detail')?.scrollTop ?? 0;
        const aTop = root.querySelector('.anubis-apps')?.scrollTop ?? 0;
        draw();
        const detail = root.querySelector('.anubis-detail');
        if (detail) detail.scrollTop = dTop;
        const apps = root.querySelector('.anubis-apps');
        if (apps) apps.scrollTop = aTop;
      } finally {
        refreshing = false;
      }
    }

    function nodeFor(id: string | null): AppNode | null {
      return (id && snap?.apps.find((a) => a.id === id)) || null;
    }

    // ---- toolbar --------------------------------------------------------
    function drawBar(): HTMLElement {
      const bar = el('div', 'anubis-bar');
      const total = el('div', 'anubis-total');
      if (!snap) total.textContent = 'Reading database…';
      else
        total.innerHTML =
          `<strong>${fmtBytes(snap.totalBytes)}</strong> · ${escapeHtml(plural(snap.totalCount, 'item'))} · ` +
          `${escapeHtml(plural(snap.apps.length, 'app'))}`;
      bar.append(total);

      const actions = el('div', 'anubis-bar-actions');
      actions.append(
        textButton('Refresh', REGEN, { onClick: () => reload(), title: 'Re-scan the database' }),
        textButton('Import', UPLOAD, { onClick: onImport, title: 'Restore a Kimtos or AnubisDB JSON file' }),
        textButton('Export all', DOWNLOAD, { onClick: onExportAll, title: 'Download a full backup' }),
        textButton('Clear all', TRASH, { danger: true, onClick: onClearAll, title: 'Erase all stored data' }),
      );
      // Import / Export all / Clear all act on the ACTIVE workspace, so they are disabled while
      // browsing another (read-only, #473) or when there is nothing to act on. Refresh stays live.
      if (!snap || snap.totalCount === 0 || !isActiveView())
        actions.querySelectorAll('button').forEach((b, i) => {
          if (i > 0) (b as HTMLButtonElement).disabled = true;
        });
      bar.append(actions);
      return bar;
    }

    // ---- left: app list -------------------------------------------------
    function drawApps(): HTMLElement {
      const list = el('div', 'anubis-apps');
      if (!snap) return list;
      for (const node of snap.apps) {
        const item = el('button', `anubis-app${node.id === selected ? ' is-active' : ''}`);
        item.type = 'button';
        item.append(tileEl(node, 30));
        const meta = el('div', 'anubis-app-meta');
        meta.append(el('div', 'anubis-app-name', node.name));
        meta.append(el('div', 'anubis-app-sub', `${plural(node.count, 'item')} · ${fmtBytes(node.bytes)}`));
        item.append(meta);
        item.addEventListener('click', () => {
          selected = node.id;
          draw();
        });
        list.append(item);
      }
      return list;
    }

    // ---- right: selected app detail ------------------------------------
    function drawDetail(): HTMLElement {
      const pane = el('div', 'anubis-detail');
      const node = nodeFor(selected);
      if (!snap) {
        pane.append(el('div', 'anubis-empty', 'Reading database…'));
        return pane;
      }
      if (snap.totalCount === 0) {
        const e = el('div', 'anubis-empty');
        e.innerHTML = `<strong>Nothing stored yet.</strong><br>Use an app — your notes, todos, recordings and PDFs will show up here.`;
        pane.append(e);
        return pane;
      }
      if (!node) {
        pane.append(el('div', 'anubis-empty', 'Pick an app on the left to inspect its data.'));
        return pane;
      }

      const head = el('div', 'anubis-detail-head');
      head.append(tileEl(node, 40));
      const htext = el('div', 'anubis-detail-title');
      htext.append(el('div', 'anubis-detail-name', node.name));
      htext.append(el('div', 'anubis-detail-sub', `${plural(node.count, 'item')} · ${fmtBytes(node.bytes)}`));
      head.append(htext);
      const hactions = el('div', 'anubis-detail-actions');
      hactions.append(
        textButton('Export', DOWNLOAD, { onClick: () => onExportApp(node), title: `Download ${node.id}.json` }),
        textButton('Clear', TRASH, {
          danger: true,
          onClick: () => onClearApp(node),
          disabled: !isActiveView(),
          title: isActiveView()
            ? `Delete all ${node.name} data`
            : 'Switch to the current workspace to manage its data (you are browsing read-only)',
        }),
      );
      head.append(hactions);
      pane.append(head);

      const parts = el('div', 'anubis-parts');
      for (const p of node.partitions) parts.append(drawPartition(p));
      pane.append(parts);
      return pane;
    }

    function kindBadge(kind: Partition['kind']): HTMLElement {
      const b = el('span', `anubis-kind is-${kind}`);
      b.textContent = kind === 'records' ? 'records' : kind === 'blobs' ? 'files' : 'settings';
      return b;
    }

    function drawPartition(p: Partition): HTMLElement {
      const wrap = el('div', 'anubis-part');
      const id = partId(p);
      const isOpen = openParts.has(id);

      const headBtn = el('button', `anubis-part-head${isOpen ? ' is-open' : ''}`);
      headBtn.type = 'button';
      headBtn.append(el('span', 'anubis-caret', isOpen ? '▾' : '▸'));
      headBtn.append(kindBadge(p.kind));
      headBtn.append(el('span', 'anubis-part-label', p.label));
      headBtn.append(el('span', 'anubis-part-meta', `${plural(p.count, 'item')} · ${fmtBytes(p.bytes)}`));
      headBtn.addEventListener('click', () => {
        if (openParts.has(id)) openParts.delete(id);
        else openParts.add(id);
        draw();
      });
      wrap.append(headBtn);

      if (isOpen) {
        const items = el('div', 'anubis-items');
        items.append(el('div', 'anubis-loading', 'Loading…'));
        wrap.append(items);
        // fill asynchronously so a big partition doesn't block the toggle
        void partitionItems(p, viewedWs).then((data) => {
          clear(items);
          renderItems(items, p, data);
        });
      }
      return wrap;
    }

    function copyBtn(text: string): HTMLElement {
      const b = el('button', 'anubis-icon-btn');
      b.type = 'button';
      b.title = 'Copy JSON';
      b.innerHTML = COPY;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text);
        b.classList.add('is-copied');
        setTimeout(() => b.classList.remove('is-copied'), 900);
      });
      return b;
    }

    // Formatted ⇄ Raw JSON switch + copy, shown above an expanded value.
    function viewBar(key: string, raw: boolean, json: string): HTMLElement {
      const bar = el('div', 'anubis-view-bar');
      const toggle = el('button', 'anubis-view-toggle');
      toggle.type = 'button';
      toggle.textContent = raw ? 'Formatted view' : 'Raw JSON';
      toggle.title = raw ? 'Show the readable view' : 'Show the raw JSON';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (rawRows.has(key)) rawRows.delete(key);
        else rawRows.add(key);
        draw();
      });
      bar.append(toggle, copyBtn(json));
      return bar;
    }

    function renderItems(host: HTMLElement, p: Partition, data: Awaited<ReturnType<typeof partitionItems>>) {
      if (data.records) {
        for (const r of data.records) {
          const row = el('div', 'anubis-row');
          const line = el('button', 'anubis-row-head');
          line.type = 'button';
          const open = openRows.has(`${p.key}:${r.id}`);
          line.append(el('span', 'anubis-caret', open ? '▾' : '▸'));
          line.append(el('code', 'anubis-id', r.id || '(no id)'));
          line.append(el('span', 'anubis-row-size', fmtBytes(r.bytes)));
          line.addEventListener('click', () => {
            const k = `${p.key}:${r.id}`;
            if (openRows.has(k)) openRows.delete(k);
            else openRows.add(k);
            draw();
          });
          row.append(line);
          if (open) {
            const k = `${p.key}:${r.id}`;
            const raw = rawRows.has(k);
            const box = el('div', 'anubis-json-box');
            box.append(viewBar(k, raw, r.json));
            if (raw) {
              const pre = el('pre', 'anubis-json');
              pre.textContent = r.json;
              box.append(pre);
            } else {
              box.append(renderJson(r.json));
            }
            row.append(box);
          }
          host.append(row);
        }
        if (!data.records.length) host.append(el('div', 'anubis-loading', 'Empty.'));
      } else if (data.blobs) {
        for (const bl of data.blobs) {
          const row = el('div', 'anubis-row is-blob');
          row.append(el('code', 'anubis-id', bl.key));
          row.append(el('span', 'anubis-type', bl.type));
          row.append(el('span', 'anubis-row-size', fmtBytes(bl.bytes)));
          const dl = el('button', 'anubis-icon-btn');
          dl.type = 'button';
          dl.title = 'Download this file';
          dl.innerHTML = DOWNLOAD;
          dl.addEventListener('click', async () => {
            const blob = await dataStore.getBlob(bl.key);
            if (blob) downloadBlob(blob, bl.key.replace(/[/:]/g, '_'));
          });
          row.append(dl);
          host.append(row);
        }
        if (!data.blobs.length) host.append(el('div', 'anubis-loading', 'Empty.'));
      } else if (data.kv) {
        for (const kv of data.kv) {
          const row = el('div', 'anubis-row');
          const rk = `kv:${kv.key}`;
          const raw = rawRows.has(rk);
          const line = el('div', 'anubis-row-head is-static');
          line.append(el('code', 'anubis-id', kv.key));
          line.append(el('span', 'anubis-row-size', fmtBytes(kv.bytes)));
          row.append(line);
          const box = el('div', 'anubis-json-box is-kv');
          box.append(viewBar(rk, raw, kv.json));
          if (raw) {
            const pre = el('pre', 'anubis-json');
            pre.textContent = kv.json.length > 2000 ? `${kv.json.slice(0, 2000)}…` : kv.json;
            box.append(pre);
          } else {
            box.append(renderJson(kv.json));
          }
          row.append(box);
          host.append(row);
        }
        if (!data.kv.length) host.append(el('div', 'anubis-loading', 'Empty.'));
      }
    }

    // ---- actions --------------------------------------------------------
    async function onExportAll() {
      const backup = await dataStore.exportAll();
      downloadText(JSON.stringify(backup), 'kimtos-backup.json', 'application/json');
      showSnackbar('Exported a full backup.');
    }

    async function onExportApp(node: AppNode) {
      const { filename, json } = await exportApp(node, viewedWs);
      downloadText(json, filename, 'application/json');
      showSnackbar(`Exported ${filename}.`);
    }

    async function onImport() {
      const parsed = await pickJsonFile();
      if (parsed == null) return;
      try {
        const msg = await importData(parsed);
        await reload();
        showSnackbar(`${msg}.`);
      } catch (err) {
        showSnackbar((err as Error)?.message || 'Import failed.');
      }
    }

    async function onClearApp(node: AppNode) {
      const ok = await confirmDialog(
        `Delete all ${node.name} data in ${wsLabel(dataStore.getWorkspace())}? That's ` +
          `${plural(node.count, 'item')} (${fmtBytes(node.bytes)}).`,
        { confirmLabel: 'Delete', danger: true },
      );
      if (!ok) return;
      const backup = await clearApp(node);
      await reload();
      offerUndo(`${node.name} data deleted.`, backup);
    }

    // The Undo for a destructive action, offered until it actually SUCCEEDS.
    //
    // The backup exists only in this closure — nowhere on disk. So a restore that throws used
    // to cost the user twice: the data was gone, and the single Undo that could have brought it
    // back was gone with it, silently (#288). Now a failure says so and offers the Undo again,
    // holding the same backup, for as long as it takes.
    function offerUndo(message: string, backup: Parameters<typeof importData>[0], duration = 8000): void {
      snack(message, {
        duration,
        actionLabel: 'Undo',
        onAction: async () => {
          await importData(backup);
          await reload();
        },
        actionErrorMessage: "Couldn't restore your data — nothing was brought back.",
        onActionError: () => {
          // Re-offer, with the backup intact. The user gets another go instead of a dead end.
          offerUndo('Restore failed. Your data is still deleted.', backup, 12000);
        },
      });
    }

    async function onClearAll() {
      if (!snap) return;
      const ok = await confirmDialog(
        `Erase everything Kimtos has stored for ${wsLabel(dataStore.getWorkspace())}? That's ` +
          `${plural(snap.totalCount, 'item')} (${fmtBytes(snap.totalBytes)}) across every app. Other workspaces on ` +
          `this device are not affected. Export a backup first if you're unsure.`,
        { confirmLabel: 'Erase all', danger: true },
      );
      if (!ok) return;
      const backup = await clearAll();
      await reload();
      // offerUndo restores with importData, NOT dataStore.importAll: the raw import rebuilds the
      // DB but leaves the settings erased, because the apps read chrome.storage and kv is only a
      // mirror — Undo would say the erase was undone while every app's settings stayed gone
      // (#249). And if the restore throws, the Undo is offered again rather than lost (#288):
      // after erasing EVERYTHING, a silently-failed restore is the worst outcome in the product.
      offerUndo('All Kimtos data erased.', backup);
    }

    // ---- model storage (Cache Storage, not the DB) ---------------------
    async function onClearModel(m: ModelUsage) {
      const ok = await confirmDialog(
        `Free the ${m.label} files? That's ${fmtBytes(m.bytes)}. The model re-downloads automatically the next time it's used.`,
        { confirmLabel: 'Free', danger: true },
      );
      if (!ok) return;
      await m.clear();
      await refreshModels();
      showSnackbar(`Freed ${m.label} (${fmtBytes(m.bytes)}).`);
    }

    function drawModelCard(m: ModelUsage): HTMLElement {
      const meta = ownerMeta(m.app);
      const card = el('div', 'anubis-model');
      card.append(tileEl(meta, 30));
      const info = el('div', 'anubis-model-meta');
      info.append(el('div', 'anubis-model-name', m.label));
      info.append(el('div', 'anubis-model-sub', `${meta.name} · ${plural(m.files, 'file')} · ${m.where}`));
      card.append(info);
      card.append(el('div', 'anubis-model-size', fmtBytes(m.bytes)));
      card.append(
        textButton('Free', TRASH, { danger: true, onClick: () => onClearModel(m), title: `Free ${m.label}` }),
      );
      return card;
    }

    function drawModels(): HTMLElement {
      const sec = el('section', 'anubis-models');
      const head = el('button', `anubis-models-head${modelsOpen ? ' is-open' : ''}`);
      head.type = 'button';
      head.append(el('span', 'anubis-caret', modelsOpen ? '▾' : '▸'));
      head.append(el('span', 'anubis-models-title', 'Model storage'));
      const sub = el('span', 'anubis-models-sub');
      if (!models) sub.textContent = 'Scanning…';
      else if (!models.groups.length) sub.textContent = 'No models downloaded';
      else sub.textContent = `${fmtBytes(models.totalBytes)} · ${plural(models.groups.length, 'model')}`;
      head.append(sub);
      head.addEventListener('click', () => {
        modelsOpen = !modelsOpen;
        draw();
      });
      sec.append(head);

      if (modelsOpen) {
        const bodyEl = el('div', 'anubis-models-body');
        if (!models) bodyEl.append(el('div', 'anubis-loading', 'Scanning model caches…'));
        else if (!models.groups.length)
          bodyEl.append(
            el(
              'div',
              'anubis-models-note',
              'No AI models are cached on this device yet. Apps download their models on first use.',
            ),
          );
        else {
          for (const m of models.groups) bodyEl.append(drawModelCard(m));
          bodyEl.append(
            el(
              'div',
              'anubis-models-note',
              'Model weights are cached outside the database (they’re large, immutable, and re-downloadable), so they’re not in Export/Import. Freeing one reclaims space; it re-downloads when next needed.',
            ),
          );
        }
        sec.append(bodyEl);
      }
      return sec;
    }

    // ---- compose --------------------------------------------------------
    function draw() {
      const bar = drawBar();
      const ws = drawWorkspaces();
      const bodyRow = el('div', 'anubis-body');
      bodyRow.append(drawApps(), drawDetail());
      root.replaceChildren(...([bar, ws, bodyRow, drawModels()].filter(Boolean) as HTMLElement[]));
    }

    // The workspace switcher (#473) — one row of chips, one per workspace on this device, with
    // its size; click to browse it. Shown only when there is more than one (a single-user device
    // needs no switcher). The active workspace is marked; browsing another is read-only.
    function drawWorkspaces(): HTMLElement | null {
      if (workspaces.length <= 1) return null;
      const row = el('div', 'anubis-workspaces');
      row.append(el('span', 'anubis-ws-title', 'Workspace'));
      for (const w of workspaces) {
        const chip = el('button', 'anubis-ws' + (w.id === viewedWs ? ' is-viewed' : ''));
        const isCurrent = w.id === dataStore.getWorkspace();
        chip.append(el('span', 'anubis-ws-name', wsLabel(w.id) + (isCurrent ? ' · current' : '')));
        chip.append(el('span', 'anubis-ws-size', fmtBytes(w.bytes)));
        chip.title = isCurrent ? 'The workspace in use' : 'Browse this workspace (read-only)';
        chip.addEventListener('click', () => {
          if (w.id !== viewedWs) {
            viewedWs = w.id;
            void reload();
          }
        });
        row.append(chip);
      }
      return row;
    }

    void reload(false);

    // Auto-refresh: re-scan when any app mutates the store (debounced to collapse
    // bursts like a bulk clear), and when the tab regains focus (covers writes
    // from other tabs, which the in-tab change signal can't see).
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void refresh();
      }, 400);
    };
    const offChange = dataStore.onChange(scheduleRefresh);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      if (debounce) clearTimeout(debounce);
      offChange();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  },
};

export default app;
