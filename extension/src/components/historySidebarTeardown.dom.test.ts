// A sidebar whose window has been torn down must not redraw it.
//
// `draw()` awaits the host's `load()`, and everything after that await builds DOM. So a draw that
// began while the window was open resumes after it has closed: it rebuilds rows nobody is looking
// at, re-attaches their listeners, and holds every entry object reachable, so the closed window's
// data cannot be collected. A browser hides all of that — `document` still exists there, and the
// rows go into a detached element. A headless DOM throws instead, which is the only reason this was
// ever visible (#1329).
//
// Six apps mount this component, so the flag lives HERE and each host calls `destroy()`. Six copies
// of one flag is the drift this codebase keeps paying for, and one of the six would be missed;
// `scripts/check-app-teardown.mjs` is what makes the seventh call it too.
//
// Every test lets the abandoned work land INSIDE itself. That is the point: left to settle
// afterwards it arrives as an unhandled rejection attributed to whichever file happened to run
// next, and reads as that test being flaky rather than as this component being wrong.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../test/domEnv.js';
import type { HistorySidebarConfig, HistorySidebarEntry } from './historySidebar.js';

let env: DomEnv;
let createHistorySidebar: typeof import('./historySidebar.js').createHistorySidebar;

const ENTRIES: HistorySidebarEntry[] = [
  { id: 'a', at: 3, text: 'first' },
  { id: 'b', at: 2, text: 'second' },
];

/** A `load()` the test holds open, so teardown can happen while a draw is mid-flight. */
function gatedLoad() {
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  return {
    release,
    load: async (): Promise<HistorySidebarEntry[]> => {
      await gate;
      return ENTRIES;
    },
  };
}

const mount = (config: Partial<HistorySidebarConfig> = {}) => {
  const sidebar = createHistorySidebar({
    load: async () => ENTRIES,
    remove: () => {},
    itemOf: (e) => ({ snippet: String(e.text) }),
    ...config,
  });
  env.document.body.append(sidebar.el as unknown as Node);
  return sidebar;
};

const rowCount = (sidebar: { el: HTMLElement }): number => sidebar.el.querySelectorAll('.mt-history-item').length;

describe('a history sidebar whose window has gone', () => {
  beforeEach(async () => {
    env = installDom();
    ({ createHistorySidebar } = await import('./historySidebar.js'));
  });
  afterEach(() => env.cleanup());

  // The reported crash, now an assertion: the draw is already past `load()` when the window closes.
  test('a draw already in flight paints nothing when it lands', async () => {
    const gated = gatedLoad();
    const sidebar = mount({ load: gated.load });

    sidebar.destroy(); // the user closed the window while the list was still loading
    gated.release();
    await sidebar.ready;
    await settle(10);

    assert.equal(rowCount(sidebar), 0, 'the torn-down sidebar rebuilt its rows anyway');
  });

  test('and a draw asked for afterwards never starts', async () => {
    const sidebar = mount();
    await sidebar.ready;
    assert.equal(rowCount(sidebar), ENTRIES.length, 'the live sidebar drew its rows');

    // A value only this test writes. A repaint replaces the row nodes, so the mark going missing is
    // exactly the bug — counting rows would not notice, since a repaint puts the same number back.
    const MARK = 'torn down: nothing may touch this';
    for (const row of sidebar.el.querySelectorAll<HTMLElement>('.mt-history-item')) row.title = MARK;

    sidebar.destroy();
    await sidebar.refresh();
    await settle(10);

    const rows = [...sidebar.el.querySelectorAll<HTMLElement>('.mt-history-item')];
    assert.equal(rows.length, ENTRIES.length);
    assert.ok(
      rows.every((row) => row.title === MARK),
      'refresh rebuilt the rows of a window that is not there',
    );
  });

  test('opening an entry no longer calls back into the app', async () => {
    const opened: string[] = [];
    const sidebar = mount({ onOpen: (e) => opened.push(e.id) });
    await sidebar.ready;

    sidebar.destroy();
    sidebar.open(ENTRIES[0]);
    sidebar.showNew();
    await settle(10);

    assert.deepEqual(opened, [], 'a job settling late handed a closed app a pane to draw');
  });

  test('destroying twice is not an error', async () => {
    const sidebar = mount();
    await sidebar.ready;
    sidebar.destroy();
    sidebar.destroy();
    await settle(10);
  });

  // Closing a window is not undoing a delete the user already confirmed. The undo window runs on a
  // plain timer, so it lapses whether or not the window is still open — the commit must still land,
  // and only the repaint that follows it is skipped.
  //
  // Driven through the BATCH delete, not a single row's: the batch commit is the one that ends in a
  // `draw()` ("what survived comes back"), so it is the continuation the issue actually names. A
  // single-row commit does not repaint, and asserting a repaint that never happens would be a test
  // that passes whether or not this is fixed.
  test('a delete already confirmed still commits; only its repaint is skipped', async () => {
    const removed: string[] = [];
    const sidebar = mount({
      remove: (entry) => {
        removed.push(entry.id);
      },
      selectable: true,
      undoMs: 5,
    });
    await sidebar.ready;

    // Take the delete's own path rather than reaching past it: Select, tick a row, Delete, confirm.
    const click = async (node: Element | null | undefined, what: string): Promise<void> => {
      assert.ok(node, `the sidebar offers ${what}`);
      (node as HTMLElement).click();
      await settle(0);
    };
    await click(sidebar.el.querySelector('.mt-select-toggle'), 'a Select toggle');
    const box = sidebar.el.querySelector<HTMLInputElement>('.mt-history-item input[type=checkbox]');
    assert.ok(box, 'and a checkbox per row');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle(0);
    await click(sidebar.el.querySelector('.mt-select-del'), 'a Delete (N) button');
    await click(env.document.querySelector('.confirm-actions .button-primary'), 'a confirmation');

    // The row goes at once — that is the undo window, and the state the commit would repaint from.
    assert.equal(rowCount(sidebar), ENTRIES.length - 1);
    const MARK = 'closing: not one more paint';
    for (const node of sidebar.el.querySelectorAll<HTMLElement>('.mt-history-item')) node.title = MARK;

    sidebar.destroy(); // the window closes while the undo window is still counting down
    await settle(40);

    assert.deepEqual(removed, ['a'], 'the delete the user confirmed was lost when the window closed');
    const rows = [...sidebar.el.querySelectorAll<HTMLElement>('.mt-history-item')];
    assert.ok(
      rows.length && rows.every((node) => node.title === MARK),
      'the commit repainted a window that is not there',
    );
  });
});
