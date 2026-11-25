// The first behavioural tests in the extension (#145).
//
// modelFetch is the right thing to start with: its whole purpose is behaviour a type
// checker cannot see. `assertModelBytes` exists to reject an HTML error page served with
// HTTP 200, a truncated body and a poisoned cache entry — and `fetchModelFile` must never
// PERSIST a bad body, which is the difference between "the download failed" and "the app
// is bricked until the user clears storage".
//
// Verified against the real failure that motivated it (#140): a static host serving its
// web-page fallback for a missing file, with a 200.
//
//   npm test -w @kimtos/extension

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertModelBytes, fetchModelFile } from './modelFetch.js';

const MIN = 1000; // keep fixtures small; the real default is 1 MB
const URL_ = 'https://example.test/model.onnx';

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
/** A plausible model body: not HTML, not JSON, and big enough. */
const model = (n = MIN): Uint8Array => {
  const u = new Uint8Array(n);
  u[0] = 0x08; // protobuf varint, as a real .onnx starts
  return u;
};

describe('assertModelBytes', () => {
  test('rejects an HTML page served as a model (the #140 bug: SPA fallback with HTTP 200)', () => {
    assert.throws(() => assertModelBytes(text('<!DOCTYPE html><html>...'), URL_, MIN), /HTML\/XML page/);
  });

  test('rejects a JSON error body', () => {
    assert.throws(() => assertModelBytes(text('{"error":"not found"}'), URL_, MIN), /JSON error body/);
  });

  test('sees through leading whitespace and a BOM — the marker is the first MEANINGFUL byte', () => {
    assert.throws(() => assertModelBytes(text('\n\n   <!DOCTYPE html>'), URL_, MIN), /HTML\/XML page/);
    // UTF-8 BOM (EF BB BF) then '<'
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...text('<html>')]);
    assert.throws(() => assertModelBytes(bom, URL_, MIN), /HTML\/XML page/);
  });

  test('rejects a truncated download, and says how short it was', () => {
    assert.throws(() => assertModelBytes(model(10), URL_, MIN), /only 10 bytes/);
  });

  test('rejects an empty body', () => {
    assert.throws(() => assertModelBytes(bytes(), URL_, MIN), /only 0 bytes/);
  });

  test('accepts a real model body', () => {
    assert.doesNotThrow(() => assertModelBytes(model(), URL_, MIN));
  });

  test('does NOT check ONNX magic bytes — .onnx is raw protobuf with none, so a magic check would brick working apps', () => {
    // Deliberately unusual leading byte: still accepted, because only `<` and `{` are rejected.
    const odd = model();
    odd[0] = 0xff;
    assert.doesNotThrow(() => assertModelBytes(odd, URL_, MIN));
  });
});

// ── fetchModelFile: the cache is the part that can brick an app ───────────────
interface Stub {
  entries: Map<string, Uint8Array>;
  deletes: string[];
  puts: string[];
}
let cacheStub: Stub;
let fetches: number;

function install(body: Uint8Array, ok = true, status = 200): void {
  cacheStub = { entries: new Map(), deletes: [], puts: [] };
  fetches = 0;

  (globalThis as unknown as { caches: unknown }).caches = {
    open: async () => ({
      match: async (url: string) => {
        const hit = cacheStub.entries.get(url);
        return hit ? new Response(hit as BlobPart) : undefined;
      },
      put: async (url: string, res: Response) => {
        cacheStub.puts.push(url);
        cacheStub.entries.set(url, new Uint8Array(await res.arrayBuffer()));
      },
      delete: async (url: string) => {
        cacheStub.deletes.push(url);
        return cacheStub.entries.delete(url);
      },
    }),
  };

  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    fetches += 1;
    return new Response(ok ? (body as BlobPart) : null, { status });
  };
}

describe('fetchModelFile', () => {
  beforeEach(() => install(model()));

  test('downloads, validates, then caches — and returns the bytes', async () => {
    const out = await fetchModelFile(URL_, 'cache-v1', undefined, { minBytes: MIN });
    assert.equal(out.length, MIN);
    assert.equal(fetches, 1);
    assert.deepEqual(cacheStub.puts, [URL_], 'a good body is cached');
  });

  test('NEVER caches a bad body — an HTML fallback must not poison the cache', async () => {
    install(text('<!DOCTYPE html><html>404</html>'));
    await assert.rejects(fetchModelFile(URL_, 'c', undefined, { minBytes: MIN }), /HTML\/XML page/);
    assert.deepEqual(cacheStub.puts, [], 'nothing was persisted');
    assert.equal(cacheStub.entries.size, 0);
  });

  test('NEVER caches a truncated body', async () => {
    install(model(12));
    await assert.rejects(fetchModelFile(URL_, 'c', undefined, { minBytes: MIN }), /only 12 bytes/);
    assert.deepEqual(cacheStub.puts, []);
  });

  test('serves a valid cache hit without touching the network', async () => {
    install(model());
    cacheStub.entries.set(URL_, model());
    const out = await fetchModelFile(URL_, 'c', undefined, { minBytes: MIN });
    assert.equal(out.length, MIN);
    assert.equal(fetches, 0, 'no download for a good cache hit');
  });

  test('self-heals a POISONED cache entry: drops it, re-downloads, succeeds', async () => {
    install(model()); // the network is healthy...
    cacheStub.entries.set(URL_, text('<!DOCTYPE html>')); // ...but the cache holds junk
    const out = await fetchModelFile(URL_, 'c', undefined, { minBytes: MIN });
    assert.equal(out.length, MIN, 'returns the freshly downloaded model');
    assert.deepEqual(cacheStub.deletes, [URL_], 'the poisoned entry was deleted');
    assert.equal(fetches, 1, 'it re-downloaded rather than failing');
  });

  test('reports a failed download with its status', async () => {
    install(model(), false, 503);
    await assert.rejects(fetchModelFile(URL_, 'c', undefined, { minBytes: MIN }), /\(503\)/);
  });

  test('reports progress while downloading', async () => {
    install(model());
    const seen: number[] = [];
    await fetchModelFile(URL_, 'c', (p) => seen.push(p.loaded ?? -1), { minBytes: MIN });
    assert.ok(seen.length > 0, 'onProgress was called');
    assert.equal(seen.at(-1), MIN, 'the last report is the full size');
  });
});
