// The toolbar popup's whole UX is one pure function (#1110): given the installed set,
// what kind of page they are on, and whether we hold the all-sites grant,
// `pageActionsFor` returns exactly the rows to show and at most one thing to say.
//
// It is tested hard because everything else about the popup is rendering. The failures that
// matter are all decisions: offering a row whose app is not installed, offering page actions on a
// chrome:// page where nothing can run, and — the one the issue is really about — listing
// actions that would silently fail because the extension holds no access to the site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLIPBOARD_APP_ID,
  CLIPBOARD_PICKER_COMMAND,
  PAGE_ACTIONS,
  appsOf,
  isSecurePage,
  pageActionsFor,
  pageKindOf,
  type PageAction,
  type PageActionContext,
} from './pageActions.js';
import { FAKEFORM_ACTIONS, FAKEFORM_APP_ID } from './fakeformShared.js';
import type { InstalledState } from './installedApps.js';

const BOTH_APPS = [FAKEFORM_APP_ID, CLIPBOARD_APP_ID];

/** Both page-action apps installed, on an https page we can reach. */
const ctx = (over: Partial<PageActionContext> = {}): PageActionContext => ({
  installed: { installedApps: BOTH_APPS },
  pageKind: 'web',
  secure: true,
  hasAllSites: true,
  ...over,
});

const ids = (c: PageActionContext): string[] => pageActionsFor(c).actions.map((a) => a.id);

describe('the registry', () => {
  test('every FakeForm command is offered, with the label FakeForm already owns', () => {
    for (const spec of FAKEFORM_ACTIONS) {
      const entry = PAGE_ACTIONS.find((a) => a.id === spec.command);
      assert.ok(entry, `no page action for ${spec.command}`);
      assert.equal(entry.label, spec.label, 'the label must not be a second copy');
      assert.equal(entry.appId, FAKEFORM_APP_ID);
    }
  });

  test('Clipboard contributes its picker', () => {
    const entry = PAGE_ACTIONS.find((a) => a.id === CLIPBOARD_PICKER_COMMAND);
    assert.ok(entry);
    assert.equal(entry.appId, CLIPBOARD_APP_ID);
    assert.equal(entry.access, 'content-script');
  });

  test('every action id is unique — an id is also the command that runs it', () => {
    const seen = new Set(PAGE_ACTIONS.map((a) => a.id));
    assert.equal(seen.size, PAGE_ACTIONS.length);
  });

  test('it stays short by construction — the popup is a tool, not a dock', () => {
    assert.ok(PAGE_ACTIONS.length <= 7, `${PAGE_ACTIONS.length} actions; add a "More" affordance before growing`);
  });

  test('every action id is a real manifest command, so a row cannot outlive its handler', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../manifest.json', import.meta.url)), 'utf8'),
    ) as { commands?: Record<string, unknown> };
    for (const action of PAGE_ACTIONS) {
      assert.ok(
        manifest.commands && action.id in manifest.commands,
        `page action "${action.id}" names no command in manifest.json — the popup would show a dead row`,
      );
    }
  });
});

describe('pageKindOf', () => {
  for (const url of [
    'chrome://extensions',
    'chrome-extension://abc/index.html',
    'about:blank',
    'edge://settings',
    'view-source:https://example.com',
    'file:///Users/x/a.pdf',
    'https://chrome.google.com/webstore/category/extensions',
    'https://chromewebstore.google.com/detail/abc',
  ]) {
    test(`restricted: ${url}`, () => assert.equal(pageKindOf(url), 'restricted'));
  }

  for (const url of ['https://example.com/signup', 'http://localhost:5173/', 'https://chrome.google.com/']) {
    test(`web: ${url}`, () => assert.equal(pageKindOf(url), 'web'));
  }

  test('a URL we are not allowed to see reads as restricted, not as an open page', () => {
    assert.equal(pageKindOf(undefined), 'restricted');
    assert.equal(pageKindOf(''), 'restricted');
  });
});

describe('isSecurePage', () => {
  test('https only', () => {
    assert.equal(isSecurePage('https://example.com'), true);
    assert.equal(isSecurePage('http://example.com'), false);
    assert.equal(isSecurePage(undefined), false);
  });
});

describe('pageActionsFor — the filter', () => {
  test('with both apps installed every action is offered', () => {
    assert.deepEqual(ids(ctx()), [...FAKEFORM_ACTIONS.map((a) => a.command), CLIPBOARD_PICKER_COMMAND]);
    assert.equal(pageActionsFor(ctx()).notice, null);
  });

  test('an app that is NOT installed contributes nothing', () => {
    const installed: InstalledState = { installedApps: [CLIPBOARD_APP_ID] };
    assert.deepEqual(ids(ctx({ installed })), [CLIPBOARD_PICKER_COMMAND]);
  });

  test('a restricted page offers nothing and says so once', () => {
    const model = pageActionsFor(ctx({ pageKind: 'restricted' }));
    assert.deepEqual(model.actions, []);
    assert.equal(model.notice, 'restricted');
  });

  test('a restricted page says so even for a user with nothing installed', () => {
    const model = pageActionsFor(ctx({ pageKind: 'restricted', installed: { installedApps: [] } }));
    assert.equal(model.notice, 'restricted');
  });

  test('without the all-sites grant the inject-only actions still run — that is what activeTab buys', () => {
    const model = pageActionsFor(ctx({ hasAllSites: false }));
    assert.deepEqual(
      model.actions.map((a) => a.id),
      FAKEFORM_ACTIONS.map((a) => a.command),
    );
    // Clipboard's picker needs a registered content script, and granting would bring it back.
    assert.equal(model.notice, 'grant-host');
  });

  test('no grant prompt when nothing was actually held back by the permission', () => {
    const installed: InstalledState = { installedApps: [FAKEFORM_APP_ID] };
    const model = pageActionsFor(ctx({ hasAllSites: false, installed }));
    assert.equal(model.actions.length, FAKEFORM_ACTIONS.length);
    assert.equal(model.notice, null);
  });

  test('no grant prompt on an http page — the optional grant is https-only, so asking cannot help', () => {
    const model = pageActionsFor(ctx({ hasAllSites: false, secure: false }));
    assert.deepEqual(
      model.actions.map((a) => a.id),
      FAKEFORM_ACTIONS.map((a) => a.command),
    );
    assert.equal(model.notice, null);
  });

  test('an http page drops the content-script action even WITH the grant', () => {
    const model = pageActionsFor(ctx({ secure: false }));
    assert.ok(!model.actions.some((a) => a.id === CLIPBOARD_PICKER_COMMAND));
  });

  test('a `when` predicate can veto an action an installed app would otherwise offer', () => {
    const custom: PageAction[] = [
      { id: 'yes', appId: FAKEFORM_APP_ID, label: 'Yes', access: 'inject' },
      { id: 'no', appId: FAKEFORM_APP_ID, label: 'No', access: 'inject', when: () => false },
    ];
    const model = pageActionsFor(ctx(), custom);
    assert.deepEqual(
      model.actions.map((a) => a.id),
      ['yes'],
    );
  });

  test('`when` is handed the same context the rest of the rule sees', () => {
    const seen: PageActionContext[] = [];
    const custom: PageAction[] = [
      {
        id: 'probe',
        appId: FAKEFORM_APP_ID,
        label: 'Probe',
        access: 'inject',
        when: (c) => {
          seen.push(c);
          return true;
        },
      },
    ];
    const context = ctx({ secure: false });
    pageActionsFor(context, custom);
    assert.deepEqual(seen, [context]);
  });
});

describe('appsOf', () => {
  test('groups in first-appearance order, once per app', () => {
    assert.deepEqual(appsOf(pageActionsFor(ctx()).actions), [FAKEFORM_APP_ID, CLIPBOARD_APP_ID]);
  });

  test('empty in, empty out', () => {
    assert.deepEqual(appsOf([]), []);
  });
});
