// Picking an image clip must not destroy what you had selected.
//
// The picker listed image clips and pasted their `text`, which for an image is `''`. Pasting `''`
// is not a no-op — `setRangeText('', start, end)` REPLACES the selection with nothing. So a user
// who selected a sentence, opened the picker and chose the row labelled "Image" watched their
// sentence disappear, with nothing pasted and no error (#250).
//
// These tests drive the real picker: they open it the way the service worker does, click the row
// the way a user does, and then look at the textarea.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome, settle, type DomEnv, type FakeChrome } from '../test/domEnv.js';
import { initActiveCache } from '../lib/clipboardShared.js';

const IMAGE_CLIP = { id: 'img1', type: 'image', text: '', preview: 'Image', mime: 'image/png' };
const TEXT_CLIP = { id: 'txt1', type: 'text', text: 'pasted text', preview: 'pasted text' };
// A 1x1 png.
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let env: DomEnv;
let fake: FakeChrome;
let doc: Document;
let written: unknown[] = [];
let writeTextCalls: string[] = [];
let clipboardWriteFails = false;
let pasteItem: (text: string) => void;

/** The picker's own shadow root — everything it renders lives inside it. */
const pickerRows = (): HTMLElement[] => {
  for (const host of doc.body.querySelectorAll('div')) {
    const rows = host.shadowRoot?.querySelectorAll('.row');
    if (rows?.length) return [...rows] as HTMLElement[];
  }
  return [];
};

function installClipboardApi(): void {
  written = [];
  writeTextCalls = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      write: (items: unknown[]) => {
        if (clipboardWriteFails) return Promise.reject(new Error('denied'));
        written.push(...items);
        return Promise.resolve();
      },
      writeText: (t: string) => {
        writeTextCalls.push(t);
        return Promise.resolve();
      },
    },
  });
}

/** A focused textarea with "world" selected, i.e. a user about to replace a word. */
function focusedTextareaWithSelection(): HTMLTextAreaElement {
  const area = doc.createElement('textarea') as HTMLTextAreaElement;
  area.value = 'hello world';
  doc.body.append(area);
  area.focus();
  area.selectionStart = 6;
  area.selectionEnd = 11;
  return area;
}

async function openPickerAndPick(label: string): Promise<void> {
  fake.send({ type: 'clip:open-picker' });
  await settle(10);
  const row = pickerRows().find((r) => (r.textContent || '').trim() === label);
  assert.ok(row, `expected a row labelled "${label}" — got ${pickerRows().map((r) => r.textContent)}`);
  row!.dispatchEvent(new (globalThis as unknown as { Event: typeof Event }).Event('click', { bubbles: true }));
  await settle(10);
}

describe('the in-page picker: an image clip must never delete your text', () => {
  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    clipboardWriteFails = false;
    installClipboardApi();

    fake = installChrome({ kimtos: { installedApps: ['clipboard'] } }, (msg) => {
      if (msg.type === 'clip:list') return { clips: [IMAGE_CLIP, TEXT_CLIP] };
      if (msg.type === 'clip:image') return { dataUrl: DATA_URL, mime: 'image/png' };
      return { stored: true };
    });

    const mod = await import('./clipboardPicker.js');
    pasteItem = mod.pasteItem;
    // The picker gate now starts LOCKED (#469); prime it the way the content script
    // does (clipboardCapture calls this) so the seeded installed set unlocks it.
    initActiveCache();
    mod.initPicker();
    await settle();
  });

  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  test('the selected text SURVIVES — this is the bug', async () => {
    const area = focusedTextareaWithSelection();
    await openPickerAndPick('Image');
    assert.equal(area.value, 'hello world', 'picking an image must not delete the selection');
  });

  test('the system clipboard is not wiped when nothing is focused', async () => {
    // With no field focused, the old code fell through to writeText('') — silently emptying the
    // user's clipboard.
    await openPickerAndPick('Image');
    assert.deepEqual(writeTextCalls, [], "writeText('') must never be called");
  });

  test('the image is actually delivered — to the system clipboard', async () => {
    await openPickerAndPick('Image');
    assert.equal(written.length, 1, 'the image should be on the clipboard, one keystroke away');
  });

  test('a failed clipboard write still destroys nothing', async () => {
    // An insecure page, an old browser, a denied permission. The old fallback was to paste '' —
    // i.e. to delete the selection. There must be no such fallback.
    clipboardWriteFails = true;
    const area = focusedTextareaWithSelection();
    await openPickerAndPick('Image');
    assert.equal(area.value, 'hello world', 'a failure must not become a deletion');
    assert.equal(written.length, 0);
  });

  test('a TEXT clip still pastes, exactly as before', async () => {
    // The guard must not have broken the feature it protects.
    const area = focusedTextareaWithSelection();
    await openPickerAndPick('pasted text');
    assert.equal(area.value, 'hello pasted text', 'the selection is replaced by the clip, as intended');
  });
});

describe('pasteItem: the second line of defence', () => {
  // deliveryFor() already stops an image clip becoming an empty paste. This guards the path a
  // FUTURE caller could take by reading clip.text directly again — so it is tested, not assumed.
  beforeEach(async () => {
    env = installDom();
    doc = env.document;
    installClipboardApi();
    fake = installChrome({}, () => ({}));
    const mod = await import('./clipboardPicker.js');
    pasteItem = mod.pasteItem;
    mod.initPicker();
    await settle();
  });

  afterEach(() => {
    fake.cleanup();
    env.cleanup();
  });

  test("pasting '' into a field with a selection changes nothing", async () => {
    const area = focusedTextareaWithSelection();
    // Open the picker so it captures the field + selection the way a real pick does, then close it.
    fake.send({ type: 'clip:open-picker' });
    await settle(10);

    pasteItem('');
    assert.equal(area.value, 'hello world', 'pasting nothing must not DELETE the selection');
  });

  test("pasting '' with nothing focused does not wipe the system clipboard", async () => {
    pasteItem('');
    assert.deepEqual(writeTextCalls, []);
  });
});
