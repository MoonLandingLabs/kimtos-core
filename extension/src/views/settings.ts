import { DEFAULTS } from '@kimtos/config';
import { VERSION } from '../data/releaseNotes.js';
import { apps } from '../apps/index.js';
import { isInstalled } from '../models/installed.js';
// The settings-schema controls live in ONE place, shared with the per-app settings
// dialog the window-chrome gear opens (views/appSettings.ts) — see the module header.
import {
  settingField as field,
  selectControl as select,
  toggleControl as toggle,
  rangeControl,
  appSettingsFields,
  type SettingOption as Option,
  type SettingField,
} from '../components/appSettingsFields.js';
import { backgrounds } from '../models/backgrounds.js';
import { dataStore } from '../lib/dataStore.js';
import { confirmDialog } from '../components/confirm.js';
import { el } from '../lib/dom.js';
import { openReportIssue } from '../lib/reportIssue.js';
import { OPEN_SOURCE_NOTICE, REPO_URL } from '../lib/openSource.js';
import { openReviewPage } from './reviewNudge.js';
import { downloadText } from '../lib/download.js';
import { store, type Settings } from '../models/store.js';
import { restoreFullBackup } from '../lib/settingsControl.js';

type ChangeFn = (patch: Partial<Settings>) => void;

interface WallpaperItem {
  id: string;
  url: string;
  author?: string;
  custom?: boolean;
}
interface WallpaperCtx {
  list: () => Promise<WallpaperItem[]>;
  currentId: () => string | null;
  pinnedId: () => string | null;
  setCurrent: (id: string) => Promise<void>;
  setPinned: (id: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  upload: (file: File) => Promise<string>;
  restoreDefaults: () => Promise<void>;
  hiddenCount?: () => number;
}
interface SettingsCtx {
  wallpaper?: WallpaperCtx;
}

interface SettingsApp {
  id: string;
  name: string;
  /** Opting into pop-out is what generates the floating-window fields — see #197. */
  popout?: boolean;
  settings?: SettingField[];
  /** Declaring a home card is what generates its Settings toggle — see #83. */
  widget?: unknown;
  widgetLabel?: string;
  widgetHint?: string;
  [key: string]: unknown;
}
const appList = apps as unknown as SettingsApp[];

// There is deliberately no search-engine picker here. The new-tab bar submits through
// `chrome.search.query`, so the provider is whichever one the user set in their browser —
// picking it again in our settings is what got 0.5.0 rejected from the store (#885).

const starSvg = (filled: boolean): string => `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? 'currentColor' : 'none'}"
    stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"></polygon>
  </svg>`;

function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = value;
  input.placeholder = 'Your name';
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

/** The wallpaper blur slider — the shared range control in pixels. */
const blurSlider = (value: number, onInput: (v: number) => void): HTMLElement =>
  rangeControl(value, { min: 0, max: 12, step: 1, format: (v) => `${v}px` }, onInput);

function personalization(state: Settings, onChange: ChangeFn): HTMLElement {
  const panel = document.createElement('div');
  panel.append(
    field(
      'Display name',
      'Shown in the greeting',
      textInput(state.name, (v) => onChange({ name: v })),
    ),
    field(
      'Background blur',
      'Soften the wallpaper',
      blurSlider(state.bgBlur, (v) => onChange({ bgBlur: v })),
    ),
  );
  return panel;
}

const UNITS: Option[] = [
  { value: 'celsius', label: 'Celsius (°C)' },
  { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
];

const THEMES: Option[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// "Web search", not "Google search": the engine is the user's choice (Settings offers three,
// one field below) and naming one vendor here told a DuckDuckGo user their bar was Google.
const LAYOUTS: Option[] = [
  { value: 'web', label: 'Web search' },
  { value: 'kimtai', label: 'KimtAI' },
];

function preferences(state: Settings, onChange: ChangeFn): HTMLElement {
  const panel = document.createElement('div');
  panel.append(
    field(
      'Appearance',
      'Match your system, or force light / dark',
      select(THEMES, state.theme, (v) => onChange({ theme: v as Settings['theme'] })),
    ),
    groupTitle('Home layout'),
    field(
      'Search input',
      "Web search uses your browser's own search engine; KimtAI opens the AI chat with your message",
      select(LAYOUTS, state.homeLayout, (v) => onChange({ homeLayout: v as Settings['homeLayout'] })),
    ),
    field(
      '24-hour clock',
      'Off shows AM / PM',
      toggle(state.clock24h, (v) => onChange({ clock24h: v })),
    ),
    field(
      'Dock scroll hint',
      'When you have more apps than fit, briefly nudge the dock on open to show there’s more to scroll',
      toggle(state.dockScrollHint, (v) => onChange({ dockScrollHint: v })),
    ),
    field(
      'Temperature',
      'Units for the weather card',
      select(UNITS, state.weatherUnit, (v) => onChange({ weatherUnit: v })),
    ),
    groupTitle('Home screen'),
    field(
      'Pin Readit',
      'Show a trending article on the home',
      toggle(state.homeReadit, (v) => onChange({ homeReadit: v })),
    ),
    // One toggle per installed app that declares a home card. Generated, not listed:
    // declaring `widget` is what creates the toggle, so a card can never ship with no
    // way to turn it off (#83). Absent from `homeWidgets` means shown.
    ...appList
      .filter((app) => app.widget && isInstalled(app.id))
      .map((app) =>
        field(
          app.widgetLabel || `Pin ${app.name}`,
          app.widgetHint || `Show ${app.name} on the home`,
          toggle(state.homeWidgets?.[app.id] !== false, (v) =>
            onChange({ homeWidgets: { ...(state.homeWidgets || {}), [app.id]: v } }),
          ),
        ),
      ),
    field(
      'Pin weather',
      'Show local weather on the home',
      toggle(state.homeWeather, (v) => onChange({ homeWeather: v })),
    ),
    field(
      'Pin focus timer',
      'A Pomodoro timer on the home',
      toggle(state.homeFocus, (v) => onChange({ homeFocus: v })),
    ),
    field(
      'Show tips',
      'Helpful tips on the home',
      toggle(state.homeTips, (v) => onChange({ homeTips: v })),
    ),
  );
  return panel;
}

function groupTitle(text: string): HTMLParagraphElement {
  const h = document.createElement('p');
  h.className = 'settings-group';
  h.textContent = text;
  return h;
}

// Wallpaper gallery: pick a wallpaper, favorite (pin) one so it stays, or
// upload a custom one. All wallpaper logic lives in the background controller.
function wallpaperPanel(_state: Settings, _onChange: ChangeFn, ctx: SettingsCtx): HTMLElement {
  const wp = ctx?.wallpaper;
  const panel = el('div', 'wp-panel');
  if (!wp) {
    panel.append(el('p', 'field-hint', 'Wallpapers are unavailable right now.'));
    return panel;
  }

  panel.append(el('p', 'wp-hint', 'Tap a wallpaper to use it. Favorite (★) one to keep it from changing on new tabs.'));

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  const upBtn = el('button', 'button-secondary', 'Upload a wallpaper');
  upBtn.type = 'button';
  upBtn.addEventListener('click', () => file.click());
  const status = el('p', 'wp-status');
  status.hidden = true;
  panel.append(upBtn, file, status);

  const grid = el('div', 'wp-grid');
  const restoreRow = el('div', 'wp-restore');
  panel.append(grid, restoreRow);

  // Show a restore option whenever the user has removed any default wallpaper.
  function renderRestore(): void {
    restoreRow.replaceChildren();
    if (!((wp!.hiddenCount?.() ?? 0) > 0)) return;
    const btn = el('button', 'button-secondary', 'Restore default wallpapers');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      await wp!.restoreDefaults();
      refresh();
    });
    // Derived, not restated: `backgrounds` is globbed from the bundled wallpaper
    // folder, so this can never drift from what actually ships (it once said 5,
    // when there were 2).
    const n = backgrounds.length;
    restoreRow.append(
      btn,
      el('p', 'field-hint', `Brings back the ${n} wallpaper${n === 1 ? '' : 's'} that ship with KimtOS.`),
    );
  }

  function tile(b: WallpaperItem, currentId: string | null, pinnedId: string | null): HTMLElement {
    const t = el('div', 'wp-tile' + (b.id === currentId ? ' is-current' : ''));

    const thumb = el('button', 'wp-thumb');
    thumb.type = 'button';
    thumb.style.backgroundImage = `url("${b.url}")`;
    thumb.title = b.author ? `Use “${b.author}”` : 'Use this wallpaper';
    thumb.addEventListener('click', async () => {
      await wp!.setCurrent(b.id);
      refresh();
    });

    const star = el('button', 'wp-star' + (b.id === pinnedId ? ' is-on' : ''));
    star.type = 'button';
    star.title = b.id === pinnedId ? 'Remove favorite (resume rotation)' : 'Favorite — keep this wallpaper';
    star.innerHTML = starSvg(b.id === pinnedId);
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      await wp!.setPinned(b.id === pinnedId ? null : b.id);
      refresh();
    });

    t.append(thumb, star);
    if (b.author) t.append(el('span', 'wp-author', b.author));
    const del = el('button', 'wp-del', '×');
    del.type = 'button';
    del.title = b.custom ? 'Delete this wallpaper' : 'Remove this wallpaper';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const what = b.custom ? 'Delete this wallpaper?' : 'Remove this wallpaper from the gallery?';
      if (!(await confirmDialog(what))) return;
      await wp!.remove(b.id);
      refresh();
    });
    t.append(del);
    return t;
  }

  async function refresh(): Promise<void> {
    grid.replaceChildren(el('p', 'wp-loading', 'Loading…'));
    let list: WallpaperItem[];
    try {
      list = await wp!.list();
    } catch {
      grid.replaceChildren(el('p', 'field-hint', 'Couldn’t load wallpapers.'));
      return;
    }
    const currentId = wp!.currentId();
    const pinnedId = wp!.pinnedId();
    const tiles = list.map((b) => tile(b, currentId, pinnedId));
    if (tiles.length) grid.replaceChildren(...tiles);
    else grid.replaceChildren(el('p', 'wp-empty', 'No wallpapers — restore the defaults below or upload your own.'));
    renderRestore();
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    // Crop/frame the image to the screen aspect before uploading.
    let blob: Blob | null;
    try {
      const { openImageCropper } = await import('../components/imageCropper.js');
      blob = await openImageCropper(f, { aspect: window.innerWidth / window.innerHeight });
    } catch {
      blob = null;
    }
    if (!blob) return; // cancelled
    status.hidden = false;
    status.classList.remove('is-error');
    status.textContent = 'Uploading…';
    try {
      const base = (f.name || 'wallpaper').replace(/\.[^.]+$/, '');
      // The cropper returns WebP; keep the name/type consistent.
      const wallpaperFile = new File([blob], `${base}.webp`, { type: 'image/webp' });
      const id = await wp!.upload(wallpaperFile);
      await wp!.setPinned(id); // set it as the wallpaper and keep it
      status.hidden = true;
      refresh();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Upload failed.';
      status.classList.add('is-error');
    }
  });

  refresh();
  return panel;
}

function appsPanel(): HTMLElement {
  const panel = document.createElement('div');
  let any = false;

  for (const appItem of appList) {
    // The rows come from the shared renderer — the same one the app window's own
    // settings control uses (components/appSettingsFields.ts), so the two surfaces
    // cannot show different controls for the same setting.
    const rows = appSettingsFields(appItem);
    if (!rows.length) continue;
    any = true;
    panel.append(groupTitle(appItem.name), ...rows);
  }

  if (!any) panel.append(el('p', 'field-hint', 'No app settings to configure.'));
  return panel;
}

// Data: everything is stored locally; back it up / restore it (the user owns it).
function dataPanel(): HTMLElement {
  const panel = el('div', 'wp-panel');

  panel.append(
    el(
      'p',
      'wp-hint',
      'Everything your apps save on this device — notes, files, whiteboards, recordings, AI chats and more — plus your settings and preferences, stays private in this browser; nothing is uploaded. Export a full backup to keep a copy or move it to another device; importing it on a new machine restores your data and settings.',
    ),
  );

  panel.append(groupTitle('Backup'));
  const status = el('p', 'wp-status');
  status.hidden = true;

  const exportBtn = el('button', 'button-secondary', 'Export my data');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', async () => {
    const data = await dataStore.exportAll();
    const date = new Date().toISOString().slice(0, 10);
    downloadText(JSON.stringify(data), `kimtos-backup-${date}.json`, 'application/json');
  });

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json';
  file.hidden = true;
  const importBtn = el('button', 'button-secondary', 'Import a backup');
  importBtn.type = 'button';
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    status.hidden = false;
    status.classList.remove('is-error');
    status.textContent = 'Importing…';
    try {
      // ONE DOOR: import the data and adopt the settings it carries. This used to hand-roll its
      // own copy of that second half — re-deriving `settings:general`, re-implementing the
      // "app ids never contain a hyphen" rule, restoring the content-script keys. Two copies of
      // one rule, and they had already drifted: this one handled the legacy `settings:prefs`
      // backup and AnubisDB's path did not, so the same old backup restored differently
      // depending on which button the user pressed (#249). The rule lives in settingsControl.
      await restoreFullBackup(JSON.parse(await f.text()));
      status.textContent = 'Imported — reloading…';
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Import failed.';
      status.classList.add('is-error');
    }
  });

  const row = el('div', 'data-actions');
  row.append(exportBtn, importBtn, file);
  panel.append(row, status);

  // The whole-device backup lives here; per-app browsing / backup / clearing is
  // AnubisDB's job (the on-device data console), so point there for granular control.
  panel.append(
    el(
      'p',
      'field-hint',
      'Need to browse, back up, or clear one app at a time? Open AnubisDB — the on-device data console.',
    ),
  );
  return panel;
}

const BUG_SVG = `
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 9V6a3 3 0 0 1 6 0v3"></path>
    <rect x="7" y="9" width="10" height="10" rx="5"></rect>
    <path d="M3 13h4M17 13h4M4 8l3 1M20 8l-3 1M4 18l3-1M20 18l-3-1M12 12v7"></path>
  </svg>`;

const DOCS_SVG = `
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>`;

// A star inside a speech bubble — "leave a review", deliberately distinct from the
// wallpaper-favorite star in the background bar so the two never read as the same action.
const CODE_SVG = `
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 7l-5 5 5 5"></path>
    <path d="M16 7l5 5-5 5"></path>
    <path d="M14 4l-4 16"></path>
  </svg>`;

const RATE_SVG = `
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"></path>
    <path d="M12 7.6l1.15 2.35 2.6.35-1.9 1.8.47 2.55L12 13.8l-2.32 1.25.47-2.55-1.9-1.8 2.6-.35z"></path>
  </svg>`;

function linkButton(href: string, svg: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'about-link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.innerHTML = `${svg}<span>${label}</span>`;
  return a;
}

/** Same look as a link, but runs an action instead of navigating. */
function actionButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'about-link';
  b.innerHTML = `${svg}<span>${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

/** Settings -> About. Exported so a test can render it without opening the whole Settings dialog. */
export function about(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'about';
  panel.innerHTML = `
    <p class="about-name">KimtOS</p>
    <p class="about-version">Version ${VERSION}</p>
    <p class="about-text">Every new tab is a private workspace — notes, tasks, PDFs and on-device AI. Your data stays in this browser.</p>
    <p class="about-text about-open-source">${OPEN_SOURCE_NOTICE} No account, no servers.</p>
  `;

  // Report an issue opens a pre-filled GitHub issue (lib/reportIssue.ts) — nothing is sent from
  // here. Docs is a real external link; Rate goes through the shared action so it also retires
  // the once-a-day reminder.
  const links = el('div', 'about-links');
  links.append(
    actionButton(BUG_SVG, 'Report an issue', () => openReportIssue('kimtos', 'KimtOS')),
    actionButton(RATE_SVG, 'Rate KimtOS', openReviewPage),
    linkButton(REPO_URL, CODE_SVG, 'Source on GitHub'),
    linkButton(DEFAULTS.docsUrl, DOCS_SVG, 'Documentation'),
  );
  panel.append(links);
  return panel;
}

// Sidebar section icons (18px, stroke, currentColor) — the macOS System
// Settings read: an icon + label per section down the left rail.
const svg = (p: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS: Record<string, string> = {
  personalization: svg(
    '<path d="M12 3.5l1.8 4.3L18 9.6l-4.2 1.8L12 15.7l-1.8-4.3L6 9.6l4.2-1.8z"/><path d="M18.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  ),
  wallpaper: svg(
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.7"/><path d="M20.5 15.5 15 10l-8 8"/>',
  ),
  preferences: svg(
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h6M14 17h6"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="12" cy="17" r="2"/>',
  ),
  apps: svg(
    '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  ),
  data: svg(
    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6"/><path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"/>',
  ),
  about: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
};

type PanelRender = (state: Settings, onChange: ChangeFn, ctx: SettingsCtx) => HTMLElement;
interface Tab {
  id: string;
  label: string;
  render: PanelRender;
  /** Field-based panels are grouped into rounded cards (the grouped-settings read). */
  cards?: boolean;
}

const TABS: Tab[] = [
  { id: 'personalization', label: 'Personalization', render: personalization, cards: true },
  { id: 'wallpaper', label: 'Wallpaper', render: wallpaperPanel },
  { id: 'preferences', label: 'Preferences', render: preferences, cards: true },
  { id: 'apps', label: 'Apps', render: () => appsPanel(), cards: true },
  { id: 'data', label: 'Data', render: dataPanel },
  { id: 'about', label: 'About', render: () => about() },
];

// Wrap a field-based panel's rows into rounded cards, split by group titles —
// the grouped iOS/macOS settings look (a subheader above each card of rows).
function groupIntoCards(panel: HTMLElement): HTMLElement {
  const out = el('div', 'settings-groups');
  let section: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  const start = (title?: Element): void => {
    section = el('div', 'settings-section');
    if (title) section.append(title);
    card = el('div', 'settings-card');
    section.append(card);
  };
  const flush = (): void => {
    if (card && card.children.length && section) out.append(section);
    section = card = null;
  };
  for (const child of Array.from(panel.children)) {
    if (child.classList.contains('settings-group')) {
      flush();
      start(child);
    } else {
      if (!card) start();
      card!.append(child);
    }
  }
  flush();
  return out;
}

// No `state` parameter, on purpose. It used to take one, and the caller passed
// `store.get()` — a snapshot taken when the dialog opened. Changing a setting wrote the
// store but never refreshed that snapshot, so switching tabs and back re-rendered the
// OLD value while the store held the new one (#112). Every render now reads the store
// itself, so a stale snapshot is not something a caller can accidentally hand us.
export function renderSettings(
  container: HTMLElement,
  { onChange, initialTab, wallpaper }: { onChange: ChangeFn; initialTab?: string; wallpaper?: WallpaperCtx },
): void {
  const shell = el('div', 'settings-shell');
  const nav = document.createElement('nav');
  nav.className = 'settings-nav';

  const main = el('div', 'settings-main');
  const head = el('div', 'settings-head');
  const title = el('h2', 'settings-title');
  head.append(title);
  const scroll = el('div', 'settings-scroll');
  main.append(head, scroll);
  shell.append(nav, main);

  const ctx: SettingsCtx = { wallpaper };

  /** Render a panel from the CURRENT store — never a captured snapshot (#112). */
  const renderPanel = (tab: Tab): HTMLElement => {
    const content = tab.render(store.get(), onChange, ctx);
    return tab.cards ? groupIntoCards(content) : content;
  };

  // --- Search -----------------------------------------------------------------
  // There is no index. `field()` already writes every setting's label and hint into the
  // DOM (`.field-label` / `.field-hint`), so we search the panels themselves: render each
  // one off-screen and read it. A hand-written list of setting names would have to be
  // updated for every new setting and every new app's schema, and nothing would fail when
  // someone forgot — the drift that keeps biting this codebase. This way per-app settings
  // (Whisper's model size, Grammit's deep grammar) are searchable the moment they exist.
  //
  // Safe because every panel is a pure, synchronous function of (state, onChange, ctx).
  // A hit is one of two kinds, because the panels are of two kinds.
  //
  //  - `row`   — a `.field` setting (Personalization, Preferences, Apps). We hand back the
  //              LIVE control so it can be changed straight from the results.
  //  - section — Wallpaper, Data and About are built from buttons and prose, not
  //              `field()` rows. Their actions (Export my data, Restore default
  //              wallpapers) live in context: confirm dialogs, adjacent status text, a file
  //              picker. Lifting one button out of its panel would strip that context, so we
  //              take the user TO the section instead. (#118)
  interface Hit {
    tab: Tab;
    /** The app/group heading above the row, when there is one — e.g. "Grammit". */
    group: string;
    /** The live control, for a field hit. Absent on a section hit. */
    row?: HTMLElement;
  }

  function findSettings(query: string): Hit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: Hit[] = [];

    for (const tab of TABS) {
      const panel = renderPanel(tab);
      let group = '';
      let matchedAField = false;

      // Walk in document order so a `.settings-group` heading applies to the rows below it.
      for (const node of panel.querySelectorAll('.settings-group, .field')) {
        if (node.classList.contains('settings-group')) {
          group = node.textContent?.trim() ?? '';
          continue;
        }
        const label = node.querySelector('.field-label')?.textContent ?? '';
        const hint = node.querySelector('.field-hint')?.textContent ?? '';
        // The hint matters as much as the label: someone types "dark" expecting to find
        // Appearance, whose label contains no such word — but whose hint does.
        if (`${label} ${hint} ${group}`.toLowerCase().includes(q)) {
          hits.push({ tab, group, row: node as HTMLElement });
          matchedAField = true;
        }
      }

      // Section hit: the panel's own name, or anything it renders, matches — and no field
      // inside it already answered the query. This is what makes the four action-based
      // panels findable at all: "export" and "backup" are button text in Data, "KimtOS"
      // and "version" are prose in About. Matching the rendered text keeps search DERIVED
      // — there is no hand-written list of button names to fall out of step.
      if (matchedAField) continue;
      const panelText = `${tab.label} ${panel.textContent ?? ''}`.toLowerCase();
      if (panelText.includes(q)) hits.push({ tab, group: '' });
    }
    return hits;
  }

  function showResults(query: string): void {
    const hits = findSettings(query);
    title.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'result' : 'results'}` : 'No results';
    for (const b of nav.children) (b as HTMLElement).classList.remove('is-active');

    if (!hits.length) {
      const empty = el('p', 'settings-empty');
      empty.textContent = `No settings match “${query.trim()}”.`;
      scroll.replaceChildren(empty);
      return;
    }

    const out = el('div', 'settings-groups');
    for (const hit of hits) {
      const section = el('div', 'settings-section');
      // Say where it lives rather than hiding it — the point is to teach the layout,
      // not to replace it. "Background blur — in Personalization" is the answer to the
      // question the user actually asked.
      const where = el('p', 'settings-group');
      where.textContent = hit.group ? `${hit.tab.label} · ${hit.group}` : hit.tab.label;
      const card = el('div', 'settings-card');

      if (hit.row) {
        // A LIVE control from a freshly rendered panel, wired to the same `onChange` —
        // so the setting is changed from the results, with no navigation.
        card.append(hit.row);
      } else {
        // A section hit: take the user there. Its actions live in context (confirm
        // dialogs, a file picker, adjacent status text), so we open the section rather
        // than tear a button out of it (#118).
        const go = document.createElement('button');
        go.className = 'field settings-goto';
        go.innerHTML =
          `<span class="field-text"><span class="field-label">Open ${hit.tab.label}</span>` +
          `<span class="field-hint">Everything in this section</span></span>`;
        go.addEventListener('click', () => show(hit.tab));
        card.append(go);
      }

      section.append(where, card);
      out.append(section);
    }
    scroll.replaceChildren(out);
    scroll.scrollTop = 0;
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'settings-search';
  search.placeholder = 'Search settings';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (q) showResults(search.value);
    else show(TABS.find((t) => t.id === activeTabId) || TABS[0]);
  });

  let activeTabId = '';

  function show(tab: Tab): void {
    activeTabId = tab.id;
    if (search.value) search.value = '';
    for (const b of nav.children)
      (b as HTMLElement).classList.toggle('is-active', (b as HTMLElement).dataset.tab === tab.id);
    title.textContent = tab.label;
    scroll.replaceChildren(renderPanel(tab));
    scroll.scrollTop = 0;
  }

  nav.append(search);

  for (const tab of TABS) {
    const b = document.createElement('button');
    b.className = 'settings-nav-item';
    b.dataset.tab = tab.id;
    b.innerHTML = `<span class="settings-nav-icon">${ICONS[tab.id] ?? ''}</span><span>${tab.label}</span>`;
    b.addEventListener('click', () => show(tab));
    nav.append(b);
  }

  container.replaceChildren(shell);
  show(TABS.find((t) => t.id === initialTab) || TABS[0]);
}
