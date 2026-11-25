// Clipboard's pure primitives. Three of the four are load-bearing in ways a type checker
// cannot see:
//
//   hashText     the DEDUPE KEY. A collision merges two different clips; an unstable hash
//                stores the same clip for ever. (The store confirms a hash hit by comparing
//                the text too, so a collision cannot silently merge — but it must be stable.)
//   classifyText drives the UI and the type filters (link / colour / text).
//   hostOf       feeds the EXCLUSION LIST. If it returns the wrong host — or '' for a URL
//                the user excluded — capture runs on a site they explicitly opted out of.
//                That is a privacy failure, not a cosmetic one.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  byteLen,
  classifyText,
  hashText,
  hostOf,
  previewOf,
  deliveryFor,
  clipboardActiveCached,
  getCaptureState,
  setCaptureState,
} from './clipboardShared.js';
import { installChrome, type FakeChrome } from '../test/domEnv.js';

// The sync gate the picker / hotkey / in-field button consult. It must start OFF so the
// chrome never flashes in the window before the real verdict resolves via watchAppInstalled
// (#469). initActiveCache is not called here, so
// this is the untouched default.
describe('clipboardActiveCached — the sync gate default', () => {
  test('defaults to off (false) until the installed set is confirmed', () => {
    assert.equal(clipboardActiveCached(), false);
  });
});

describe('hashText — the dedupe key', () => {
  test('is stable: the same text always hashes the same', () => {
    assert.equal(hashText('hello world'), hashText('hello world'));
  });

  test('is sensitive: text that differs by one character does not collide', () => {
    assert.notEqual(hashText('hello world'), hashText('hello worlD'));
    assert.notEqual(hashText('a'), hashText('b'));
  });

  test('whitespace is significant — " a" and "a " are different clips', () => {
    assert.notEqual(hashText(' a'), hashText('a '));
    assert.notEqual(hashText('a'), hashText('a '));
  });

  test('the empty string hashes without throwing', () => {
    assert.doesNotThrow(() => hashText(''));
  });

  test('no collisions across a realistic set of clips', () => {
    const clips = [
      'https://example.com',
      'https://example.com/',
      '#ff0000',
      '#ff0001',
      'password123',
      'Password123',
      'the quick brown fox',
      'the quick brown fox ',
      '',
      ' ',
    ];
    const hashes = new Set(clips.map(hashText));
    assert.equal(hashes.size, clips.length, 'two different clips hashed the same');
  });
});

describe('classifyText — what kind of clip is this', () => {
  test('an http(s) URL is a link', () => {
    assert.equal(classifyText('https://example.com/x?y=1'), 'link');
    assert.equal(classifyText('http://example.com'), 'link');
  });

  test('surrounding whitespace does not stop a link being recognised', () => {
    assert.equal(classifyText('  https://example.com  '), 'link');
  });

  test('a URL with a space in it is NOT a link (it is pasted prose)', () => {
    assert.equal(classifyText('see https://example.com now'), 'text');
  });

  // The full CSS Color 4 surface (#948): every hex length and every functional
  // syntax classifies as a colour; anything merely colour-adjacent stays text.
  test('a hex colour is a colour, in all four lengths and either case', () => {
    for (const hex of ['#fff', '#abcd', '#FF0000', '#1e90ffcc', '#ABCD', '#1E90FFCC']) {
      assert.equal(classifyText(hex), 'color', hex);
    }
  });

  test('every CSS colour function is a colour', () => {
    for (const fn of [
      'rgb(255, 0, 0)',
      'rgba(1, 2, 3, .5)',
      'hsl(120, 50%, 50%)',
      'hsla(0, 100%, 50%, 0.5)',
      'hwb(0deg 0% 0%)',
      'lab(52.2% 40.2 59.2)',
      'lch(52.2% 72.2 50)',
      'oklab(0.7 0.1 0.1)',
      'oklch(.7 .1 200)',
      'color(srgb 1 0 0)',
      'OKLCH(0.7 0.1 200)',
    ]) {
      assert.equal(classifyText(fn), 'color', fn);
    }
  });

  test('near-misses stay text: wrong hex lengths, non-hex digits, unclosed or bare functions', () => {
    for (const not of [
      '#12345', // 5 digits — no hex form has 5
      '#1234567', // 7 digits
      '#123456789', // 9 digits
      '#xyz', // not hex digits
      'oklch', // a function name without parentheses
      'rgb(', // opened, never closed — the old regex called this a colour
      'rgb(255, 0, 0) solid', // trailing content — the old regex called this a colour too
      'background: #1e90ff', // a colour embedded in a longer string
      'color', // the bare keyword
      'colorful(1)', // a longer word that merely starts with a function name
    ]) {
      assert.equal(classifyText(not), 'text', not);
    }
  });

  test('anything else is text', () => {
    assert.equal(classifyText('just some words'), 'text');
    assert.equal(classifyText(''), 'text');
  });
});

describe('hostOf — the exclusion list depends on this', () => {
  test('returns the host of a URL', () => {
    assert.equal(hostOf('https://example.com/a/b?c=d'), 'example.com');
  });

  test('keeps the port (a different port is a different origin)', () => {
    assert.equal(hostOf('http://localhost:5173/x'), 'localhost:5173');
  });

  test('keeps the subdomain — excluding "mail.google.com" must not exclude google.com', () => {
    assert.equal(hostOf('https://mail.google.com/u/0'), 'mail.google.com');
  });

  test('garbage and empties return "" rather than throwing', () => {
    for (const bad of [undefined, '', 'not a url', 'chrome://extensions']) {
      assert.doesNotThrow(() => hostOf(bad as string | undefined));
    }
    assert.equal(hostOf('not a url'), '');
    assert.equal(hostOf(undefined), '');
  });
});

describe('previewOf / byteLen', () => {
  test('a preview is single-line', () => {
    assert.equal(previewOf('a\n\nb   c'), 'a b c');
  });

  test('a long preview is capped and ellipsised', () => {
    const long = previewOf('x'.repeat(500));
    assert.equal(long.length, 201, '200 chars plus the ellipsis');
    assert.ok(long.endsWith('…'));
  });

  test('a short preview is untouched', () => {
    assert.equal(previewOf('short'), 'short');
  });

  test('byteLen counts UTF-8 BYTES, not characters (the storage cap is in bytes)', () => {
    assert.equal(byteLen('abc'), 3);
    assert.equal(byteLen('é'), 2, 'a 2-byte character');
    // A 4-byte character, built from its code point rather than pasted: the repo bans
    // emoji literals (check-emoji.mjs), and a plain literal here would fail Conventions.
    assert.equal(byteLen(String.fromCodePoint(0x1d11e)), 4, 'a 4-byte character (U+1D11E)');
  });
});

// deliveryFor: what a clip can actually hand the user. `none` is the case that matters — it is what
// an image clip's empty `text` used to become, and pasting it DELETED the user's selection (#250).
describe('deliveryFor', () => {
  test('an image clip delivers an IMAGE, never its empty text', () => {
    // The bug in one line: this used to be read as `text: ''` and pasted.
    assert.deepEqual(deliveryFor({ id: 'i1', type: 'image', text: '' }), { kind: 'image', id: 'i1' });
  });

  test('a text clip delivers its text', () => {
    assert.deepEqual(deliveryFor({ id: 't1', type: 'text', text: 'hello' }), { kind: 'text', text: 'hello' });
  });

  test('links and colours are text too — they carry their value in `text`', () => {
    assert.deepEqual(deliveryFor({ id: 'l1', type: 'link', text: 'https://x.test' }), {
      kind: 'text',
      text: 'https://x.test',
    });
    assert.deepEqual(deliveryFor({ id: 'c1', type: 'color', text: '#ff0000' }), { kind: 'text', text: '#ff0000' });
  });

  test('a clip with nothing to give delivers NOTHING — it must not become an empty paste', () => {
    assert.deepEqual(deliveryFor({ id: 'x', type: 'text', text: '' }), { kind: 'none' });
    assert.deepEqual(deliveryFor({ id: 'x' }), { kind: 'none' });
    assert.deepEqual(deliveryFor(null), { kind: 'none' });
    assert.deepEqual(deliveryFor(undefined), { kind: 'none' });
  });

  test('an image clip with no id cannot be fetched, so it delivers nothing', () => {
    assert.deepEqual(deliveryFor({ type: 'image', text: '' }), { kind: 'none' });
  });
});

// Capture settings are per-workspace (#489): a user's capture on/off + exclusion list (their bank,
// their password manager) must not apply to a co-user on the same browser profile. The service
// worker, the content script and the Clipboard UI all read these through get/setCaptureState.
describe('clipboard capture settings are per-workspace (#489)', () => {
  let fake: FakeChrome;
  afterEach(() => fake.cleanup());

  test("one user's exclusions + capture-off do not reach another user, and each is preserved", async () => {
    fake = installChrome({ kimtos: { workspaceId: 'A' } });
    await setCaptureState({ monitorEnabled: false, excludedSites: ['bank.example'] });

    let a = await getCaptureState();
    assert.equal(a.monitorEnabled, false);
    assert.deepEqual(a.excludedSites, ['bank.example']);

    // Same device, a different workspace.
    fake.set('kimtos', { workspaceId: 'B' });
    const b = await getCaptureState();
    assert.equal(b.monitorEnabled, true, 'B gets the default: capture on');
    assert.deepEqual(b.excludedSites, [], "B does NOT inherit A's exclusions");

    // B configures their own; A stays intact when we switch back.
    await setCaptureState({ excludedSites: ['b-only.example'] });
    fake.set('kimtos', { workspaceId: 'A' });
    a = await getCaptureState();
    assert.equal(a.monitorEnabled, false, "A's capture-off is restored");
    assert.deepEqual(a.excludedSites, ['bank.example'], "A's exclusions are intact");
  });

  test('a pre-#489 device-wide scalar is adopted into the current workspace', async () => {
    // Legacy value: a bare CaptureState (no `byWs` wrapper), signed in as A.
    fake = installChrome({
      'clipboard:capture': { monitorEnabled: false, excludedSites: ['legacy.example'] },
      kimtos: { workspaceId: 'A' },
    });
    const a = await getCaptureState();
    assert.equal(a.monitorEnabled, false, 'the legacy value applies to the current user');
    assert.deepEqual(a.excludedSites, ['legacy.example']);

    // First write migrates it under A; B then sees the default, not A's legacy exclusions.
    await setCaptureState({ notify: false });
    fake.set('kimtos', { workspaceId: 'B' });
    assert.deepEqual((await getCaptureState()).excludedSites, [], 'after migration B does not inherit them');
  });

  test('signed out reads/writes the local workspace', async () => {
    fake = installChrome({});
    await setCaptureState({ excludedSites: ['local.example'] });
    assert.deepEqual((await getCaptureState()).excludedSites, ['local.example']);
  });
});
