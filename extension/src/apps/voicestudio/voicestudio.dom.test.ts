// Voice Studio's voice picker is the ONLY way to select or audition a voice, so if it
// renders empty the app's headline feature is dead and the user is stuck on the default
// voice with no way out. It shipped exactly that way (#1135): the old palette built each
// group's section but never appended it, so every chip was constructed and thrown away.
//
// The picker replaced that palette in #1146, and brought three guarantees of its own that
// are just as easy to lose in a refactor: auditioning a voice must not select it, must not
// disable Speak, and filtering must not destroy the focused search box (#217). All four
// contracts are locked here.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type DomEnv } from '../../test/domEnv.js';
import { VOICES } from '../../lib/engines/voiceCatalog.js';
import app from './index.js';

/**
 * Mount the app and drain BOTH of its async chains, so neither lands mid-assertion.
 *
 * The sidebar's history load is one. The other is the startup read of what this device
 * actually holds (`refreshModelState`), which the app fires and forgets — "the cards paint
 * immediately and settle into their real state a moment later". Until it lands, every card
 * reads as not-downloaded whatever is really cached, and the picker note is empty.
 *
 * The note gaining text is how we know that read finished: it is written on both branches,
 * and both of its inputs always resolve. Waiting here rather than in each test is
 * deliberate — two cases have already raced on it (#1215), and a test added tomorrow would
 * inherit the same trap.
 */
async function mount(env: DomEnv): Promise<{ body: HTMLElement; cleanup: () => void }> {
  const body = env.document.createElement('div') as unknown as HTMLElement;
  const teardown = app.render(body);
  for (let i = 0; i < 50 && !body.textContent?.includes('Saved clips will appear here'); i++) {
    await settle(10);
  }
  await waitFor(
    () => !!body.querySelector('.vs-picker .vs-preview-note')?.textContent,
    'the picker to settle into what this device actually holds',
  );
  return { body, cleanup: () => teardown?.() };
}

const fire = (env: DomEnv, node: Element, type: string): void => {
  node.dispatchEvent(new env.window.Event(type, { bubbles: true }) as unknown as Event);
};

/**
 * Wait for a condition rather than for a fixed delay.
 *
 * A preview reads the sample cache (IndexedDB) before it can fail, so "has it failed
 * yet" is not a duration — a hard-coded sleep passed most runs and failed about one in
 * eight, which is a flaky test pretending to be a passing one.
 *
 * The predicate must be something only the settled app can satisfy. A condition that is
 * already true on the first synchronous paint — a DEFAULT state, like a card reading
 * not-downloaded before anything has been read — does not wait at all, and reads in review
 * as protection it is not providing (#1215). Wait for the thing you are about to assert on.
 */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await settle(10);
  assert.ok(predicate(), `timed out waiting for: ${what}`);
}

// Previews are registered jobs now, and the orchestrator is module state that outlives a test's
// DOM: a job left running by one case makes its app busy for the next one, whose own job then
// waits for a slot that never frees. Reset it between cases, the way kimtManager's own tests do.
async function resetJobs(): Promise<void> {
  const km = await import('../../lib/kimtManager.js');
  km.__reset();
}

describe('Voice Studio picker', () => {
  let env: DomEnv;
  beforeEach(() => {
    env = installDom();
  });
  afterEach(async () => {
    await resetJobs();
    env.cleanup();
  });

  test('renders a selectable, playable card for every voice (regression #1135)', async () => {
    const { body, cleanup } = await mount(env);
    try {
      assert.ok(body.querySelector('.vs-picker'), 'the picker is mounted');
      assert.equal(body.querySelectorAll('.vs-card').length, VOICES.length, 'one card per voice');
      assert.equal(body.querySelectorAll('.vs-card-pick').length, VOICES.length, 'a select control per voice');
      assert.equal(body.querySelectorAll('.vs-card-play').length, VOICES.length, 'a preview control per voice');
      // The voice bar names the selected voice, so the studio says who is speaking even
      // with the picker closed.
      assert.ok(body.querySelector('.vs-bar-name')?.textContent, 'the voice bar names a voice');
    } finally {
      cleanup();
    }
  });

  test('searching filters the grid and keeps the live input node (#217)', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const search = body.querySelector('.vs-search-input') as HTMLInputElement;
      search.value = 'emma';
      fire(env, search, 'input');

      const names = [...body.querySelectorAll('.vs-card-name')].map((n) => n.textContent);
      assert.deepEqual(names, ['Emma'], 'only the matching voice survives the filter');
      assert.equal(
        body.querySelector('.vs-search-input'),
        search,
        'the search box itself is never rebuilt — repainting it would kick the user out mid-type',
      );
    } finally {
      cleanup();
    }
  });

  test('a filter chip narrows the grid, and the count says by how much', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const uk = [...body.querySelectorAll('.vs-chip')].find((c) => c.textContent === 'UK') as HTMLButtonElement;
      uk.click();
      const expected = VOICES.filter((v) => v.lang === 'en-gb').length;
      assert.equal(body.querySelectorAll('.vs-card').length, expected, 'only UK voices remain');
      assert.equal(body.querySelector('.vs-picker-count')?.textContent, `${expected} of ${VOICES.length} voices`);
    } finally {
      cleanup();
    }
  });

  test('picking a card selects that voice', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const cards = [...body.querySelectorAll('.vs-card')];
      const other = cards.find((c) => !c.classList.contains('is-selected')) as HTMLElement;
      const name = other.querySelector('.vs-card-name')?.textContent;
      (other.querySelector('.vs-card-pick') as HTMLButtonElement).click();
      await settle(10);

      assert.equal(body.querySelector('.vs-bar-name')?.textContent, name, 'the voice bar follows the pick');
    } finally {
      cleanup();
    }
  });

  test('auditioning a voice neither selects it nor disables Speak', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const textarea = body.querySelector('.vs-text') as HTMLTextAreaElement;
      textarea.value = 'Read this out.';
      fire(env, textarea, 'input');
      const speak = body.querySelector('.vs-speak') as HTMLButtonElement;
      assert.equal(speak.disabled, false, 'Speak is live once there is text');

      const before = body.querySelector('.vs-bar-name')?.textContent;
      const cards = [...body.querySelectorAll('.vs-card')];
      const other = cards.find((c) => !c.classList.contains('is-selected')) as HTMLElement;
      (other.querySelector('.vs-card-play') as HTMLButtonElement).click();
      await settle(20);

      // The old palette assigned the voice on preview and put the whole app into its busy
      // state — so listening WAS choosing, and nothing else could be done meanwhile.
      assert.equal(body.querySelector('.vs-bar-name')?.textContent, before, 'listening is not choosing');
      assert.equal(speak.disabled, false, 'a preview never disables Speak');
    } finally {
      cleanup();
    }
  });
});

// A voice you have never heard has to be DOWNLOADED before it can speak (the shared
// ~90 MB model the first time, then its own voice file). The picker said nothing about
// that: every card offered "play", and pressing it bought a silent, unexplained wait
// (#1152). The cards must distinguish held-on-this-device from not.
describe('Voice Studio download state', () => {
  let env: DomEnv;
  beforeEach(async () => {
    env = installDom();
    const { dataStore } = await import('../../lib/dataStore.js');
    await dataStore.clearBlobsByPrefix('voicestudio:preview/'); // the DB outlives one test
  });
  afterEach(async () => {
    await resetJobs();
    env.cleanup();
  });

  test('a voice with no sample yet offers a download, and says so in words', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const card = body.querySelector('.vs-card') as HTMLElement;
      const btn = card.querySelector('.vs-card-play') as HTMLButtonElement;
      // A plain assertion, not a wait: mount() has already drained the model-state read, and
      // waiting on `is-download` would wait for nothing — it is the state the card paints in
      // before that read has happened (#1215).
      assert.ok(btn.classList.contains('is-download'), 'the card settles into its download state');

      assert.match(btn.title, /^Download /, 'the control says download, not play');
      const tag = card.querySelector('.vs-card-state') as HTMLElement;
      assert.equal(tag.hidden, false, 'and the card says it in words too');
      assert.match(tag.textContent || '', /Not downloaded/);
      // In the PICKER, above the grid — where the voices are. Mounting it in the
      // composer as well would move it out of the picker entirely (one parent per node).
      const note = body.querySelector('.vs-picker .vs-preview-note');
      assert.ok(note?.textContent, 'the picker explains the one-time download');
    } finally {
      cleanup();
    }
  });

  test('a voice whose sample is already held offers to play it', async () => {
    const { dataStore } = await import('../../lib/dataStore.js');
    const { VOICES: catalog } = await import('../../lib/engines/voiceCatalog.js');
    await dataStore.putBlob(`voicestudio:preview/v1-${catalog[0].id}`, new Blob([new Uint8Array(8)]));

    const { body, cleanup } = await mount(env);
    try {
      const card = [...body.querySelectorAll('.vs-card')].find(
        (c) => c.querySelector('.vs-card-name')?.textContent === catalog[0].name,
      ) as HTMLElement;
      const btn = card.querySelector('.vs-card-play') as HTMLButtonElement;
      await waitFor(() => !btn.classList.contains('is-download'), 'the held voice to show as playable');

      assert.match(btn.title, /^Play /, 'a held voice plays rather than downloading again');
      assert.equal((card.querySelector('.vs-card-state') as HTMLElement).hidden, true, 'and claims no download');
    } finally {
      cleanup();
    }
  });
});

// Asking for a second voice used to CANCEL the first, so a shortlist could never be
// fetched in one go (#1163). Each voice owns its own job now: they run together, and
// cancelling one leaves the rest alone.
describe('Voice Studio concurrent downloads', () => {
  let env: DomEnv;
  beforeEach(async () => {
    env = installDom();
    // happy-dom has no Worker, so without this every job dies the instant it starts and
    // there is no in-flight state to observe. A worker that accepts messages and never
    // answers is the honest stub for "still downloading".
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: class {
        onmessage: unknown = null;
        onerror: unknown = null;
        postMessage(): void {}
        terminate(): void {}
      },
    });
    const { dataStore } = await import('../../lib/dataStore.js');
    await dataStore.clearBlobsByPrefix('voicestudio:preview/');
  });
  afterEach(async () => {
    await resetJobs();
    delete (globalThis as { Worker?: unknown }).Worker;
    env.cleanup();
  });

  /** Two cards that are not downloaded yet. */
  const twoCards = (body: HTMLElement): HTMLButtonElement[] =>
    [...body.querySelectorAll('.vs-card-play')].slice(0, 2) as HTMLButtonElement[];

  test('a second voice can be fetched while the first is still going', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const [first, second] = twoCards(body);
      first.click();
      await waitFor(() => first.classList.contains('is-loading'), 'the first voice to start');
      second.click();
      await waitFor(() => second.classList.contains('is-loading'), 'the second voice to start');

      // The regression: starting the second used to abort the first.
      assert.equal(first.classList.contains('is-loading'), true, 'the first download is still running');
      assert.ok(first.querySelector('.btn-spinner'), 'and shows the SHARED button spinner');
      assert.ok(second.querySelector('.btn-spinner'), 'as does the second');
    } finally {
      cleanup();
    }
  });

  test('cancelling one download leaves the other running', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const [first, second] = twoCards(body);
      first.click();
      second.click();
      await waitFor(() => first.classList.contains('is-loading') && second.classList.contains('is-loading'), 'both');

      first.click(); // pressing a downloading card cancels THAT one
      await waitFor(() => !first.classList.contains('is-loading'), 'the first to cancel');

      assert.equal(second.classList.contains('is-loading'), true, 'the other download is untouched');
    } finally {
      cleanup();
    }
  });

  test('moving around the app does not throw a download away', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const [first] = twoCards(body);
      first.click();
      await waitFor(() => first.classList.contains('is-loading'), 'the download to start');

      // Returning to the studio (the sidebar's New) used to stop everything, downloads
      // included — the same class of bug as cancelling them when the grid is filtered.
      (body.querySelector('.mt-new') as HTMLButtonElement).click();
      await settle(20);

      const stillThere = body.querySelector('.vs-card-play.is-loading');
      assert.ok(stillThere, 'the download survives the view change');
    } finally {
      cleanup();
    }
  });

  test('a working card reports what it is doing, in words', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const [first] = twoCards(body);
      const tag = first.closest('.vs-card')?.querySelector('.vs-card-state') as HTMLElement;
      first.click();
      await waitFor(() => first.classList.contains('is-loading'), 'the download to start');

      assert.equal(tag.hidden, false, 'the card says what it is doing');
      assert.ok(tag.textContent, 'with real words, not an empty tag');
      assert.match(first.title, /^Cancel /, 'and the control now offers to cancel it');
    } finally {
      cleanup();
    }
  });
});

// A preview that cannot play must SAY so and stay retryable. It did neither: the
// play() rejection was swallowed and `previewing` stayed set, so the button kept its
// stop state and every later click merely "stopped" a preview that was not running —
// preview appeared permanently dead, with nothing to read (#1152).
describe('Voice Studio preview failure', () => {
  let env: DomEnv;
  beforeEach(async () => {
    env = installDom();
    // The fake IndexedDB outlives a single test, so a sample cached by an earlier case
    // would make this one take the "already held" path and never fail at all.
    const { dataStore } = await import('../../lib/dataStore.js');
    await dataStore.clearBlobsByPrefix('voicestudio:preview/');
  });
  afterEach(async () => {
    await resetJobs();
    env.cleanup();
  });

  test('a preview that fails says why, and the next click tries again', async () => {
    const { body, cleanup } = await mount(env);
    try {
      const card = body.querySelector('.vs-card') as HTMLElement;
      const play = card.querySelector('.vs-card-play') as HTMLButtonElement;

      const error = body.querySelector('.vs-preview-error') as HTMLElement;
      play.click();
      await waitFor(() => !error.hidden, 'the failure to be reported, not swallowed');

      assert.ok(error.textContent, 'and it says something');
      assert.ok(error.querySelector('.vs-preview-retry'), 'with a control that plays inside a real click');

      // The wedge: a stuck `previewing` leaves the button in its stop state, and the
      // next click becomes a silent no-op instead of a retry.
      assert.equal(play.classList.contains('is-playing'), false, 'the button is not stuck in its stop state');
      assert.equal(play.classList.contains('is-loading'), false, 'nor stuck rendering');

      // The retry clears the error, then re-reports it — proof the click did something
      // rather than being swallowed by the "already previewing" branch.
      play.click();
      await waitFor(() => error.hidden, 'the retry to actually start (the error clears)');
      await waitFor(() => !error.hidden, 'the retry to run to its own failure');
    } finally {
      cleanup();
    }
  });

  test('a browser that refuses to start the audio is reported, not swallowed', async () => {
    // The reported symptom (#1152): the sample renders fine and `play()` rejects —
    // typically NotAllowedError, because playback starts seconds after the click that
    // asked for it. Seed the sample cache so the render succeeds, then refuse playback.
    const { dataStore } = await import('../../lib/dataStore.js');
    const { VOICES: catalog } = await import('../../lib/engines/voiceCatalog.js');
    await dataStore.putBlob(`voicestudio:preview/v1-${catalog[0].id}`, new Blob([new Uint8Array(8)]));

    const { body, cleanup } = await mount(env);
    const audio = body.querySelector('.vs-preview-audio') as HTMLAudioElement;
    audio.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    try {
      const card = [...body.querySelectorAll('.vs-card')].find(
        (c) => c.querySelector('.vs-card-name')?.textContent === catalog[0].name,
      ) as HTMLElement;
      const play = card.querySelector('.vs-card-play') as HTMLButtonElement;
      const error = body.querySelector('.vs-preview-error') as HTMLElement;

      play.click();
      await waitFor(() => !error.hidden, 'the refused play() to be surfaced');

      assert.equal(error.hidden, false, 'a refused play() is surfaced');
      assert.match(error.textContent || '', /blocked .* from starting on its own/, 'and it explains what happened');
      assert.ok(error.querySelector('.vs-preview-retry'), 'and offers to play it from a real click');
      assert.equal(play.classList.contains('is-playing'), false, 'the button did not stick in its stop state');
    } finally {
      cleanup();
    }
  });
});
