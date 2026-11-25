// reclassifyClips (#948): a clip's `type` is derived at capture and re-derived only on
// an edit, so colours the old classifier missed (4/8-digit hex, oklch() and friends) sit
// in the store as `text` forever unless this one-off pass corrects them. It must fix
// exactly the disagreements, leave image clips alone, and run once per classifier
// version — not on every open.
//
// fake-indexeddb is shared across the suite, so each test uses its own workspace.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { CLIP_COLLECTION } from './clipboardShared.js';

const clip = (id: string, type: string, text: string): Record<string, unknown> => ({
  id,
  type,
  text,
  preview: text,
  hash: id,
  bytes: text.length,
  favorite: false,
  tags: [],
  createdAt: 1,
  lastUsedAt: 1,
  useCount: 1,
});

describe('reclassifyClips — the one-off type correction (#948)', () => {
  let env: DomEnv;
  afterEach(() => env.cleanup());

  test('corrects misclassified colours, leaves correct and image clips alone, and runs once', async () => {
    env = installDom();
    const { dataStore } = await import('./dataStore.js');
    const { reclassifyClips, getClip } = await import('./clipboardStore.js');

    dataStore.setWorkspace('reclass-A');
    // Captured before the fix: real colours stored as text.
    await dataStore.put(CLIP_COLLECTION, clip('c1', 'text', '#1e90ffcc'));
    await dataStore.put(CLIP_COLLECTION, clip('c2', 'text', 'oklch(.7 .1 200)'));
    // Already correct — must not be touched.
    await dataStore.put(CLIP_COLLECTION, clip('c3', 'text', 'just words'));
    await dataStore.put(CLIP_COLLECTION, clip('c4', 'color', '#fff'));
    await dataStore.put(CLIP_COLLECTION, clip('c5', 'link', 'https://example.com'));
    // An image clip's text is '' — classifyText would call that 'text'; it must be skipped.
    await dataStore.put(CLIP_COLLECTION, clip('c6', 'image', ''));

    assert.equal(await reclassifyClips(), 2, 'exactly the two misclassified colours change');
    assert.equal((await getClip('c1'))?.type, 'color');
    assert.equal((await getClip('c2'))?.type, 'color');
    assert.equal((await getClip('c3'))?.type, 'text');
    assert.equal((await getClip('c4'))?.type, 'color');
    assert.equal((await getClip('c5'))?.type, 'link');
    assert.equal((await getClip('c6'))?.type, 'image', 'image clips are never reclassified');

    assert.equal(await reclassifyClips(), 0, 'the version flag makes the second run a no-op');
  });
});
