import { syncPipTheme } from '../lib/pip.js';
import { applyTheme, followTheme } from '../lib/theme.js';
import { syncCsConfigToDb, watchCsConfig } from '../lib/csConfigMirror.js';
import { focusTopWindowSearch } from '../lib/windowSearch.js';
import { store } from '../models/store.js';
import { apps } from '../apps/index.js';
import { askKimtAI } from '../apps/kimtai/index.js';
import { createDialog } from '../components/dialog.js';
import { createAppLauncher } from '../components/appLauncher.js';
import { renderClock, renderSubtitle } from '../views/clock.js';
import { renderSearch, isUrlLike, toUrl } from '../views/searchBar.js';
import { renderReadit } from '../views/readit.js';
import { renderWeather } from '../views/weather.js';
import { renderFocus, stopFocus } from '../views/focusTimer.js';
import { renderDockTip, stopDockTip } from '../views/tips.js';
import { maybeShowReviewNudge, openReviewPage } from '../views/reviewNudge.js';
import { renderOnboarding } from '../views/onboarding.js';
import { renderSecondaryNotice } from '../views/secondaryNotice.js';
import { createAppSwitcher } from '../views/appSwitcher.js';
import { kimtManager } from '../lib/kimtManager.js';
import {
  claimPrimary,
  focusHolder,
  publishWork,
  readHolderWork,
  releasePrimary,
  watchForDisplacement,
  watchHolderWork,
} from '../lib/pagePresence.js';
import type { HolderJob } from '../lib/presenceShared.js';
import { renderReleaseNotes, VERSION } from '../data/releaseNotes.js';
import { isInstalled, migrateInstalledApps } from '../models/installed.js';
import { onInstalledChange } from '../lib/installManager.js';
import { createBackgroundController } from './backgroundController.js';
import { createSettingsController } from './settingsController.js';
import { dataStore } from '../lib/dataStore.js';
import { createAppsController } from './appsController.js';
import { createAppStoreController } from './appStoreController.js';

interface HomeApp {
  id: string;
  widget?: (ctx: unknown) => Promise<HTMLElement | null> | HTMLElement | null;
  [key: string]: unknown;
}
const appList = apps as unknown as HomeApp[];

const $ = (id: string): HTMLElement => document.getElementById(id)!;

function applyBlur(): void {
  document.documentElement.style.setProperty('--bg-blur', `${store.get('bgBlur')}px`);
}

function renderTime(): void {
  const now = new Date();
  renderClock($('clock'), now, store.get('clock24h'));
  renderSubtitle($('subtitle'), now, store.get('name'));
}

let openAppById: ((id: string) => void) | null = null; // set once the apps controller exists

function renderSearchBar(): void {
  const layout = store.get('homeLayout');
  renderSearch($('search'), {
    layout,
    onSubmit: (q) => {
      if (layout === 'kimtai') {
        askKimtAI(q); // queue the message; the app sends it on open
        openAppById?.('kimtai');
      } else if (isUrlLike(q)) {
        window.location.href = toUrl(q);
      } else {
        // The user's OWN search provider, not one we picked — see searchBar.ts (#885).
        // This rejects when the browser has no usable provider (most concretely under the
        // enterprise policy DefaultSearchProviderEnabled=false). There is deliberately no
        // fallback: building a URL for a provider of our own choosing is the exact thing
        // that got 0.5.0 rejected. Log it, and leave the query in the box to retry — an
        // admin who disabled search meant to disable it.
        try {
          void chrome.search.query({ text: q }).catch((e: unknown) => {
            console.warn('[kimtos] search unavailable — the browser has no default provider:', e);
          });
        } catch (e) {
          console.warn('[kimtos] chrome.search is unavailable in this context:', e);
        }
      }
    },
  });
}

/** Focus the new-tab search bar (the ⌘K fallback when no window of ours has a search box). */
function focusHomeSearch(): void {
  const input = $('search').querySelector('input');
  input?.focus();
  input?.select();
}

function setupReleaseNotes(): void {
  const button = $('release-btn');
  button.textContent = `v${VERSION}`;
  const dialog = createDialog({ title: 'Release notes', size: 'lg', appDialog: false }); // one utility-dialog size (#499)
  dialog.el.classList.add('release-dialog'); // a touch wider for the changelog
  button.addEventListener('click', () => {
    renderReleaseNotes(dialog.body);
    dialog.open();
  });
}

export async function startApp(): Promise<void> {
  // store.init() already pins dataStore's workspace to the single local one — it drives the
  // pointer so the settings mirror lands in the right partition (#472).
  await store.init();
  // Re-assert the pin (a cheap no-op after store.init) and migrate a pre-workspace install's
  // data into it — BEFORE any home widget or app reads data, or the first read would hit the
  // wrong/empty partition. Drop the OLD global settings-mirror keys FIRST, so
  // migrateToWorkspaces doesn't relocate them (#472).
  dataStore.setWorkspace(store.workspaceId());
  await dataStore.migrateSettingsMirror();
  await dataStore.migrateToWorkspaces(store.workspaceId());
  await migrateInstalledApps(store.workspaceId());
  // Mirror the content-script config (chrome.storage) into the shared DB so it
  // shows in AnubisDB + rides along in backups, and keep it in step live.
  void syncCsConfigToDb();
  watchCsConfig();

  applyBlur();
  // Paint the palette BEFORE the awaits below. followTheme() further down applies it again
  // (idempotent) when it subscribes, but it cannot run until `background` exists — and holding
  // the theme until after `await background.init()` would show the page unthemed across it.
  applyTheme();
  renderTime();
  setInterval(renderTime, 15000);
  renderSearchBar();

  const background = createBackgroundController({
    layerEl: $('bg-layer'),
    barEl: $('bg-bar'),
    creditEl: $('bg-credit'),
  });
  await background.init();

  // Appearance: re-apply on every change, and do this surface's extra work with it — retint the
  // open floating (pop-out) windows, which are separate documents, and re-pick the wallpaper.
  // The side panel and the popup call the same followTheme() with no callback (#1174).
  followTheme(() => {
    syncPipTheme();
    void background.onThemeChange();
  });

  // System mode: when the OS flips light/dark, follow it for the background too
  // (the CSS visual theme already follows via @media prefers-color-scheme).
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.get('theme') === 'system') void background.onThemeChange();
  });

  // Render home widgets (today's tasks, continue-reading) and refresh badges.
  // Every app that declares a `widget` is gated by its own Settings toggle, which is
  // generated from that declaration — no hand-maintained map to fall out of step (#83).
  // Absent from `homeWidgets` means shown; only an explicit `false` hides a card.
  async function refreshHome(): Promise<void> {
    const ctx = { refresh: refreshHome, openApp: (id: string) => apps_.openById(id) };
    const hidden = store.get('homeWidgets') || {};
    const widgets = (
      await Promise.all(
        appList.map(async (app) => {
          if (!app.widget || !isInstalled(app.id)) return null;
          if (hidden[app.id] === false) return null;
          try {
            return await app.widget(ctx);
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean) as HTMLElement[];
    $('home-widgets').replaceChildren(...widgets);
    apps_.refreshBadges();
  }

  // Pinned home features (not dock apps); each can be toggled off in Settings.
  function applyReadit(): void {
    if (store.get('homeReadit')) renderReadit($('home-readit'));
    else $('home-readit').replaceChildren();
  }
  function applyWeather(): void {
    if (store.get('homeWeather')) renderWeather($('home-weather'));
    else $('home-weather').replaceChildren();
  }
  function applyFocus(): void {
    if (store.get('homeFocus')) {
      renderFocus($('home-focus'));
    } else {
      stopFocus();
      $('home-focus').replaceChildren();
    }
  }
  function applyTips(): void {
    if (store.get('homeTips')) renderDockTip($('dock-tip'));
    else {
      stopDockTip();
      $('dock-tip').textContent = '';
    }
  }

  const apps_ = createAppsController({
    dockEl: $('app-dock'),
    onAfterClose: refreshHome,
    onWindowsChange: () => refreshSwitcher(),
  });
  openAppById = (id) => apps_.openById(id);

  // The switcher: one place to see every app that is open, minimized, or still working, and to stop
  // any of them (#1172). It binds its own button and keystroke, so this is the whole wiring.
  const switcher = createAppSwitcher({
    running: () => apps_.runningApps().map(({ app, minimized }) => ({ ...app, minimized })),
    known: () => apps_.installedApps().map((app) => ({ ...app, minimized: false })),
    onPick: (id) => apps_.openById(id),
    // The orchestrator's routing, not `stopApp`. Closing the window is only right for a task that
    // IS a window; for a registered job it left the work running while the button said Stop
    // (#1212).
    onStop: (task) => kimtManager.stopTask(task),
  });
  // The count has to follow reality without the panel being open — a minimized app that is working
  // is exactly the case with no other visible sign.
  const refreshSwitcher = (): void => void switcher.refresh();

  // Single-instance + session restore (#1172). Exactly one new-tab page runs the apps, and that
  // page brings back the windows the user left. A second page is offered the two choices that make
  // sense — go to the one that is running, or take it over here — because opening a new tab was
  // never a request to duplicate a live desktop, and duplicating it is how a clip ended up playing
  // in a page the user could not reach.
  void governSession();

  async function governSession(): Promise<void> {
    const host = document.createElement('div');
    host.hidden = true;
    document.body.append(host);
    let unwatch: (() => void) | null = null;
    // Does THIS page own the session? False until the claim comes back granted and the restore has
    // run, and false again the moment it is displaced. Everything that writes the session is gated
    // on it — see the flush below, which without this gate is a session-destroying bug.
    let owns = false;
    // A claim is in flight. Both buttons on the secondary notice can lead to a takeover, and
    // neither is disabled, so without this a double-click runs two concurrent claims.
    let claiming = false;
    // Which secondary notice is on screen. A `takeOver` closure outlives its own card — the one
    // hanging off a pending `focusHolder` promise — and must not act on behalf of a card that has
    // since been replaced, or its `clear()` wipes the CURRENT card and leaves the page blank.
    let notice = 0;

    // --- telling the other tab what is at stake (#1270) ---
    //
    // A page being asked to take over could name nothing, because the holder's KimtManager is an
    // in-memory registry in a context it cannot reach. So the holder writes its rows down.
    //
    // THROTTLED, because `subscribe` fires on every progress tick — several times a second while a
    // download runs — and each publish is a `chrome.storage.session` write that wakes a listener in
    // the other tab. Leading edge so work that starts is named at once, trailing so the last state
    // is never the one that got dropped, and unchanged payloads are not written at all.
    const WORK_PUBLISH_MS = 500;
    const appNameOf = (id: string): string => apps_.installedApps().find((a) => a.id === id)?.name ?? id;
    const currentWork = (): HolderJob[] =>
      kimtManager.active().map((job) => ({
        appId: job.appId,
        name: appNameOf(job.appId),
        label: job.label(),
        ratio: job.progress(),
        savesOnStop: job.savesOnStop,
        cancellable: job.cancellable,
      }));

    let published = '';
    let cooling = false;
    let pendingPublish = false;

    /** Publish immediately, gated on `owns` — a page that does not hold the session is not doing
     *  the work, and a list from it would name jobs the takeover notice must not attribute to the
     *  holder. */
    const flushWork = (): void => {
      const jobs = owns ? currentWork() : [];
      const encoded = JSON.stringify(jobs);
      if (encoded === published) return;
      published = encoded;
      publishWork(jobs);
    };
    const scheduleWork = (): void => {
      if (cooling) {
        pendingPublish = true;
        return;
      }
      cooling = true;
      flushWork();
      setTimeout(() => {
        cooling = false;
        if (!pendingPublish) return;
        pendingPublish = false;
        scheduleWork();
      }, WORK_PUBLISH_MS);
    };
    kimtManager.subscribe(scheduleWork);

    const becomeSecondary = (holderTabId?: number): void => {
      owns = false;
      unwatch?.();
      unwatch = null;
      // Stop this page's apps. `releaseAll` runs each app's own teardown, which is what silences a
      // playing clip and releases a held microphone — the code was always there; nothing called it.
      apps_.releaseAll();
      // And stop this page's BACKGROUND WORK, which closing a window never touched (#1270). A
      // registered job is not owned by the window that started it: tearing the UI down left the
      // promise running with no owner and no surface, and whether it finished came down to whether
      // the browser got round to discarding the tab first. That is the non-determinism the notice
      // now promises is gone — so it has to actually be gone, or the sentence is the same lie in
      // better words.
      //
      // AFTER `releaseAll`, deliberately. An app's teardown is what finishes work that ends by being
      // finished — a recording is written to its history by the window closing — and by the time we
      // get here that job has already let its row go. What is left is work with nothing but a
      // detached promise holding it. `cancel` is a no-op on anything declaring `cancellable: false`,
      // which the notice names as continuing rather than promising to stop.
      for (const job of kimtManager.active()) kimtManager.cancel(job);
      // Not scheduled: the throttle could hold a stale list for half a second, and the tab reading
      // it is deciding right now.
      flushWork();
      const mine = ++notice;
      const takeOver = (): void => {
        // `claiming` alone is not enough, and the earlier version of this comment claimed it was.
        // It only blocks OVERLAPPING calls. The dead-tab path resolves its `focusHolder` promise
        // whenever the worker gets round to it — possibly after a takeover has already finished —
        // and replays `takeOver` on a page that is now primary, re-running restoreSession over a
        // live desktop: windows re-placed under the user, and anything they touched in between
        // clobbered by the stale copy read back from storage. `owns` is the test that catches it.
        if (claiming || owns || mine !== notice) return;
        clear();
        void becomePrimary(true);
      };
      const clear = renderSecondaryNotice(host, {
        // If the holder's tab has closed since we were refused, 'Switch to it' would point at
        // nothing and the button would silently do nothing — a dead end on a page that is showing
        // the user nothing else. Falling through to taking over is the only outcome left that the
        // user could have wanted.
        onSwitch:
          holderTabId == null
            ? undefined
            : () => void focusHolder(holderTabId).then((switched) => (switched ? undefined : takeOver())),
        onTakeOver: takeOver,
        // Read once, then follow it: the answer can change either way while the card is on screen.
        watchWork: (onWork) => {
          void readHolderWork().then(onWork);
          return watchHolderWork(onWork);
        },
      });
    };

    async function becomePrimary(force = false): Promise<void> {
      if (claiming) return;
      claiming = true;
      try {
        const { primary, holderTabId } = await claimPrimary({ force });
        if (!primary) {
          becomeSecondary(holderTabId);
          return;
        }
        unwatch?.(); // never stack watchers: the old one would fire a second teardown and leak
        unwatch = watchForDisplacement((holder) => becomeSecondary(holder.tabId));
        await apps_.restoreSession();
        owns = true;
        // Publish straight away rather than waiting for the first job. Restoring starts nothing, so
        // this normally writes an empty list — which REMOVES the key, clearing whatever a previous
        // life of this tab left behind before anyone can read it.
        flushWork();
      } finally {
        claiming = false;
      }
    }

    // On the way out: write the pending window state down, and hand primacy back so the next page
    // starts running apps immediately instead of being told to switch to a tab that has gone.
    //
    // `visibilitychange` as well as `pagehide` on purpose. A page can be discarded without ever
    // firing pagehide, and visibilitychange->hidden fires earlier and far more reliably; the flush
    // is idempotent, so running it twice costs one redundant write and running it zero times costs
    // the user the change they just made.
    //
    // GATED ON `owns`, and that gate is the whole safety of it. These listeners are live from here
    // on, but the claim below is a round-trip to a service worker that may be asleep. A tab opened
    // in the background and hidden during that gap would otherwise flush its own empty window map
    // straight over the real primary page's session — the feature erasing exactly what it exists to
    // keep. A page that does not own the session has nothing to write.
    const partOfLeaving = (): void => {
      if (owns) apps_.flushWindows();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') partOfLeaving();
    });
    window.addEventListener('pagehide', () => {
      partOfLeaving();
      // A popped-out app lives in a SEPARATE browser window that closing this tab does not close,
      // and the controller holding the reference dies with the page — so it would keep running,
      // unreachable, still holding whatever device it had. Only a takeover used to clean these up.
      apps_.closePopOuts();
      void releasePrimary();
      // The work list goes with primacy. `readHolderWork` would already distrust it — it belongs to
      // a page id no presence record names any more — but leaving it behind means the next tab's
      // notice depends on that guard rather than on the record simply being gone.
      //
      // NOT on `visibilitychange`, which is the other half of `partOfLeaving`. A hidden holder is
      // precisely the tab this feature exists to describe: the user hid it by opening the tab that
      // is now reading the list.
      owns = false;
      flushWork();
    });

    await becomePrimary();
  }

  // ⌘/ (Ctrl+/) opens the app launcher — a Spotlight-style search over every app,
  // installed or not (#419). It must NOT be a Space combo: macOS eats ⌘Space
  // (Spotlight) and Ctrl+Space (switch input source) before the page sees the
  // keydown, so the launcher never opened. ⌘/ reaches the page the same way the
  // working ⌘K shortcut does. Ctrl+Space is kept as a secondary for Windows/Linux,
  // where it's free. Toggle so a second press closes it.
  const launcher = createAppLauncher((id) => apps_.openById(id));
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.code !== 'Slash' && e.code !== 'Space') return;
    e.preventDefault();
    launcher.toggle();
  });

  // ⌘K / Ctrl-K is "focus a search box of ours" — the one keystroke a keyboard-driven
  // user will try first, and the shortcut Tabs is named for.
  //
  // Match the PHYSICAL key (`e.code`), never `e.key`. `e.key` is the layout-mapped
  // character, so on a non-Latin layout (Arabic, Cyrillic, Greek) the K position does not
  // report 'k' at all: the handler bailed before `preventDefault()` and Chrome's omnibox
  // took the keystroke — the browser's search instead of ours (#1162). The ⌘/ handler
  // above already had this right; this one did not.
  //
  // And `preventDefault()` UNCONDITIONALLY. The key is ours in every branch below, so
  // there is no path left that hands it back to the browser — the second way #1162
  // reproduced was the old early return for an uninstalled Tabs.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK') return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    // 1. Search inside the window you are actually in. Covers Tabs itself: its list is kept
    //    live by onTabsChanged, so focusing its box is all a re-render would have achieved.
    if (focusTopWindowSearch()) return;
    // 2. Nothing to search where you are — open the Tabs finder, as advertised.
    if (isInstalled('tabs')) {
      apps_.openById('tabs', { reload: true });
      return;
    }
    // 3. Tabs uninstalled: the new-tab search bar is the only search box left.
    focusHomeSearch();
  });

  refreshHome();
  applyReadit();
  applyWeather();
  applyFocus();
  applyTips();

  setupReleaseNotes();
  // The top-bar rate button: straight to the store's review page (and it retires the daily ask).
  $('rate-btn').addEventListener('click', openReviewPage);

  createAppStoreController({ buttonEl: $('store-btn'), onOpen: (id) => apps_.openById(id) });
  // An install/uninstall finishing (in the background) updates the dock + home.
  onInstalledChange(() => {
    apps_.refresh();
    refreshHome();
  });

  createSettingsController({
    buttonEl: $('settings-btn'),
    wallpaper: background.wallpaper,
    onApply: (patch) => {
      if ('bgBlur' in patch) applyBlur();
      // No `theme` branch: followTheme() above owns it. store.set() notifies subscribers, so the
      // same write that lands this patch re-applies the theme, retints the pop-out windows and
      // re-picks the wallpaper — for a change made HERE or on any other surface.
      if ('name' in patch || 'clock24h' in patch) renderTime();
      if ('homeLayout' in patch) renderSearchBar();
      if ('homeReadit' in patch) applyReadit();
      if ('homeWidgets' in patch) refreshHome();
      if ('homeWeather' in patch || 'weatherUnit' in patch) applyWeather();
      if ('homeFocus' in patch) applyFocus();
      if ('homeTips' in patch) applyTips();
    },
  });

  // First visit: welcome + pre-download the on-device AI models.
  if (!store.get('onboarded')) {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    renderOnboarding(overlay, {
      onDone: () => {
        renderTime(); // the greeting may now have a name
        refreshHome();
      },
    });
  } else {
    // Not on an onboarding load — the welcome overlay owns that first session, and a
    // rating ask before the user has used anything invites the wrong rating.
    maybeShowReviewNudge();
  }
}
