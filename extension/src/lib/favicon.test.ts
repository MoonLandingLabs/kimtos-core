import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { faviconUrl } from './favicon.js';

const g = globalThis as unknown as { chrome?: unknown };
const realChrome = g.chrome;
afterEach(() => {
  g.chrome = realChrome;
});

describe('faviconUrl', () => {
  test('points at the extension own _favicon endpoint, never at the page host', () => {
    g.chrome = { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` } };
    const url = faviconUrl('https://example.com/a?b=1')!;
    assert.ok(url.startsWith('chrome-extension://abc/_favicon/?'), url);
    assert.equal(new URL(url).searchParams.get('pageUrl'), 'https://example.com/a?b=1');
    assert.equal(new URL(url).searchParams.get('size'), '32');
  });

  test('is null for a non-web page, a missing url, or no extension runtime', () => {
    g.chrome = { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` } };
    assert.equal(faviconUrl('chrome://settings'), null);
    assert.equal(faviconUrl(undefined), null);
    assert.equal(faviconUrl(''), null);
    g.chrome = undefined;
    assert.equal(faviconUrl('https://example.com'), null);
  });
});
