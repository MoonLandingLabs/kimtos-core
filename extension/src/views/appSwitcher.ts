// The switcher: everything that is running right now, in one place (#1172).
//
// Before this, the only sign an app was still alive was a dot on its dock tile — and a dot cannot
// tell you an app is minimized, cannot tell you it is halfway through a three-minute denoise, and
// cannot be clicked to stop a clip you can hear but not find. An app that is doing something the
// user cannot see or reach is the shape of the whole bug this feature exists to fix, so the fix has
// to include a way to SEE it.
//
// WHAT IT LISTS is not decided here. `lib/kimtManager.ts` is the orchestrator every piece of
// background work runs through, and it also builds the row list — open and minimized windows,
// registered jobs (downloads, transcriptions, exports) and work orphaned by a dead page.
// KimtManager (the task-manager app) renders the same answer in full. Two views of one truth: a
// second list is how one of them ends up quietly missing the thing the user is hunting for.
//
// SELF-WIRING. This view binds its own button and keystroke, so mounting it is one line in the app
// controller. That is deliberate rather than tidy-minded: `appController.ts` is a busy file several
// agents touch at once, and a view that reaches in for its own host keeps the merge surface to the
// single call that creates it.
import { kimtManager, isBackgroundWork, stopAllLabel, stopAllPrompt, type RunningTask } from '../lib/kimtManager.js';
import { paintAppTile } from '../components/appIcon.js';
import { monogram } from '../lib/format.js';
import { el, overlayHost } from '../lib/dom.js';
import { setAccent } from '../lib/accent.js';
import { confirmDialog } from '../components/confirm.js';

/** One running app, as the controller sees it. */
export interface RunningApp {
  id: string;
  name: string;
  accent?: string;
  minimized: boolean;
}

export interface AppSwitcherOptions {
  /** Every app on screen or minimized, right now. */
  running: () => RunningApp[];
  /** Every installed app, so a background job can be shown for an app with no window at all. */
  known: () => RunningApp[];
  /** Bring this app up (and un-minimize it). */
  onPick: (id: string) => void;
  /**
   * Stop this TASK — not this app.
   *
   * It takes the whole task because the right way to stop one depends on what it is: a registered
   * job is cancelled, an orphaned record is ended, a window is closed. This used to take an app id
   * and was wired to "close the window", so stopping a model download from here closed the app and
   * left the download running while the button said Stop (#1212). `kimtManager.stopTask` is the
   * routing; it stays injected so this view is still testable without the orchestrator.
   */
  onStop: (task: RunningTask) => void | Promise<void>;
}

/**
 * A tile per running app. Returns `{ open, close, toggle, refresh, destroy }`.
 *
 * `refresh` exists because the count on the button has to follow reality without the panel being
 * open — an app that is minimized and working is exactly the case the user has no other way to see.
 */
export function createAppSwitcher({ running, known, onPick, onStop }: AppSwitcherOptions) {
  const overlay = el('div', 'switcher-overlay');
  overlay.hidden = true;
  const panel = el('div', 'switcher-panel');
  overlay.append(panel);
  // An initial home; `open()` re-homes it each time, which is what actually matters (#1251).
  overlayHost().append(overlay);

  const button = document.getElementById('switcher-btn');
  const count = document.getElementById('switcher-count');

  /** The last answer from the shared collector, so a repaint stays synchronous. */
  let tasks: RunningTask[] = [];
  /** Bumped per refresh, so a slow read cannot overwrite a newer one. */
  let generation = 0;

  const isOpen = (): boolean => !overlay.hidden;

  function tile(task: RunningTask): HTMLElement {
    const item = el('div', 'switcher-item');
    if (task.accent) setAccent(item, task.accent);

    const pick = el('button', 'switcher-pick');
    pick.type = 'button';
    pick.setAttribute('aria-label', `Show ${task.name}`);

    const tileEl = el('span', 'switcher-tile');
    if (!paintAppTile(tileEl, { id: task.appId, accent: task.accent }))
      tileEl.innerHTML = `<span class="dock-mono">${monogram(task.name)}</span>`;

    const text = el('span', 'switcher-text');
    text.append(el('span', 'switcher-name', task.name));
    text.append(el('span', `switcher-state${isBackgroundWork(task) ? ' is-working' : ''}`, task.label));

    pick.append(tileEl, text);
    pick.addEventListener('click', () => {
      onPick(task.appId);
      close();
    });

    // A FAILED tile gets Retry and Dismiss instead of a Stop — the same controls, in the same
    // cases, as the KimtManager row. It used to show a Stop that called a cancel which returned
    // immediately, doing nothing (#1216); removing it without replacement would have left a failed
    // tile with no control at all.
    if (kimtManager.isFailed(task)) {
      const retry = el('button', 'task-act', 'Retry');
      retry.type = 'button';
      retry.title = `Try ${task.name} again`;
      // `refresh()` either way: on a real retry it shows the job running again, and when the record
      // was cleared between paint and click (opening the App Store drops every download failure) it
      // removes a row that would otherwise sit there absorbing clicks.
      retry.addEventListener('click', () => void kimtManager.retryTask(task).then(() => refresh()));

      const dismiss = el('button', 'task-act', 'Dismiss');
      dismiss.type = 'button';
      dismiss.title = `Clear the failure for ${task.name}`;
      dismiss.addEventListener('click', () => {
        kimtManager.dismissTask(task);
        void refresh();
      });

      item.append(pick, retry, dismiss);
      return item;
    }

    // Stopping is the point of the panel for a clip you can hear but cannot find, so it is a real
    // control on the tile — not a right-click menu item nobody discovers.
    //
    // But only where it can do something. Work declaring `cancellable: false` — an uninstall —
    // used to get one here anyway, which called a cancel that returned immediately: a button that
    // lies (#1212). The KimtManager window has always guarded this; the switcher did not.
    if (!task.cancellable) {
      item.append(pick);
      return item;
    }
    const stop = el('button', 'switcher-stop', task.kind === 'window' ? 'Close' : 'Stop');
    stop.type = 'button';
    stop.title = `${task.kind === 'window' ? 'Close' : 'Stop'} ${task.name}`;
    stop.addEventListener('click', () => {
      void Promise.resolve(onStop(task)).then(() => refresh());
    });

    item.append(pick, stop);
    return item;
  }

  function paint(): void {
    if (!tasks.length) {
      panel.replaceChildren(
        el('p', 'switcher-empty', 'Nothing is running. Open an app from the dock and it will show up here.'),
      );
      return;
    }
    const head = el('div', 'switcher-head');
    head.append(el('span', 'switcher-head-text', `Running (${tasks.length})`));
    // Hidden rather than disabled when there is nothing it could stop — a control that is present
    // but inert is the same lie the per-tile guard above avoids. `stopAllPrompt` returns '' for
    // exactly that case, so the two decisions cannot disagree.
    if (stopAllPrompt(tasks)) head.append(killAllButton());
    const grid = el('div', 'switcher-grid');
    tasks.forEach((task) => grid.append(tile(task)));
    panel.replaceChildren(head, grid);
  }

  /** Stop everything stoppable, after one confirm that says what that costs (#1213). */
  function killAllButton(): HTMLElement {
    const btn = el('button', 'batch-danger switcher-killall', 'Stop all');
    btn.type = 'button';
    btn.title = stopAllLabel(tasks);
    btn.addEventListener('click', () => {
      void (async () => {
        const message = stopAllPrompt(tasks);
        if (!message) return; // the list moved on between paint and click
        if (!(await confirmDialog(message, { confirmLabel: 'Stop all' }))) return;
        await kimtManager.stopAll(tasks);
        await refresh();
      })();
    });
    return btn;
  }

  /** Re-read from the shared collector, repaint if open, and keep the count honest either way. */
  async function refresh(): Promise<void> {
    // Refreshes are kicked off from several places — opening the panel, the top-bar button, and
    // every row action — and each awaits an async read. Without a generation the older result can
    // land last and put back a tile the user just dismissed, until something else repaints. The
    // KimtManager window has carried this guard since it was written; the switcher did not, and
    // its Dismiss test was intermittently red because of it.
    const mine = ++generation;
    const next = await kimtManager.tasks({
      known: known().map((a) => ({ id: a.id, name: a.name, accent: a.accent })),
      windows: running().map((a) => ({ id: a.id, minimized: a.minimized })),
    });
    if (mine !== generation) return; // a newer refresh already won
    tasks = next;

    const n = tasks.length;
    if (button) button.hidden = n === 0;
    if (count) {
      count.textContent = String(n);
      count.hidden = n === 0;
    }
    if (isOpen()) paint();
  }

  function open(): void {
    // Re-homed on every open, not once at construction (#1251). This overlay is built at startup
    // and merely toggled, so a host chosen back then is the page body — and if an app has since
    // gone full screen, the switcher opens UNDER it, in the layer the backdrop covers. Appending
    // an element already in the right place is a no-op, so this costs nothing the rest of the time.
    overlayHost().append(overlay);
    overlay.hidden = false;
    paint(); // whatever the last refresh knew, so the panel is never blank for a frame
    void refresh().then(() => panel.querySelector<HTMLButtonElement>('.switcher-pick')?.focus());
  }

  function close(): void {
    overlay.hidden = true;
  }

  function toggle(): void {
    if (isOpen()) close();
    else open();
  }

  // Clicking the backdrop (never the panel) dismisses, like every other overlay here.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const onKey = (e: KeyboardEvent): void => {
    if (isOpen() && e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // Cmd/Ctrl+Shift+K. It pairs with the Cmd+K that opens Tabs, and avoids Cmd+/ and Ctrl+Space
    // (the launcher). Deliberately NOT a Space combo: macOS eats those before the page sees them,
    // which is the note already recorded on the launcher's own shortcut.
    if (e.code !== 'KeyK' || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    e.preventDefault();
    toggle();
  };
  document.addEventListener('keydown', onKey);
  button?.addEventListener('click', toggle);

  void refresh();

  return {
    open,
    close,
    toggle,
    refresh,
    destroy: (): void => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    },
  };
}
