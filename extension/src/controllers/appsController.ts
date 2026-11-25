import { apps } from '../apps/index.js';
import { installedApps, isInstalled } from '../models/installed.js';
import { openReportIssue } from '../lib/reportIssue.js';
import { createDialog } from '../components/dialog.js';
import { renderAppDock } from '../views/appDock.js';
import { store } from '../models/store.js';
import { getAppConfig, appSettings } from '../lib/appConfig.js';
import { openAppSettings } from '../views/appSettings.js';
import type { SettingField } from '../components/appSettingsFields.js';
import { pipSupported, openPipWindow, PIP_SIZES, DEFAULT_PIP_SIZE } from '../lib/pip.js';
import { DEFAULT_ACCENT, setAccent } from '../lib/accent.js';
import {
  clearAppSession,
  getAppSession,
  getWindows,
  setAppSession,
  setWindows,
  type WindowState,
} from '../lib/appSession.js';
import { debounce } from '../lib/timing.js';
import { setAppControl } from '../lib/appControl.js';
import type { AppRenderCtx } from '../apps/index.js';

interface AppDef {
  id: string;
  name: string;
  accent?: string;
  description?: string;
  popout?: boolean;
  tip?: string;
  widget?: (ctx: unknown) => Promise<HTMLElement | null> | HTMLElement | null;
  badge?: () => Promise<number> | number;
  settings?: SettingField[];
  render: (body: HTMLElement, ctx: AppRenderCtx) => (() => void) | void;
  [key: string]: unknown;
}

interface AppWindowEntry {
  rendered: boolean;
  win: ReturnType<typeof createDialog>;
  pip?: Window | null;
  cleanup?: (() => void) | null;
  /** Set the moment Close is clicked, before the 160ms fade that precedes `onClose`.
   *
   *  Without it, closing a window and immediately reloading wrote the window back into the session
   *  as still open — `isVisible()` and `rendered` are both still true during the fade — so the app
   *  the user had just closed came back on the next load, with its old state. */
  closing?: boolean;
}

const appList = apps as unknown as AppDef[];
const installed = (): AppDef[] => installedApps() as unknown as AppDef[];
const sizeMap = PIP_SIZES as Record<string, { width: number; height: number }>;

/**
 * Tag the element an app rendered into its window body with `.app-root`, so the shared
 * window stylesheet can stretch it to fill a maximized / full-screen window.
 *
 * This replaces a hand-maintained list of app layout class names in `styles/shell.css`
 * — the kind of list this codebase keeps discovering is out of date. KimtFS was never on
 * it, so maximizing its window left the explorer at its own fixed height with dead space
 * below (#651). Deriving the root from the DOM means a new app needs no entry anywhere.
 *
 * All 19 apps mount ONE root (`body.replaceChildren(root)`), which is what makes this
 * safe: tagging several siblings would give each of them `flex: 1` and split the height
 * between them. So if an app ever leaves more than one element behind, tag nothing and
 * leave that window exactly as it was.
 *
 * Returns whether it tagged, and the caller SAYS SO when it did not. Replacing a
 * hand-maintained list with a derived one is only an improvement while the derivation
 * cannot fail quietly: an app that starts mounting two roots would otherwise just stop
 * filling a maximized window, with nothing anywhere to say why — the same silent drift
 * in a new costume.
 *
 * Exported for the test; call it straight after `render()` and before anything else
 * (a tip banner, the pop-out note) is added to the body.
 */
export function markAppRoot(body: HTMLElement): boolean {
  if (body.children.length !== 1) return false;
  body.firstElementChild?.classList.add('app-root');
  return true;
}

export function createAppsController({
  dockEl,
  onAfterClose,
  onWindowsChange,
}: {
  dockEl: HTMLElement;
  onAfterClose?: () => void;
  /** The set of running windows changed — an app opened, was minimized, or was closed.
   *
   *  Separate from `onAfterClose` because that one only fires on the way OUT. The switcher's count
   *  has to follow an app OPENING too, or the button stays hidden while apps are running — which
   *  is the very state it exists to make visible. */
  onWindowsChange?: () => void;
}) {
  // One window per app, reused. Minimizing keeps its rendered state and the
  // dock "running" dot; closing resets both so the next open starts fresh.
  const windows = new Map<string, AppWindowEntry>();

  // Each app's last-saved state, mirrored in memory so `ctx.session` can be read SYNCHRONOUSLY
  // while an app renders. The store behind it is async, so without this every `openApp` — a dock
  // click, a deep link, a handoff — would have to become async and every caller with it.
  const sessionCache = new Map<string, unknown>();

  /**
   * The windows worth remembering, in the order they were opened (the Map's own order), which is
   * also the order they are restored in and therefore their stacking.
   *
   * A window counts while it is on screen OR still mounted behind a minimize. Closing sets both
   * false, which is exactly how close drops out of the session while minimize stays in it.
   */
  const snapshot = (): WindowState[] => {
    const out: WindowState[] = [];
    for (const [id, entry] of windows) {
      if (entry.closing) continue; // on its way out — not part of the session any more
      const visible = entry.win.isVisible();
      if (!visible && !entry.rendered) continue;
      const { maximized, left, top, width, height } = entry.win.getGeometry();
      out.push({ appId: id, minimized: !visible, maximized, left, top, width, height });
    }
    return out;
  };

  // True from the moment this page starts handing its apps to another one. The teardown must still
  // run — stopping the audio is the whole point — but the SESSION must survive it: the page taking
  // over is about to restore that session, and a release that forgot it would hand the user an
  // empty desktop instead of their windows.
  let releasing = false;

  // Debounced because opening, moving and maximizing can arrive in bursts, and the session only
  // has to be right by the time the page goes away.
  //
  // The guard is INSIDE the debounced body on purpose. A write scheduled just before a release
  // fires ~200ms later, by which time the windows have closed and `snapshot()` is empty — so a
  // guard at the call sites alone would still let one stale, empty list land on top of the session
  // the other page had just claimed.
  const persist = debounce(() => {
    if (!releasing) void setWindows(snapshot());
  }, 200);

  /** The running set changed: write it down (debounced) and tell the shell (at once, so the
   *  switcher's count is never behind what is actually running). */
  const windowsChanged = (): void => {
    persist();
    onWindowsChange?.();
  };

  /**
   * Write the window list NOW, skipping the debounce.
   *
   * The debounce is what makes the page cheap during a drag, but it is also a 200ms window in which
   * the page can go away with the change still sitting in a timer that will never fire. Open an app
   * and reload immediately, or drag a window and hit reload, and the very change being made is the
   * one silently dropped — from the feature whose entire purpose is to survive a reload. The shell
   * calls this as the page is going away.
   */
  function flushWindows(): void {
    persist.cancel();
    if (!releasing) void setWindows(snapshot());
  }

  // Whether this app's floating-window button should show right now.
  const canPopOut = (app: AppDef): boolean => !!app.popout && pipSupported() && getAppConfig(app).popout !== 'off';

  // Move the app's UI into an always-on-top floating window (Google Meet style),
  // leaving a "bring it back" placeholder behind.
  async function popOut(app: AppDef, entry: AppWindowEntry): Promise<void> {
    if (entry.pip) return; // already floating
    const body = entry.win.body;

    const holder = document.createElement('div');
    holder.className = 'pip-app';
    setAccent(holder, app.accent || DEFAULT_ACCENT);
    while (body.firstChild) holder.appendChild(body.firstChild);

    const restore = (): void => {
      while (holder.firstChild) body.appendChild(holder.firstChild);
    };

    const placeholder = document.createElement('div');
    placeholder.className = 'dialog-popout-note';
    const msg = document.createElement('p');
    msg.textContent = `${app.name} is open in a floating window — keep this tab open while you browse.`;
    const back = document.createElement('button');
    back.className = 'button-secondary';
    back.textContent = 'Bring it back';
    placeholder.append(msg, back);

    const returnHome = (): void => {
      if (!entry.pip) return;
      entry.pip = null;
      restore();
      placeholder.remove();
      entry.win.setPopOutEnabled(canPopOut(app));
      entry.win.setFullscreenEnabled(true); // the app is back in this window, so it can fill the screen again
      entry.win.open(); // bring the dialog back to the front
      dock.setOpen(app.id, true);
    };

    let pip: Window;
    try {
      const size = sizeMap[String(getAppConfig(app).pipSize)] || sizeMap[DEFAULT_PIP_SIZE];
      pip = await openPipWindow({ ...size, accent: app.accent, onClose: returnHome });
    } catch {
      restore(); // unsupported/blocked — put it back, leave everything as it was
      return;
    }
    entry.pip = pip;
    pip.document.body.className = 'pip-body';
    pip.document.body.appendChild(holder);
    body.replaceChildren(placeholder);
    entry.win.setPopOutEnabled(false); // can't pop out twice
    // The app's content is in the floating window now and this one holds a placeholder, so there is
    // nothing here worth the whole display.
    entry.win.setFullscreenEnabled(false);
    back.addEventListener('click', () => pip.close());
  }

  // One-time heads-up so users discover the floating-window button.
  function maybeIntroPip(app: AppDef, entry: AppWindowEntry): void {
    if (store.get('pipNoteSeen') || !canPopOut(app)) return;
    const note = document.createElement('div');
    note.className = 'pip-intro';
    note.append(
      Object.assign(document.createElement('span'), {
        innerHTML: `<strong>New:</strong> use the floating-window button <span class="pip-intro-glyph">⧉</span> in the title bar to keep ${app.name} in a small always-on-top window while you browse other tabs.`,
      }),
    );
    const dismiss = document.createElement('button');
    dismiss.className = 'pip-intro-dismiss close-x';
    dismiss.setAttribute('aria-label', 'Got it');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => {
      note.remove();
      store.set({ pipNoteSeen: true });
    });
    note.append(dismiss);
    entry.win.body.prepend(note);
  }

  // First-time, dismiss-forever tip for any app that declares `app.tip`.
  // (`markAppRoot` runs before this, so the banner is never mistaken for the root.)
  function maybeFirstTimeTip(app: AppDef, entry: AppWindowEntry): void {
    if (!app.tip || (store.get('tipsSeen') || {})[app.id]) return;
    const note = document.createElement('div');
    note.className = 'app-tip';
    note.append(Object.assign(document.createElement('span'), { className: 'app-tip-text', textContent: app.tip }));
    const ok = document.createElement('button');
    ok.className = 'app-tip-ok';
    ok.type = 'button';
    ok.textContent = 'I understand';
    const close = document.createElement('button');
    close.className = 'close-x';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    const dismiss = (): void => {
      note.remove();
      store.set({ tipsSeen: { ...(store.get('tipsSeen') || {}), [app.id]: true } });
    };
    ok.addEventListener('click', dismiss);
    close.addEventListener('click', dismiss);
    note.append(ok, close);
    entry.win.body.prepend(note);
  }

  /**
   * Render an app into its window with the shared ctx.
   *
   * ONE place builds that ctx, so every render path hands an app the same fields and the same
   * `markAppRoot` call.
   */
  function renderApp(app: AppDef, entry: AppWindowEntry): void {
    const ctx: AppRenderCtx = {
      close: entry.win.close,
      openApp: (id) => openById(id, { reload: true }),
      session: sessionCache.get(app.id) ?? null,
      saveSession: (state: unknown) => {
        sessionCache.set(app.id, state);
        // GATED like the window list is. An app's own debounced autosave can fire after this page
        // was displaced and torn down — the timer outlives the UI — and would then write over the
        // session the page that took over is already using. A page that no longer owns the session
        // has nothing to say about it.
        if (!releasing) void setAppSession(app.id, state);
      },
    };
    entry.cleanup = app.render(entry.win.body, ctx) || null;
    if (!markAppRoot(entry.win.body))
      console.warn(
        `${app.id}: render() left ${entry.win.body.children.length} elements in the window body. ` +
          'An app must mount exactly ONE root, or it will not fill a maximized window (see markAppRoot).',
      );
    entry.rendered = true;
  }

  function openApp(app: AppDef, { reload = false, restore }: { reload?: boolean; restore?: WindowState } = {}): void {
    let entry = windows.get(app.id);
    if (!entry) {
      const e = { rendered: false } as AppWindowEntry;
      e.win = createDialog({
        title: app.name,
        // Every app window mounts at ONE standard size (720x620, .dialog-app) and is
        // maximizable — no per-app size. A consistent window on open matters more than
        // each app's ideal footprint, and any app can still Maximize for full width.
        size: 'app',
        accent: app.accent,
        maximizable: true,
        onReport: () => openReportIssue(app.id, app.name),
        // Declaring a settings schema is what puts the control in the window header —
        // no per-app wiring, exactly like a home card's off switch (#83). `appSettings`
        // is the MERGED schema, so a pop-out app that declares none of its own still
        // gets its floating-window fields (#197).
        onSettings: appSettings(app).length ? () => openAppSettings(app) : undefined,
        onPopOut: app.popout ? () => popOut(app, e) : undefined,
        onClose: () => {
          // Closing the dialog also tears down its floating window (if any).
          if (e.pip) {
            const pip = e.pip;
            e.pip = null; // returnHome (on pagehide) becomes a no-op
            pip.close();
          }
          e.rendered = false;
          // An app's render() may return a teardown fn (observers, timers, …).
          if (typeof e.cleanup === 'function') e.cleanup();
          e.cleanup = null;
          dock.setOpen(app.id, false);
          // Close FORGETS. This is what makes close different from minimize once the state is
          // written down: the next open starts on the app's initial page, like any desktop app,
          // instead of resuming a session the user deliberately ended (#1172).
          //
          // Unless this is a release, where the very same teardown runs for the opposite reason —
          // the apps are moving to another page, not being dismissed by the user.
          if (!releasing) {
            sessionCache.delete(app.id);
            void clearAppSession(app.id);
          }
          windowsChanged();
          onAfterClose?.();
        },
        // Minimize keeps everything — the app stays mounted, running and remembered; only the
        // window goes away. Persisted so the reload after it comes back to the same place.
        onMinimize: () => {
          windowsChanged();
          onAfterClose?.();
        },
        onGeometryChange: persist,
        // Fires synchronously on the click, ahead of the fade — see `closing`.
        onCloseStart: () => {
          e.closing = true;
          windowsChanged();
        },
      });
      entry = e;
      windows.set(app.id, entry);
    }
    // A handoff re-renders an already-open target so it picks up the new clip.
    if (reload && entry.rendered && !entry.pip) {
      if (typeof entry.cleanup === 'function') entry.cleanup();
      entry.cleanup = null;
      entry.rendered = false;
    }
    if (!entry.rendered) {
      renderApp(app, entry);
      maybeFirstTimeTip(app, entry);
      maybeIntroPip(app, entry);
    }
    entry.closing = false; // opening cancels any in-flight close
    // Before `open()`: applying the position is what stops it re-centring over the restored one.
    if (restore) entry.win.applyGeometry(restore);
    entry.win.setPopOutEnabled(canPopOut(app) && !entry.pip);
    // Every app can go full screen — unlike pop-out there is nothing to opt into — but not when the
    // window is showing a pop-out placeholder rather than the app itself.
    entry.win.setFullscreenEnabled(!entry.pip);
    dock.setOpen(app.id, true);
    // A minimized window is mounted and RUNNING, just not shown, so restoring one must not flash
    // it open on the way to being hidden again. Everything above still applies — the app is
    // rendered, the dock dot is lit, the switcher lists it — only the reveal is skipped.
    if (!restore?.minimized) entry.win.open();
    // Nothing to write BACK while restoring — this IS the session being read — but the shell still
    // has to hear about it, or a restored desktop comes up with the switcher reporting nothing.
    if (restore) onWindowsChange?.();
    else windowsChanged();
  }

  // Open an app by id (used by deep links and by apps handing off to each other).
  function openById(id: string, opts?: { reload?: boolean }): void {
    const app = appList.find((a) => a.id === id);
    if (app) openApp(app, opts);
  }

  // Dock click toggles: if the app's window is open on screen, close it;
  // otherwise open/restore it.
  function toggleApp(app: AppDef): void {
    const entry = windows.get(app.id);
    if (entry && entry.win.isVisible()) {
      entry.win.close();
      return;
    }
    openApp(app);
  }

  // The dock shows only installed apps; re-rendered when the set changes.
  let dock = renderAppDock(dockEl, installed(), toggleApp);

  // Refresh each installed app's dock notification badge.
  async function refreshBadges(): Promise<void> {
    await Promise.all(
      installed().map(async (app) => {
        if (!app.badge) return;
        try {
          dock.setBadge(app.id, await app.badge());
        } catch {
          dock.setBadge(app.id, 0);
        }
      }),
    );
  }

  // Re-render the dock after an install/uninstall, closing any open window whose app was just
  // removed (appController subscribes this to the install-change feed).
  function refresh(): void {
    for (const [id, entry] of windows) {
      if (!isInstalled(id) && entry.win.isVisible()) entry.win.close();
    }
    dock = renderAppDock(dockEl, installed(), toggleApp);
    refreshBadges();
  }

  // Publish the window controls so the task manager (KimtManager) and the switcher can reach them.
  // An app cannot be handed the controller through its render ctx without giving every app a remote
  // control over every other one, so the two surfaces that legitimately manage windows read it from
  // a module singleton instead — see lib/appControl.ts.
  setAppControl({
    windows: () => snapshot().map((w) => ({ id: w.appId, minimized: w.minimized })),
    stopApp: (id) => stopApp(id),
    focusApp: (id) => openById(id),
  });

  // Deep link: open an app directly with #app=<id> in the URL.
  const match = location.hash.match(/^#app=(.+)$/);
  if (match) openById(match[1]);

  /**
   * Put the desktop back the way the user left it.
   *
   * Every app's saved state is loaded BEFORE the first render, because `ctx.session` is read
   * synchronously while an app renders — loading it lazily would hand the first app a null session
   * and drop it back on its initial page, which is the exact bug this feature exists to fix.
   *
   * An app that has since been uninstalled (or whose id no longer exists after an update) is
   * skipped rather than restored: a window for an app that is gone has nothing to render.
   */
  async function restoreSession(): Promise<void> {
    // Taking the apps back after a release (the user chose 'Use here instead' on this page) means
    // this page owns the session again, so it may write to it again.
    releasing = false;
    const saved = await getWindows();
    if (!saved.length) return;

    const live = saved.filter((w) => appList.some((a) => a.id === w.appId) && isInstalled(w.appId));
    await Promise.all(
      live.map(async (w) => {
        const bag = await getAppSession(w.appId);
        if (bag !== null) sessionCache.set(w.appId, bag);
      }),
    );

    for (const w of live) {
      const app = appList.find((a) => a.id === w.appId);
      if (app) openApp(app, { restore: w });
    }
    // The list may have shrunk (an app was uninstalled between the two page loads), so write the
    // truth back rather than leaving a window that will be skipped again on every future restore —
    // and forget the state of anything dropped, which nothing else would ever clear.
    if (live.length !== saved.length) {
      const kept = new Set(live.map((w) => w.appId));
      for (const w of saved) if (!kept.has(w.appId)) void clearAppSession(w.appId);
      persist();
    }
  }

  /** Every app that is on screen or minimized right now — what the switcher lists (#1172). */
  function runningApps(): { app: AppDef; minimized: boolean }[] {
    return snapshot()
      .map((w) => ({ app: appList.find((a) => a.id === w.appId), minimized: w.minimized }))
      .filter((r): r is { app: AppDef; minimized: boolean } => Boolean(r.app));
  }

  /**
   * Give up this page's apps, because another new-tab page took over as the one that runs them.
   *
   * Closing each window runs that app's own teardown — the same path a user close takes — so a
   * playing clip stops and a held microphone is released. That is the whole cross-page fix: the
   * code that stops the audio already existed and simply never got called in the page the user
   * had walked away from (#1172).
   */
  /**
   * Close every popped-out floating window.
   *
   * A Document PiP window is a SEPARATE browser window. Closing the tab does not close it, and the
   * controller that held the reference dies with the page — so a popped-out app kept running,
   * unreachable, still holding whatever device it had. `releaseAll` handled this for a takeover;
   * an ordinary tab close never went through `releaseAll` at all.
   */
  function closePopOuts(): void {
    for (const entry of windows.values()) {
      if (!entry.pip) continue;
      const pip = entry.pip;
      entry.pip = null; // returnHome (on pagehide) becomes a no-op
      pip.close();
    }
  }

  function releaseAll(): void {
    releasing = true;
    persist.cancel(); // nothing already in flight may outlive the handover either
    for (const id of [...windows.keys()]) stopApp(id);
  }

  /**
   * Stop one app — the switcher's Stop, and the mechanism behind `releaseAll`.
   *
   * `close()` is the right call even for a MINIMIZED window: it is hidden already, so nothing
   * animates, but it still runs the one teardown path everything else uses. Reaching past it to
   * tear down by hand would be a second way to stop an app, and a second way is a second thing to
   * keep in step with the first.
   */
  function stopApp(id: string): void {
    const entry = windows.get(id);
    if (!entry) return;
    if (entry.win.isVisible() || entry.rendered) entry.win.close();
  }

  return {
    openApp,
    openById,
    refreshBadges,
    refresh,
    restoreSession,
    runningApps,
    releaseAll,
    stopApp,
    flushWindows,
    closePopOuts,
    /** Every installed app, for the switcher to check for background jobs against. */
    installedApps: installed,
  };
}
