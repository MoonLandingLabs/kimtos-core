// Five apps mount this sidebar, and all five remember "which entry was I on" through the same
// binding (#1172). The binding has one subtlety worth pinning: the mount puts a pane on screen
// before the (async) list resolves, and that is NOT the user navigating — a save there would write
// a null straight over the entry id being restored, so the restore would silently never happen.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../test/domEnv.js';

let env: DomEnv;
let createHistorySidebar: typeof import('./historySidebar.js').createHistorySidebar;
let createEntrySession: typeof import('./historySidebar.js').createEntrySession;
let mounted: ReturnType<typeof createHistorySidebar> | null = null;

const ENTRIES = [
  { id: 'a', at: 3, text: 'first' },
  { id: 'b', at: 2, text: 'second' },
];

describe('remembering which entry the user was on', () => {
  beforeEach(async () => {
    env = installDom();
    ({ createHistorySidebar, createEntrySession } = await import('./historySidebar.js'));
  });

  // `open()` kicks off another (async) draw. Tearing the sidebar down is what stops it — the same
  // move every app makes when its window closes (#1329). This used to be a bare `await settle(10)`
  // and a hope, because the sidebar had no teardown to call and the redraw would otherwise finish
  // against a torn-down DOM and fail the run from outside the test.
  afterEach(async () => {
    mounted?.destroy();
    mounted = null;
    await settle(0);
    env.cleanup();
  });

  const mount = async (initialActiveId: string | null, onOpen: (id: string) => void = () => {}) => {
    const sidebar = createHistorySidebar({
      load: async () => ENTRIES,
      remove: () => {},
      itemOf: (e) => ({ snippet: String(e.text) }),
      onOpen: (e) => onOpen(e.id),
      initialActiveId,
    });
    env.document.body.append(sidebar.el as unknown as Node);
    mounted = sidebar;
    return sidebar;
  };

  test('the remembered entry is re-opened once the list has loaded', async () => {
    const opened: string[] = [];
    const sidebar = await mount('b', (id) => opened.push(id));

    assert.deepEqual(opened, [], 'nothing can be opened before the async list resolves');
    assert.equal(await sidebar.ready, ENTRIES[1], 'ready reports what it actually restored');
    assert.deepEqual(opened, ['b']);
  });

  // The entry was deleted from another page, or the app was updated. Opening it would hand the app
  // a result screen for a recording that is not there.
  test('an id that no longer exists is ignored, not opened', async () => {
    const opened: string[] = [];
    const sidebar = await mount('gone', (id) => opened.push(id));

    assert.equal(await sidebar.ready, null, 'and it SAYS it restored nothing, so a host can fall back');
    assert.deepEqual(opened, []);
  });

  test('no remembered entry restores nothing', async () => {
    const opened: string[] = [];
    const sidebar = await mount(null, (id) => opened.push(id));

    assert.equal(await sidebar.ready, null);
    assert.deepEqual(opened, []);
  });
});

describe('the entry-session binding', () => {
  test('reads the remembered id out of the session bag', () => {
    const bound = createEntrySession({ session: { entryId: 'b' } });
    assert.equal(bound.initialActiveId, 'b');
  });

  test('a fresh open has no remembered id', () => {
    assert.equal(createEntrySession({ session: null }).initialActiveId, null);
    assert.equal(createEntrySession({}).initialActiveId, null);
  });

  // THE subtlety. Without this, the mount's own `showNew()` saves a null over the id being
  // restored, and the feature quietly does nothing.
  test('saves nothing until start(), so the mount cannot overwrite the restore', () => {
    const saved: unknown[] = [];
    const bound = createEntrySession({ session: { entryId: 'b' }, saveSession: (s) => saved.push(s) });

    bound.remember(null); // what the mount's showNew() triggers
    assert.deepEqual(saved, [], 'the mount is not the user navigating');

    bound.start();
    bound.remember('a');
    assert.deepEqual(saved, [{ entryId: 'a' }]);
  });

  test('records a return to the new/input screen once tracking', () => {
    const saved: unknown[] = [];
    const bound = createEntrySession({ session: null, saveSession: (s) => saved.push(s) });
    bound.start();

    bound.remember(null);
    assert.deepEqual(saved, [{ entryId: null }], 'being on the input screen is a place too');
  });

  test('an app with no session support in its ctx is simply a no-op', () => {
    const bound = createEntrySession({});
    bound.start();
    bound.remember('a'); // must not throw
  });
});
