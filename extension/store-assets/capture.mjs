// Capture REAL product screenshots for the Chrome Web Store listing (#1065).
//
// Boots the extension's vite dev server, drives the LOCALLY INSTALLED Chrome via
// puppeteer-core (no bundled browser download), seeds a realistic demo
// workspace, and writes raw 2x captures to extension/store-assets/captures/. The
// captures are committed, so composing the final slides (generate.mjs) never needs
// a browser — only refreshing them after a UI change does.
//
//   node extension/store-assets/capture.mjs        # from the repo root
//
// Why a plain tab works: the store falls back to a single localStorage blob when
// chrome.storage is absent (src/models/store.ts), the seeded profile holds no auth
// tokens so nothing calls a backend, and vite serves the same module graph the page
// runs — so the demo data is seeded through the apps' own local routes (jsonApi),
// not by poking IndexedDB.
//
// WHAT THESE SLIDES MAY SHOW. The UI is real — every pixel is the shipped app rendering
// the seeded records. The CONTENT is staged demo data authored here (notes, tasks, a
// board, a file tree), which is what a product screenshot is. What it must never do is
// imply a capability the product does not have. That is why NO slide shows a KimtAI
// conversation: a hand-written assistant reply would be read as the on-device model's own
// output, and the small models we ship do not write like that — the same overstatement
// CLAUDE.md's dormant-agent rule and scripts/check-agent-claims.mjs exist to stop.
// Transcription and OCR results ARE seeded (slide 6), because Whisper and Tesseract on a
// clear input are deterministic, accurate operations — a representative sample, not a
// flattering invention. Seed apps whose screenshot is true because the app really did
// render what you gave it.
//
// The dev-server readiness dance (ansi-stripped "ready in" line, settle window,
// process-group kill) is scripts/smoke-dev.mjs's — see the notes there for why the
// port announcement alone is worthless as a readiness signal.

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./captures/', import.meta.url));
const PORT = 5199; // fixed + strict, so a devbox's own `npm run dev` (5173) never collides
const URL_BASE = `http://localhost:${PORT}/`;

// The version pill falls back to a literal under `vite dev` (src/data/releaseNotes.ts —
// there is no extension manifest in a plain tab). The installed build shows the manifest
// version, so the capture restores production truth rather than photographing the stub.
const { version: MANIFEST_VERSION } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// --- the browser -----------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.KIMTOS_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error(
    'No Chrome/Chromium found. Install Google Chrome, or point KIMTOS_CHROME at a ' +
      `browser binary. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
  );
  process.exit(1);
}

// --- the seed --------------------------------------------------------------

// The demo profile is a seeded local profile under the default `local` workspace. There is no
// account, so nothing in the UI is signed in or out; every app is free, so no slide contains a
// locked tile or an upgrade button.
const WORKSPACE = 'local';
// Ten installed, not all nineteen: the dock lays them out in one clean row, and at ten it
// stops short of the bottom-right corner controls (shuffle wallpaper / favourite / full
// screen) — twelve reached far enough to hide the shuffle button behind the dock's right
// edge. The rest still appear in the App Store slide with an Install button, which is the
// honest picture anyway (a real user installs the tools they want).
const INSTALLED_APPS = [
  'tabs',
  'calculator',
  'devtools',
  'tasks',
  'kimtfs',
  'notes',
  'pdflib',
  'notaboard',
  'snaptext',
  'televoica',
];

// Persisted-store blob (src/models/store.ts shape): device fields + the workspace's
// settings. Everything here exists to make the FIRST paint the one worth photographing:
// no onboarding overlay, no dock nudge, no per-app tip banner, no live trending fetches,
// LIGHT theme to sit inside the bright gallery band the slides are framed in.
const blob = (installed, extra = {}) =>
  JSON.stringify({
    workspaceId: WORKSPACE,
    installedApps: null,
    installedAppsByUser: { [WORKSPACE]: installed },
    workspaces: {
      [WORKSPACE]: {
        onboarded: true,
        theme: 'light',
        homeReadit: false,
        dockScrollHint: false,
        pipNoteSeen: true,
        tipsSeen: Object.fromEntries(installed.map((id) => [id, true])),
        ...extra,
      },
    },
  });
const STORE_BLOB = blob(INSTALLED_APPS);
// Same apps, but the multi-window desktops hide the home widget cards, so the background
// behind the tiled windows is a clean wallpaper (clock + dock) rather than half-covered
// app cards peeking out of the gaps.
const MULTIWINDOW_BLOB = blob(INSTALLED_APPS, {
  homeWidgets: Object.fromEntries(INSTALLED_APPS.map((id) => [id, false])),
});
// The marketing site's hero swaps a dark and a light shot by theme (www TheHero.vue), so
// the same new tab is captured twice. Its hero images are generated from THIS pipeline —
// they were hand-made once and went stale, still advertising v0.1.0 long after 1.0.x.
const DARK_BLOB = blob(INSTALLED_APPS, { theme: 'dark' });

// Runs IN THE PAGE. Seeds Notes, Tasks, NotaBoard and KimtFS through their own local
// routes, so every record is exactly what the UI itself writes.
async function seedDemoData({ today }) {
  const { jsonApi } = await import('/src/lib/api.ts');

  const travel = await jsonApi('POST', 'collections', { name: 'Trip planning' });
  await jsonApi('POST', `collections/${travel.id}/pages`, {
    title: 'Kyoto in October',
    content: '# Kyoto in October\n\n- Fushimi Inari at sunrise\n- Day trip to Nara\n- Book ryokan by August\n',
  });

  const ideas = await jsonApi('POST', 'collections', { name: 'Product ideas' });
  await jsonApi('POST', `collections/${ideas.id}/pages`, {
    title: 'Offline-first sync',
    content:
      '# Offline-first sync\n\nSketch: keep the source of truth on the device, ' +
      'reconcile opportunistically. The interesting part is conflict UX, not transport.\n',
  });

  // Seeded LAST, so it is the most recently updated page — the one the Notes
  // window opens on. This is the note the screenshot shows: give it real bones.
  const reading = await jsonApi('POST', 'collections', { name: 'Reading list' });
  await jsonApi('POST', `collections/${reading.id}/pages`, {
    title: 'Papers to read',
    content: '# Papers to read\n\n- Out of the Tar Pit\n- End-to-End Arguments in System Design\n',
  });
  await jsonApi('POST', `collections/${reading.id}/pages`, {
    title: 'The Pragmatic Programmer',
    content:
      '# The Pragmatic Programmer\n\nNotes from the 20th-anniversary edition.\n\n' +
      '## Worth keeping\n\n' +
      '- Fix broken windows early — small messes normalize bigger ones\n' +
      '- DRY is about *knowledge*, not code\n' +
      '- Good design is easier to change than bad design\n' +
      '- Crash early: a dead program does less damage than a crippled one\n\n' +
      '## To try this week\n\n' +
      '1. Trace one bug end-to-end before touching the fix\n' +
      '2. Write the test that would have caught it\n',
  });

  const done = await jsonApi('POST', 'todos', { title: 'Morning run', date: today });
  await jsonApi('PATCH', `todos/${done.id}`, { done: true });
  await jsonApi('POST', 'todos', { title: 'Review the launch checklist', date: today });
  await jsonApi('POST', 'todos', { title: 'Reply to Sara about the design review', date: today });
  await jsonApi('POST', 'todos', { title: "Prepare Friday's demo", date: today });

  // KimtFS: a small, realistic file tree. Folders first (the routes return the ids the
  // children hang off), then text files with real contents.
  const mk = async (name, parentId = '') => (await jsonApi('POST', 'kimtfs/folders', { parentId, name })).id;
  const write = (name, parentId, text) => jsonApi('POST', 'kimtfs/files', { parentId, name, text });

  const projects = await mk('Projects');
  const launch = await mk('Launch', projects);
  await write('checklist.md', launch, '# Launch checklist\n\n- [x] Privacy policy\n- [ ] Store listing\n- [ ] Docs\n');
  await write('pricing-notes.md', projects, '# Pricing\n\nKeep the pricing page simple.\n');

  const writing = await mk('Writing');
  await write('essay-draft.md', writing, '# On owning your tools\n\nA draft.\n');
  await write('reading.md', writing, '# Reading\n\n- Out of the Tar Pit\n');

  await mk('Screenshots');
  await mk('Invoices');
  await mk('Recipes');
  // Root-level files, so the folder view is a full, believable home directory rather
  // than four lonely rows.
  await write('scratch.txt', '', 'Anything you paste here stays on this device.\n');
  await write('todo.md', '', '# Today\n\n- Ship the listing\n- Call the accountant\n');
  await write('keys.md', '', '# Recovery notes\n\nKept on this device only.\n');
  await write('quotes.txt', '', 'Good design is easier to change than bad design.\n');
  await write('meeting-notes.md', '', '# Monday sync\n\n- Screenshots signed off\n- Docs next\n');
  await write('budget-2026.md', '', '# Budget\n\nHosting, domain, the store fee.\n');
  await write('interview-questions.md', '', '# Questions\n\n- What did you change your mind about?\n');
  await write('packing-list.txt', '', 'Passport\nCharger\nThe good headphones\n');
  await write('bookmarks.md', '', '# Worth re-reading\n\n- The Grug Brained Developer\n');
  await write('ideas.md', '', '# Ideas\n\n- A tiny tool that does one thing well\n');

  // NotaBoard: a small, tidy sticky-note board. Elements are the same shape the engine
  // writes (engine.ts NBElement), so this is a genuine board, not a mock-up.
  const note = (x, y, color, text) => ({
    id: Math.random().toString(36).slice(2, 10),
    type: 'note',
    color,
    size: 4,
    points: [],
    x,
    y,
    w: 200,
    h: 150,
    text,
    fontScale: 1,
  });
  await jsonApi('POST', 'boards', {
    title: 'Launch plan',
    paper: 'grid',
    theme: 'light',
    elements: [
      note(80, 70, '#fde68a', 'Ship the new tab\nwith all apps free\nto try'),
      note(320, 70, '#bfdbfe', 'On-device AI:\nno server, no\nsign-up to test'),
      note(560, 70, '#bbf7d0', 'Docs + booklets\nfor every app'),
      note(80, 260, '#fbcfe8', 'Store listing:\nreal screenshots,\nnot mock-ups'),
      note(320, 260, '#ddd6fe', 'Privacy page in\nplain English'),
      note(560, 260, '#fed7aa', 'Ask 5 people to\ntry it cold and\nwatch them'),
    ],
  });

  // Voice to Text + Image to Text: a finished result each, so slide 6 shows real output,
  // not an empty dropzone. These two apps have no local routes — they persist straight to
  // dataStore under history:<id> (HistoryEntry: { text, at, name, from, srcId }). Text-only
  // (no blobKey) is a valid entry that renders its transcript/extracted text in the main
  // pane. Showing a transcript or OCR result is honest: transcription (Whisper) and OCR
  // (Tesseract) of a clear input are deterministic, accurate operations — a representative
  // sample, unlike an open-ended LLM reply (which is why KimtAI stays on its welcome state).
  const { dataStore } = await import('/src/lib/dataStore.ts');
  await dataStore.put('history:televoica', {
    name: 'Team standup — voice note',
    at: Date.now(),
    from: null,
    srcId: null,
    text:
      'Morning everyone. The store screenshots are done and signed off — all five surfaces plus ' +
      "the multi-window shots. I'll open the pull request after standup. The only thing left is " +
      "the privacy page copy, which I'll pair on with Sara this afternoon. No blockers otherwise.",
  });
  await dataStore.put('history:snaptext', {
    name: 'Receipt — screenshot',
    at: Date.now(),
    from: null,
    srcId: null,
    text:
      'BLUE BOTTLE COFFEE\n123 Market Street\n\nPour Over          4.50\nCroissant          3.75\n' +
      'Subtotal           8.25\nTax                0.74\nTotal              8.99\n\nThank you!',
  });
}

// --- dev server ------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- the ANSI escape IS the thing being stripped
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const READY = /ready in \d/i;
const FAILED = /\bERROR\b|builder failed|Cannot find module|Failed to load/i;
const BOOT_TIMEOUT_MS = 180_000;

function bootDevServer() {
  const child = spawn('npm', ['run', 'dev', '-w', '@kimtos/extension', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    detached: true, // own process group, so the whole tree dies at the end
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return new Promise((resolve, reject) => {
    let log = '';
    // Settle exactly once, and cancel the boot timer the moment we do: fail() has a
    // real side effect now (it kills the group), so a stray timeout firing after a
    // successful boot — or a post-boot log line that happens to match FAILED — must
    // be a no-op, not a SIGKILL under an in-progress capture.
    let settled = false;
    let bootTimer;
    const settleOnce = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(bootTimer);
      return true;
    };
    // A failed boot must kill the group it spawned: the server is detached, and a
    // survivor squats on the fixed strict port, failing every run after this one.
    const fail = (err) => {
      if (!settleOnce()) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* never started or already gone */
      }
      reject(err);
    };
    const onData = (chunk) => {
      log += stripAnsi(String(chunk));
      if (FAILED.test(log)) fail(new Error(`dev server errored:\n${log}`));
      else if (READY.test(log) && settleOnce()) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', fail);
    child.on('exit', (code) => {
      if (settleOnce()) reject(new Error(`dev server exited with ${code}:\n${log}`)); // already dead: no kill needed
    });
    bootTimer = setTimeout(
      () => fail(new Error(`dev server not ready in ${BOOT_TIMEOUT_MS / 1000}s:\n${log}`)),
      BOOT_TIMEOUT_MS,
    );
  });
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// --- capture ---------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const server = await bootDevServer();
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true, // fresh temp profile every run — captures are deterministic
    args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  // Before ANY page script runs, on every navigation: the pre-onboarded store blob.
  await page.evaluateOnNewDocument((blob) => localStorage.setItem('kimtos', blob), STORE_BLOB);

  const shot = async (hash, waitFor, name, { settleMs = 0, prepare } = {}) => {
    await page.goto('about:blank'); // the #hash deep links are read once at startup
    await page.goto(URL_BASE + hash, { waitUntil: 'networkidle0' });
    await page.waitForSelector(waitFor, { visible: true });
    // Production truth for the version pill (see MANIFEST_VERSION above).
    await page.evaluate((v) => {
      const pill = document.getElementById('release-btn');
      if (pill) pill.textContent = `v${v}`;
    }, MANIFEST_VERSION);
    if (prepare) await prepare();
    await page.evaluate(() => document.fonts.ready);
    await settle(1500 + settleMs); // wallpaper decode, dialog transition, widget paint
    await page.screenshot({ path: `${OUT}${name}` });
    console.log(`captured ${name}`);
  };

  // First boot: seed through the apps' own routes, then reload so the home rail
  // renders the widget cards from the seeded data.
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-dock button');
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local tz
  await page.evaluate(seedDemoData, { today });

  await shot('', '#app-dock button', 'home.png');
  await shot('#app=notes', '.dialog-app', 'notes.png', {
    settleMs: 700,
    // Maximize the window and switch to the Split view: sidebar tree + markdown +
    // rendered preview — the whole app in one frame.
    prepare: async () => {
      await page.click('.dialog-app .window-max');
      await settle(600); // maximize transition + responsive relayout
      await page.evaluate(() => {
        const tab = [...document.querySelectorAll('.dialog-app button.tab')].find((b) => b.textContent === 'Split');
        if (tab) tab.click();
        // Open the meatiest page by name: two pages seeded in the same millisecond sort
        // arbitrarily, and the window opened whichever won.
        const page_ = [
          ...document.querySelectorAll('.dialog-app .doc-sidebar button, .dialog-app .doc-sidebar a'),
        ].find((b) => b.textContent?.trim() === 'The Pragmatic Programmer');
        page_?.click();
      });
      await settle(500); // page load + preview render
    },
  });
  await shot('#store', '.store-dialog', 'store.png', {
    settleMs: 500,
    // Maximized, like Notes: the un-maximized dialog left home cards peeking in
    // behind it and cut the third row of apps mid-card — the frame should be
    // all store.
    prepare: async () => {
      await page.click('.store-dialog .window-max');
      await settle(600); // maximize transition + card grid relayout
    },
  });
  await shot('#app=kimtfs', '.dialog-app', 'kimtfs.png', {
    settleMs: 700,
    // List view, not grid: maximized, the grid puts every tile on ONE row and leaves
    // two thirds of the window empty. The list fills the frame and shows the columns
    // (size, kind, modified) that make it read as a real file manager.
    prepare: async () => {
      await page.click('.dialog-app .window-max');
      await settle(600);
    },
  });
  await shot('#app=notaboard', '.dialog-app', 'notaboard.png', {
    settleMs: 900,
    // NotaBoard auto-opens its only board on init, so there is nothing to click —
    // just maximize and let the canvas paint.
    prepare: async () => {
      await page.click('.dialog-app .window-max');
      await settle(900); // maximize transition + canvas paint
    },
  });

  // --- the marketing site's hero, dark ---------------------------------------
  // Same new tab as home.png, in the dark theme, for www's theme-swapped hero. Its own
  // page so the dark store blob is installed before any script runs.
  const darkPage = await browser.newPage();
  await darkPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await darkPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await darkPage.evaluateOnNewDocument((b) => localStorage.setItem('kimtos', b), DARK_BLOB);
  await darkPage.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await darkPage.waitForSelector('#app-dock button', { visible: true });
  await darkPage.evaluate((v) => {
    const pill = document.getElementById('release-btn');
    if (pill) pill.textContent = `v${v}`;
  }, MANIFEST_VERSION);
  await darkPage.evaluate(() => document.fonts.ready);
  await settle(1800); // wallpaper decode + widget paint
  await darkPage.screenshot({ path: `${OUT}home-dark.png` });
  console.log('captured home-dark.png');

  // --- multi-window slides -------------------------------------------------
  // A second page whose init-script hides the home widget cards, so the wallpaper behind
  // the tiled windows stays clean. IndexedDB is per-origin, so the demo data seeded above
  // is already visible here.
  const deskPage = await browser.newPage();
  // Every slide starts from an empty desktop (see `desktop`): wipe the session before page scripts run.
  await deskPage.evaluateOnNewDocument(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* no storage */
    }
  });
  await deskPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await deskPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await deskPage.evaluateOnNewDocument((b) => localStorage.setItem('kimtos', b), MULTIWINDOW_BLOB);

  // Open each named app through the app launcher (⌘/), not the dock: a window centres
  // itself over the dock on open, so a second dock click would land on that window and
  // the app would never open. The launcher is a top overlay nothing can cover — type the
  // name, Enter opens the top match. Then tile all the windows to their slots at once.
  // `is-sized` drops the responsive max-caps so the exact geometry sticks.
  const desktop = async (name, apps, layout, { reveal = false, after } = {}) => {
    // Each slide starts from an empty desktop: the open-window session is kept in
    // sessionStorage, so the previous slide's windows would otherwise be restored.
    await deskPage.goto('about:blank');
    await deskPage.goto(URL_BASE, { waitUntil: 'networkidle0' });
    await deskPage.waitForSelector('#app-dock button');
    await deskPage.evaluate((v) => {
      const pill = document.getElementById('release-btn');
      if (pill) pill.textContent = `v${v}`;
    }, MANIFEST_VERSION);
    for (let i = 0; i < apps.length; i++) {
      // ⌘/ (Ctrl+/) — the handler matches e.code === 'Slash' with a meta/ctrl modifier.
      await deskPage.keyboard.down('Control');
      await deskPage.keyboard.press('Slash');
      await deskPage.keyboard.up('Control');
      await deskPage.waitForSelector('.launcher-search', { visible: true });
      const box = await deskPage.$('.launcher-search');
      await box.click({ clickCount: 3 }); // select any leftover text
      await box.type(apps[i]);
      await settle(250); // filter paint
      await deskPage.keyboard.press('Enter');
      await deskPage.waitForFunction((n) => document.querySelectorAll('.dialog.dialog-app').length === n, {}, i + 1);
      await settle(350);
    }
    // Tile in TWO phases. Changing a window's size fires the dialog's own ResizeObserver,
    // which re-centres it — so set size first, let that re-centre settle, THEN set the
    // position. Position changes no size, so nothing re-fires and the placement sticks.
    await deskPage.evaluate((rects) => {
      document.querySelectorAll('.dialog.dialog-app').forEach((el, i) => {
        const r = rects[i];
        if (!r) return;
        el.classList.add('is-sized');
        el.style.width = `${r.w}px`;
        el.style.height = `${r.h}px`;
      });
    }, layout);
    await settle(800); // the re-centre + internal relayout at the new size
    await deskPage.evaluate((rects) => {
      document.querySelectorAll('.dialog.dialog-app').forEach((el, i) => {
        const r = rects[i];
        if (!r) return;
        el.style.left = `${r.x}px`;
        el.style.top = `${r.y}px`;
      });
    }, layout);
    if (reveal) {
      // Open each window's first history entry, so a media app shows its RESULT (the
      // seeded transcript / extracted text) instead of the empty input dropzone. The
      // entry is in the DOM even when the sidebar has collapsed to a hamburger at this
      // width. A window with no history (nothing seeded) has no entry — a harmless no-op.
      await deskPage.evaluate(() => {
        document.querySelectorAll('.dialog.dialog-app').forEach((el) => {
          el.querySelector('.mt-history-open')?.click();
        });
      });
      await settle(700); // result render
    }
    // Per-slide UI driving (type an input, press a button) once the windows are placed.
    if (after) await after();
    await deskPage.evaluate(() => document.fonts.ready);
    await settle(500);
    await deskPage.screenshot({ path: `${OUT}${name}` });
    console.log(`captured ${name}`);
  };

  /** The window whose title bar reads `title` (windows are tiled by open order). */
  const windowOf = (title) =>
    deskPage.evaluateHandle((t) => {
      return [...document.querySelectorAll('.dialog.dialog-app')].find(
        (el) => el.querySelector('.dialog-title')?.textContent?.trim() === t,
      );
    }, title);

  // Slide 6 — two tools side by side, each showing a real result it produced.
  await desktop(
    'tools.png',
    ['Voice to Text', 'Image to Text'],
    [
      { x: 60, y: 96, w: 566, h: 612 },
      { x: 654, y: 96, w: 566, h: 612 },
    ],
    { reveal: true },
  );

  // Slide 7 — three tools at once, all of them CONTENT-FULL. The earlier trio (KimtAI +
  // Denoise + Clipboard) always read as sparse because two of those apps have nothing to
  // show until a model runs: an empty chat and an empty dropzone. These three always have
  // real content — formatted JSON, a checklist, a finished calculation — so every window
  // in the frame is doing something.
  //
  // THREE COLUMNS, not a stack. `is-sized` drops only the responsive MAX caps; `.dialog`
  // keeps `min-height: min(550px,88vh)` and `min-width: min(350px,96vw)` (shell.css). Two
  // windows therefore cannot sit one above the other in an 800px-tall viewport — asking
  // for a 330px-tall window silently yields 550px, which is what made earlier layouts
  // overlap and run off the bottom edge.
  await desktop(
    'multitask.png',
    ['DevTools', 'Tasks', 'Calculator'],
    [
      { x: 16, y: 80, w: 520, h: 640 },
      { x: 550, y: 80, w: 350, h: 640 },
      { x: 914, y: 80, w: 350, h: 640 },
    ],
    {
      after: async () => {
        // DevTools: the number-base converter, not JSON. DevTools keeps a ~225px tool
        // sidebar at every width, so a three-across window leaves too little room for
        // JSON's side-by-side panes (the text wraps to a few characters a line). A
        // label/value row tool reads cleanly narrow, and base values are short enough
        // that none of them truncate — Color's `rgb(...)`/`hsl(...)` did. 1248 is the
        // same number the calculator is working on, so the two windows rhyme.
        const dev = await windowOf('DevTools');
        await dev.evaluate((el) => {
          [...el.querySelectorAll('.dk-nav *')].find((n) => n.textContent?.trim() === 'Number base')?.click();
        });
        await settle(400); // tool swap
        await dev.evaluate((el) => {
          const dec = el.querySelector('.dk-row-value'); // first row is Decimal
          if (!dec) return;
          dec.value = '1248';
          dec.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(300);
        // Calculator: focus the pad and type a sum, so the display shows a real answer
        // rather than a bare 0. The pad handles keydown itself once focused.
        const calc = await windowOf('Calculator');
        await calc.evaluate((el) => el.querySelector('.calc')?.focus());
        await deskPage.keyboard.type('1248*12', { delay: 40 });
        await deskPage.keyboard.press('Enter');
        await settle(300);
      },
    },
  );
} finally {
  // The two cleanups are independent: a browser that crashed mid-capture must
  // not leave the dev server squatting on the strict port.
  try {
    if (browser) await browser.close();
  } catch {
    /* already gone */
  }
  try {
    process.kill(-server.pid, 'SIGKILL'); // negative pid: the whole process group
  } catch {
    /* already gone */
  }
}

console.log(`\nRaw captures in ${OUT}`);
process.exit(0); // vite's esbuild workers keep handles open; mirror smoke-dev.mjs
