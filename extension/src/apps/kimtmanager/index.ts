// KimtManager — the task manager (#1172).
//
// The extension does a lot the user cannot see. A model download runs for minutes after the App
// Store is closed. A denoise run outlives the tab that started it (#314). An app sits minimized
// holding a microphone. Each of those already had a mechanism; none of them had a WINDOW, so the
// honest answer to "is it doing anything?" was "open things until you find out".
//
// This is that window. It holds no job state of its own: `lib/kimtManager.ts` is the orchestrator
// that every piece of background work is registered with and run by, and it also builds the row
// list. The switcher (`views/appSwitcher.ts`) renders the same list as a quick overlay. Two views,
// one truth — a second list is how one of them ends up missing the thing the user is hunting for.
import './kimtmanager.css';
import { el } from '../../lib/dom.js';
import { createEmptyState } from '../../components/emptyState.js';
import { confirmDialog } from '../../components/confirm.js';
import { installedApps } from '../../models/installed.js';
import { kimtManager, isBackgroundWork, stopAllLabel, stopAllPrompt, type RunningTask } from '../../lib/kimtManager.js';
import { paintAppTile } from '../../components/appIcon.js';
import { monogram } from '../../lib/format.js';
import { setAccent } from '../../lib/accent.js';
import appMeta from './meta.js';

/** How often the list re-reads work that has no change event of its own (windows, jobs). */
const POLL_MS = 1500;

interface Ctx {
  openApp?: (id: string) => void;
}

/** The apps a task can belong to: everything installed, by id. */
const knownApps = (): { id: string; name: string; accent?: string }[] =>
  (installedApps() as unknown as { id: string; name: string; accent?: string }[]).map((a) => ({
    id: a.id,
    name: a.name,
    accent: a.accent,
  }));

const readTasks = (): Promise<RunningTask[]> => kimtManager.currentTasks(knownApps());

const app = {
  id: appMeta.id,
  name: appMeta.name,
  accent: appMeta.accent,
  order: appMeta.order,
  description: 'Everything running in the background — downloads, jobs and open apps — in one place.',
  tip: 'Everything Kimtos is doing in the background shows up here — a model downloading, a recording being cleaned up, an app still open. Stop any of it from this window.',

  tools: [
    {
      name: 'list_running_tasks',
      description:
        'List everything Kimtos is currently doing: model downloads (with progress), background jobs, and open or minimized apps.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const tasks = await readTasks();
        if (!tasks.length) return { ok: true, result: 'Nothing is running.', summary: 'idle' };
        const lines = tasks.map((t) => `${t.appId}: ${t.label}${t.error ? ' (failed)' : ''}`);
        return { ok: true, result: lines.join('\n'), summary: `${tasks.length} running` };
      },
    },
    {
      name: 'stop_task',
      description:
        'Stop what an app is doing: cancel its download, end its background job, or close its window. Takes the app id from list_running_tasks.',
      parameters: {
        type: 'object',
        properties: { appId: { type: 'string', description: 'The app id to stop' } },
        required: ['appId'],
      },
      run: async (args: { appId?: string }) => {
        const id = String(args.appId ?? '');
        const task = (await readTasks()).find((t) => t.appId === id);
        if (!task) return { ok: false, result: `Nothing is running for "${id}".`, summary: 'not running' };
        await kimtManager.stopTask(task);
        return { ok: true, result: `Stopped ${task.appId} (${task.label}).`, summary: `stopped ${task.appId}` };
      },
    },
  ],

  render(body: HTMLElement, ctx: Ctx = {}) {
    const root = el('div', 'km');
    const list = el('div', 'km-list');
    root.append(list);
    body.replaceChildren(root);

    let stopped = false;
    // Paints are kicked off from four places (mount, the tick, the orchestrator, a stop) and each
    // awaits the task read. Without a generation the older result can land last and put a row the
    // user just stopped back on screen until the next tick corrects it.
    let generation = 0;

    function row(task: RunningTask): HTMLElement {
      const item = el('div', `km-row${task.error ? ' is-error' : ''}`);
      if (task.accent) setAccent(item, task.accent);

      const open = el('button', 'km-open');
      open.type = 'button';
      open.setAttribute('aria-label', `Show ${task.name}`);

      const tile = el('span', 'km-tile');
      if (!paintAppTile(tile, { id: task.appId, accent: task.accent })) {
        tile.innerHTML = `<span class="dock-mono">${monogram(task.name)}</span>`;
      }

      const text = el('div', 'km-text');
      text.append(el('span', 'km-name', task.name));
      text.append(el('span', `km-state${isBackgroundWork(task) ? ' is-working' : ''}`, task.label));

      // A measurable download gets a bar. Work with no ratio deliberately gets none rather than a
      // fake one: a progress bar that does not track progress is a lie the user plans around.
      if (task.ratio != null) {
        const track = el('span', 'km-bar');
        const fill = el('span', 'km-bar-fill');
        fill.style.width = `${Math.round(task.ratio * 100)}%`;
        track.append(fill);
        text.append(track);
      }

      open.append(tile, text);
      open.addEventListener('click', () => ctx.openApp?.(task.appId));

      item.append(open);

      // A FAILED row gets Retry and Dismiss instead of a Stop. It is still listed because nobody
      // has acted on it, but it is not running — so the Stop it used to show called a cancel that
      // returned immediately and did nothing at all (#1216). Hiding the button alone would have
      // been worse: a failed row has no other control, so the user would be left looking at a
      // failure they cannot clear.
      if (kimtManager.isFailed(task)) {
        const retry = el('button', 'task-act', 'Retry');
        retry.type = 'button';
        retry.title = `Try ${task.name} again`;
        // No confirm: a retry costs time and nothing else, and it is what the user came for.
        //
        // A false answer means the record was cleared between this row being painted and the click
        // — opening the App Store drops every download failure — so repaint rather than let the
        // click vanish. A button that does nothing is the defect this row exists to fix.
        retry.addEventListener('click', () => {
          void kimtManager.retryTask(task).then((ran) => (ran ? undefined : paint()));
        });

        const dismiss = el('button', 'task-act', 'Dismiss');
        dismiss.type = 'button';
        dismiss.title = `Clear the failure for ${task.name}`;
        // Nor here: this discards a notice, not work. The job already stopped.
        dismiss.addEventListener('click', () => {
          kimtManager.dismissTask(task);
          void paint();
        });

        item.append(retry, dismiss);
        return item;
      }

      // Work that cannot be safely interrupted gets NO button. An uninstall declares
      // `cancellable: false`, and rendering a Stop for it produced a control that called a cancel
      // which returned immediately — nothing happened, silently, while the tooltip promised it
      // would. A button that lies is worse than no button.
      if (task.cancellable) {
        const verb = task.kind === 'window' ? 'Close' : 'Stop';
        const stop = el('button', 'km-stop', verb);
        stop.type = 'button';
        stop.title = `${verb} ${task.name}`;
        stop.addEventListener('click', () => {
          void (async () => {
            // A download is the one the user is most likely to have waited minutes for, so it is
            // the one that asks before throwing that away.
            if (task.kind === 'download') {
              const ok = await confirmDialog(
                `Cancel the download for ${task.name}? It will start again from the beginning.`,
                { owner: root },
              );
              if (!ok) return;
            }
            // No repaint here: stopping notifies the orchestrator, and the subscription repaints
            // once. Doing both ran two passes over every app on every click.
            await kimtManager.stopTask(task);
          })();
        });
        item.append(stop);
      }
      return item;
    }

    async function paint(): Promise<void> {
      if (stopped) return; // a repaint that lands after the window closed has nothing to paint into
      const mine = ++generation;
      const tasks = await readTasks();
      if (stopped || mine !== generation) return; // a newer paint already won

      if (!tasks.length) {
        list.replaceChildren(
          createEmptyState({
            title: 'Nothing is running',
            message: 'Downloads, transcriptions and open apps show up here while they are working.',
          }),
        );
        return;
      }

      const working = tasks.filter(isBackgroundWork).length;
      const head = el('div', 'km-head');
      head.append(
        el(
          'span',
          'km-head-text',
          working ? `${working} working · ${tasks.length} running` : `${tasks.length} running`,
        ),
      );
      // Hidden rather than disabled when nothing here can be stopped — the same rule the row Stop
      // follows. `stopAllPrompt` returns '' in exactly that case, so the button and the dialog
      // cannot disagree about whether there is anything to do.
      if (stopAllPrompt(tasks)) head.append(killAll(tasks));

      const rows = el('div', 'km-rows');
      tasks.forEach((t) => rows.append(row(t)));
      list.replaceChildren(head, rows);
    }

    /** One confirm, then everything stoppable stops (#1213). */
    function killAll(tasks: RunningTask[]): HTMLElement {
      const btn = el('button', 'batch-danger km-killall', 'Stop all');
      btn.type = 'button';
      btn.title = stopAllLabel(tasks);
      btn.addEventListener('click', () => {
        void (async () => {
          const message = stopAllPrompt(tasks);
          if (!message) return; // the list moved on between paint and click
          if (!(await confirmDialog(message, { confirmLabel: 'Stop all', owner: root }))) return;
          await kimtManager.stopAll(tasks);
          // Repaint explicitly. Cancelling a JOB notifies the orchestrator, which repaints — but
          // closing a window does not: `notify()` fires only from the job lifecycle, and
          // `stopApp` is not part of it. Without this, a batch of windows left every row on
          // screen reading Open, with live Close buttons and a Stop all offering to stop what
          // was already stopped, until the 1.5s poll happened to correct it.
          await paint();
        })();
      });
      return btn;
    }

    void paint();
    // Downloads push their progress; windows and jobs have no event of their own, so they are
    // re-read on a slow tick. The interval is cleared by the teardown below — an app that leaves a
    // timer behind goes on working after its window is gone, which is the bug this app exists to
    // make visible.
    const timer = setInterval(() => void paint(), POLL_MS);
    const offProgress = kimtManager.subscribe(() => void paint());

    return () => {
      stopped = true;
      clearInterval(timer);
      offProgress();
    };
  },
};

export default app;
