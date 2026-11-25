// KimtAI's conversation ownership (#951, #952, #953).
//
// The bug worth a whole test file is the data-corruption one: a reply that is still being
// generated used to be appended to — and PERSISTED INTO — whichever conversation happened to
// be open when it finished, because `finish()` closed over the `messages` variable that
// `newChat()`/`openChat()` reassign. Switching chats mid-reply therefore wrote an answer to a
// question the user never asked there. None of that is visible from the outside, so it is
// pinned here by driving the real app against a fake model worker.
//
// The worker is faked (the real one pulls a model through Transformers.js); everything else —
// the local chats routes, IndexedDB, the shared sidebar — is the real thing.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, type DomEnv, type FakeChrome } from '../../test/domEnv.js';

const MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: { type?: string; [k: string]: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { type?: string }): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  // Deliberately still delivers after `terminate()`, which a real worker cannot do. That
  // makes the tests strictly harsher: they hold the app's ownership guards on their own,
  // rather than passing merely because the worker was killed.
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function installWorker(): () => void {
  FakeWorker.instances = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const before = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  return () => {
    if (before) Object.defineProperty(globalThis, 'Worker', before);
    else delete g.Worker;
  };
}

/** Let queued microtasks, the local router's IndexedDB reads and the sidebar redraw settle. */
const settle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until `get` returns something. Everything the app draws from storage goes through
 * IndexedDB, whose first open in a process is slow enough that a fixed sleep is a flake.
 */
async function waitFor<T>(
  get: () => T | null | undefined | Promise<T | null | undefined>,
  what: string,
  tries = 200,
): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const value = await get();
    if (value) return value;
    await settle(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface Chat {
  id: string;
  title?: string;
  messages?: { role: string; content: string }[];
}

let env: DomEnv;
let chrome: FakeChrome;
let removeWorker: () => void;
let dispose: (() => void) | undefined;
let jsonApi: (method: string, endpoint: string, body?: unknown) => unknown;
let getApi: (endpoint: string) => unknown;

const $ = <T extends Element>(sel: string): T => env.document.querySelector(sel) as T;
const rows = (): HTMLElement[] => [...env.document.querySelectorAll('.mt-history-item')] as HTMLElement[];
const sendBtn = (): HTMLButtonElement => $('.kimtai-send');
const worker = (): FakeWorker => FakeWorker.instances.at(-1)!;

/** Mount the real app with one downloaded model, its routes registered and a fake worker. */
async function mount(): Promise<void> {
  env = installDom();
  chrome = installChrome();
  removeWorker = installWorker();

  const { dataStore } = await import('../../lib/dataStore.js');
  const { STORAGE_KEYS } = await import('@kimtos/config/ui');
  await dataStore.kv.set(STORAGE_KEYS.kimtaiDownloaded, [MODEL]);

  await import('./kimtai.local.js'); // register the chats routes (import.meta.glob finds nothing here)
  ({ getApi, jsonApi } = (await import('../../lib/api.js')) as unknown as {
    getApi: typeof getApi;
    jsonApi: typeof jsonApi;
  });

  const app = (await import('./index.js')).default as {
    render: (host: HTMLElement) => () => void;
  };
  const host = env.document.createElement('div');
  env.document.body.append(host);
  dispose = app.render(host);
  await settle();
}

/**
 * Tear the app down. The settle FIRST: a write still in flight would otherwise finish
 * against a document this has already removed, and surface as an unhandled rejection
 * that hides the assertion that actually failed.
 */
async function unmount(): Promise<void> {
  await settle(50);
  dispose?.();
  dispose = undefined;
  removeWorker?.();
  chrome?.cleanup();
  env?.cleanup();
}

/**
 * Redraw the sidebar and wait for the row titled `title`. The app only reloads the list
 * when it changes something itself, and "New" is the cheapest redraw.
 */
async function openFromSidebar(title: string): Promise<void> {
  $<HTMLButtonElement>('.mt-new').click();
  const row = await waitFor(() => rows().find((r) => r.textContent?.includes(title)), `the sidebar row for "${title}"`);
  row.querySelector<HTMLElement>('.mt-history-open')!.click();
  await settle();
}

/** How many generations have been asked of the model across every session so far. */
const generateCount = (): number =>
  FakeWorker.instances.reduce((n, w) => n + w.posted.filter((m) => m.type === 'generate').length, 0);

/**
 * The run id of the most recent generation asked of the model. The engine routes a
 * run's `token`/`done`/`error` by this id and drops anything stale (#967), so an emit
 * that is MEANT to be delivered must echo it — and an emit that must NOT be delivered
 * is made harsher by echoing a superseded one, proving the drop is deliberate routing
 * rather than a malformed message.
 */
const lastRun = (): number =>
  FakeWorker.instances.flatMap((w) => w.posted.filter((m) => m.type === 'generate')).at(-1)!.run as number;

/** Type `text` and press Send, then let the model load and start generating. */
async function send(text: string): Promise<void> {
  const workers = FakeWorker.instances.length;
  const before = generateCount();
  const input = $<HTMLTextAreaElement>('.kimtai-input');
  input.value = text;
  sendBtn().click();
  // A fresh session spawns a worker that has to report `ready` first; a session that is
  // already resident is reused, and goes straight to generating.
  await waitFor(
    () => FakeWorker.instances.length > workers || generateCount() > before || undefined,
    'the send to reach the model',
  );
  if (FakeWorker.instances.length > workers) worker().emit({ type: 'ready', device: 'wasm' });
  await waitFor(() => generateCount() > before || undefined, 'the generate request');
}

/**
 * Type `text` and press Send, but leave the model LOADING — no `ready` is emitted, so the
 * request has not reached the engine yet. That is the window #982 is about.
 */
async function sendWhileLoading(text: string): Promise<FakeWorker> {
  const workers = FakeWorker.instances.length;
  const input = $<HTMLTextAreaElement>('.kimtai-input');
  input.value = text;
  sendBtn().click();
  await waitFor(() => FakeWorker.instances.length > workers || undefined, 'the model load to start');
  await waitFor(() => sendBtn().textContent === 'Stop' || undefined, 'the composer to offer Stop while loading');
  return worker();
}

const pendingReplies = (): number => env.document.querySelectorAll('.kimtai-msg.is-assistant').length;

describe('Stop works while the model is still loading (#982)', () => {
  beforeEach(async () => {
    await mount();
  });
  afterEach(unmount);

  // Stop is offered from the moment Send is pressed, but the engine routes by run id and no
  // run exists before send() — so its stop() is a deliberate no-op there (#967) and the reply
  // the user cancelled used to stream anyway the instant the load finished.
  test('the cancelled reply is never asked for once the load finishes', async () => {
    const loading = await sendWhileLoading('Cancel me');
    assert.equal(pendingReplies(), 1, 'the placeholder reply is on screen while the model loads');

    sendBtn().click();
    await settle();

    assert.equal(sendBtn().textContent, 'Send', 'Stop must put the composer back to Send');
    assert.equal(pendingReplies(), 0, 'the placeholder reply is dropped');
    assert.equal(loading.terminated, false, 'the load is left to finish — the model is reused by the next send');

    // The load completes. Assert repeatedly rather than once after a sleep: a negative
    // assertion taken too early passes for the wrong reason.
    loading.emit({ type: 'ready', device: 'wasm' });
    for (let i = 0; i < 40; i++) {
      assert.equal(generateCount(), 0, 'the reply the user cancelled was generated anyway (#982)');
      await settle(10);
    }
    assert.equal(sendBtn().textContent, 'Send', 'the composer must not flip back to Stop');
  });

  test('the message sent just before Stop is kept in its conversation', async () => {
    await sendWhileLoading('Keep me');
    sendBtn().click();

    const saved = await waitFor(
      async () => ((await getApi('chats')) as { chats: Chat[] }).chats.find((c) => c.title === 'Keep me'),
      'the conversation to be saved rather than discarded when the reply is cancelled',
    );
    const full = (await getApi(`chats/${saved.id}`)) as Chat;
    assert.deepEqual(full.messages, [{ role: 'user', content: 'Keep me' }]);
  });

  // Leaving the conversation mid-load is not the same as cancelling, and must not need the
  // Stop handle: the reply drops itself because it no longer owns the conversation (#951).
  test('leaving the conversation while the model loads also asks for no reply', async () => {
    const loading = await sendWhileLoading('Abandon me');
    $<HTMLButtonElement>('.mt-new').click();
    await settle();
    assert.equal(sendBtn().textContent, 'Send', 'the conversation just opened cannot be stuck on Stop');

    loading.emit({ type: 'ready', device: 'wasm' });
    for (let i = 0; i < 40; i++) {
      assert.equal(generateCount(), 0, 'the abandoned reply was asked for after the load finished');
      await settle(10);
    }
  });

  test('the next message reuses the model whose load was left to finish', async () => {
    const loading = await sendWhileLoading('Cancel me');
    sendBtn().click();
    await settle();
    loading.emit({ type: 'ready', device: 'wasm' });
    await settle();

    await send('Ask again');
    assert.equal(worker(), loading, 'cancelling a reply must not cost a model reload');

    loading.emit({ type: 'done', run: lastRun(), text: 'Answered.' });
    await waitFor(() => env.document.body.textContent?.includes('Answered.') || undefined, 'the reply to render');
  });
});

describe('a generation belongs to the conversation it was started in (#951)', () => {
  beforeEach(async () => {
    await mount();
  });
  afterEach(unmount);

  test('a reply that lands after the user opened another chat is NOT written into it', async () => {
    // An existing conversation the user will switch to mid-reply.
    const other = (await jsonApi('POST', 'chats', {
      title: 'Groceries',
      messages: [
        { role: 'user', content: 'Shopping list?' },
        { role: 'assistant', content: 'Bread, milk.' },
      ],
    })) as Chat;

    // Ask something in a NEW conversation and start generating.
    await send('What is the capital of France?');
    const abandonedRun = lastRun();

    // Switch to the other conversation while the reply is still streaming.
    await openFromSidebar('Groceries');

    // The abandoned generation now completes. Assert repeatedly rather than once after a
    // sleep: a negative assertion taken too early passes for the wrong reason, so this
    // both gives the write every chance to land and fails the moment it does.
    worker().emit({ type: 'done', run: abandonedRun, text: 'Paris.' });
    for (let i = 0; i < 40; i++) {
      const reloaded = (await getApi(`chats/${other.id}`)) as Chat;
      assert.deepEqual(
        reloaded.messages,
        [
          { role: 'user', content: 'Shopping list?' },
          { role: 'assistant', content: 'Bread, milk.' },
        ],
        'the reply to a question asked elsewhere leaked into this conversation',
      );
      await settle(10);
    }
    assert.equal(
      env.document.body.textContent?.includes('Paris.'),
      false,
      'the abandoned reply was rendered into the conversation now on screen',
    );
  });

  test('switching chats mid-reply leaves the composer on Send, not stuck on Stop', async () => {
    await send('Hello?');
    assert.equal(sendBtn().textContent, 'Stop', 'generating, so the button offers Stop');
    const abandoned = worker();

    $<HTMLButtonElement>('.mt-new').click();
    await settle();

    assert.equal(sendBtn().textContent, 'Send', 'the new conversation cannot be sent in');
    // The abandoned run is STOPPED, not disposed: the engine routes replies by run id
    // (#967), so the worker — and the loaded model — stays resident for the next send.
    assert.equal(abandoned.terminated, false, 'navigation must not tear the model down');
    assert.equal(
      abandoned.posted.some((m) => m.type === 'stop'),
      true,
      'the abandoned generation is told to stop',
    );

    // And a message really can be sent in the new conversation.
    await send('Second question');
  });

  // A session used to have ONE callback slot, which the next `send()` overwrote — a `done`
  // from the abandoned run was therefore delivered to the NEXT run's callbacks, and the
  // teardown had to dispose the whole worker to prevent it. The engine now routes every
  // message by run id and drops a stopped run's stragglers (#967), so the session — and the
  // loaded model — survives navigation, and this holds on ONE shared worker.
  test('a stopped run cannot report back into the next conversation', async () => {
    await send('First question');
    const abandoned = worker();
    const abandonedRun = lastRun();

    $<HTMLButtonElement>('.mt-new').click();
    await settle();
    await send('Second question');
    assert.equal(worker(), abandoned, 'the session stays resident: one worker serves both conversations');

    // The abandoned run finishes late, properly stamped with its own run id. Nothing it
    // says may reach the live conversation.
    abandoned.emit({ type: 'done', run: abandonedRun, text: 'Answer to the FIRST question.' });
    await settle(100);
    assert.equal(
      env.document.body.textContent?.includes('Answer to the FIRST question.'),
      false,
      "the abandoned run's reply was delivered to the conversation now on screen",
    );
    assert.equal(sendBtn().textContent, 'Stop', 'the live generation is still running');
  });

  test('the message the user already sent is kept in the chat they sent it in', async () => {
    await send('Do not lose me');
    $<HTMLButtonElement>('.mt-new').click();

    const saved = await waitFor(
      async () => ((await getApi('chats')) as { chats: Chat[] }).chats.find((c) => c.title === 'Do not lose me'),
      'the abandoned conversation to be saved rather than discarded',
    );
    const full = (await getApi(`chats/${saved.id}`)) as Chat;
    assert.deepEqual(full.messages, [{ role: 'user', content: 'Do not lose me' }]);
  });
});

describe('Retry loads the model instead of bailing silently (#952)', () => {
  beforeEach(async () => {
    await mount();
  });
  afterEach(unmount);

  test('Retry regenerates in a conversation reopened with no resident session', async () => {
    const chat = (await jsonApi('POST', 'chats', {
      title: 'Earlier chat',
      messages: [
        { role: 'user', content: 'Two plus two?' },
        { role: 'assistant', content: 'Five.' },
      ],
    })) as Chat;

    // Reopen it from the sidebar: `openChat` never builds a session, which is what used to
    // make Retry a no-op.
    await openFromSidebar('Earlier chat');

    const before = FakeWorker.instances.length;
    (await waitFor(() => env.document.querySelector<HTMLButtonElement>('.kimtai-regen'), 'the Retry button')).click();
    await waitFor(
      () => FakeWorker.instances.length > before || undefined,
      'Retry to load the model (it used to bail silently with no session resident)',
    );
    worker().emit({ type: 'ready', device: 'wasm' });
    await waitFor(() => worker().posted.some((m) => m.type === 'generate') || undefined, 'Retry to ask for a reply');

    worker().emit({ type: 'done', run: lastRun(), text: 'Four.' });
    const reloaded = await waitFor(async () => {
      const c = (await getApi(`chats/${chat.id}`)) as Chat;
      return c.messages?.some((m) => m.content === 'Four.') ? c : undefined;
    }, 'the regenerated reply to replace the old one');
    assert.deepEqual(reloaded.messages, [
      { role: 'user', content: 'Two plus two?' },
      { role: 'assistant', content: 'Four.' },
    ]);
  });
});

describe('chat rows carry a timestamp (#953)', () => {
  beforeEach(async () => {
    await mount();
  });
  afterEach(unmount);

  test('the chats route serves `at`, and the sidebar row renders a date', async () => {
    await jsonApi('POST', 'chats', { title: 'Dated chat', messages: [{ role: 'user', content: 'Hi' }] });
    const { chats } = (await getApi('chats')) as { chats: ({ at?: number } & Chat)[] };
    const listed = chats.find((c) => c.title === 'Dated chat')!;
    assert.equal(typeof listed.at, 'number', 'the summary must carry the field the sidebar reads');

    $<HTMLButtonElement>('.mt-new').click();
    const row = await waitFor(
      () => rows().find((r) => r.textContent?.includes('Dated chat')),
      'the sidebar row for the seeded chat',
    );
    const date = row.querySelector('.mt-history-date')!.textContent ?? '';
    assert.notEqual(date.trim(), '', 'the row shows no date — the shared fallback is suppressed again');
  });
});
