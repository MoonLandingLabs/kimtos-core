// The guard has to catch the shape it was written for, and leave alone the shapes it was not.
//
// A guard that only passes is indistinguishable from no guard, so the case that matters here is
// the FAILING one: the exact `activeDownloads` map KimtAI kept before #1275 must be recognised as
// a private registry when nothing mentions the orchestrator.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { privateRegistries, usesOrchestrator, ownCancellation } from './check-orchestrated-jobs.mjs';

describe('check-orchestrated-jobs', () => {
  test('catches the registry KimtAI actually had', () => {
    const src = `const activeDownloads = new Map<string, DownloadEntry>();\nexport const hasActiveDownloads = () => activeDownloads.size > 0;`;
    assert.deepEqual(privateRegistries(src), ['activeDownloads']);
    assert.equal(usesOrchestrator(src), false, 'and it did not go through the orchestrator');
  });

  test('a typed or untyped Map or Set both count', () => {
    assert.deepEqual(privateRegistries('const pendingJobs = new Map();'), ['pendingJobs']);
    assert.deepEqual(privateRegistries('let runningClips = new Set<string>();'), ['runningClips']);
    assert.deepEqual(privateRegistries('const inFlight: Map<string, X> = new Map();'), ['inFlight']);
  });

  test('an app that registers its work is fine', () => {
    const src = `const activeDownloads = new Map();\nkimtManager.start({ appId: 'x', run });`;
    assert.deepEqual(privateRegistries(src), ['activeDownloads']);
    assert.equal(usesOrchestrator(src), true, 'so the check passes it');
  });

  test('a local inside a function is not a registry — it cannot outlive the call', () => {
    assert.deepEqual(privateRegistries('  const activeThings = new Map();'), []);
  });

  test('plain UI state is left alone, so nobody is taught to rename around the guard', () => {
    assert.deepEqual(privateRegistries('const currentTab = new Map();'), []);
    assert.deepEqual(privateRegistries('const activeFilters = new Set();'), []);
  });

  test('an unrelated collection does not match', () => {
    assert.deepEqual(privateRegistries('const byId = new Map();\nconst seen = new Set();'), []);
  });
});

// The guard reads EVERY source file in an app, not just its entry point.
//
// Ten apps split their logic across four or more files, so a registry in `archive.ts` beside the
// one in `index.ts` is the ordinary shape of this codebase. A guard that only read `index.ts`
// would miss exactly what it exists for, while printing a line that says everything is fine.
describe('check-orchestrated-jobs: scope', () => {
  test('a registry declared in one file is satisfied by an orchestrator call in another', () => {
    const registryFile = 'const activeArchiveJobs = new Map();';
    const callerFile = "kimtManager.start({ appId: 'kimtfs', run });";
    assert.deepEqual(privateRegistries(registryFile), ['activeArchiveJobs']);
    assert.equal([registryFile, callerFile].some(usesOrchestrator), true);
  });

  test('and is NOT satisfied when no file in the app reaches it', () => {
    const files = ['const activeArchiveJobs = new Map();', 'export const helper = () => 1;'];
    assert.equal(files.some(usesOrchestrator), false);
  });
});

// Keeping your own CANCELLATION is the disqualifying shape, and it is the one the name-and-scope
// rules above could not see.
//
// Voice Studio kept a `Map` of AbortControllers for its voice downloads INSIDE its render closure,
// under the name `jobs`. Every rule above missed it: not module scope, not a matching name, and
// the app mentions `kimtManager` elsewhere for a different job — so the guard passed an app that
// was pulling 90 MB with no row and no Stop (#1304). After the fix the same app keeps a `Map` of
// Jobs: the same shape, the opposite meaning. Only what the collection HOLDS separates them.
describe('check-orchestrated-jobs: an app may not keep its own cancellation', () => {
  test('a Map of AbortControllers is flagged, wherever it is declared', () => {
    const src = `    const jobs = new Map<string, AbortController>();`;
    assert.ok(ownCancellation(src), 'an indented declaration counts — a render closure outlives the call');
  });

  test('and so is one held indirectly, through a type with a controller field', () => {
    const src = `
      interface PreviewJob {
        ctl: AbortController;
        label: string;
      }
      const jobs = new Map<string, PreviewJob>();
    `;
    const hit = ownCancellation(src);
    assert.ok(hit, 'the indirection is how it was written, so it has to be what is checked');
    assert.match(hit, /PreviewJob/);
  });

  test('a Map of orchestrator handles is NOT flagged — that is the fixed shape', () => {
    const src = `
      const previews = new Map<string, Job>();
      kimtManager.register({ appId: 'voicestudio', run });
    `;
    assert.equal(ownCancellation(src), null);
  });

  test('a single controller in a local is not a registry', () => {
    // One cancel, awaited and discarded, is how a single abort is written everywhere. Flagging it
    // would teach people to route around the guard rather than use the orchestrator.
    assert.equal(ownCancellation('const ctl = new AbortController();\nctl.abort();'), null);
  });

  test('an app with no controllers at all is not examined for them', () => {
    assert.equal(ownCancellation('const previews = new Map<string, Job>();'), null);
  });
});
