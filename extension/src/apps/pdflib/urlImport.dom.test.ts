// Adding a PDF by URL must refuse an over-size file WITHOUT reading it into memory first.
//
// The URL is the user's. The route used to do `await res.arrayBuffer()` and only then measure the
// result, so the size cap was enforced against a buffer that was already in the tab — a URL
// pointing at something enormous could exhaust it before the check ever ran (#1304).
//
// Driven through the real route, with a stubbed `fetch`: what is asserted is what the route did to
// the RESPONSE — whether it read the body at all, and how much of it.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';
import { PDF_MAX_BYTES } from '../../lib/limits.js';

let env: DomEnv;
let realFetch: unknown;

/**
 * A response whose body arrives in chunks, counting how many bytes were actually pulled.
 *
 * `highWaterMark: 0` so the stream never reads ahead of the consumer. With the default strategy it
 * buffers a chunk or two eagerly, and the count would then measure the stream's appetite rather
 * than the route's — which is the whole thing under test.
 */
function chunkedResponse({ total, declared, chunk = 64 * 1024 }: { total: number; declared?: number; chunk?: number }) {
  const pulled = { bytes: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled.bytes >= total) {
          controller.close();
          return;
        }
        const size = Math.min(chunk, total - pulled.bytes);
        pulled.bytes += size;
        controller.enqueue(new Uint8Array(size));
      },
      cancel() {
        pulled.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers();
  if (declared !== undefined) headers.set('content-length', String(declared));
  return { res: new Response(body, { status: 200, headers }), pulled };
}

async function routes() {
  await import('./pdflib.local.js'); // registers the handlers (idempotent module init)
  const { dispatch } = await import('../../lib/localRouter.js');
  const { dataStore } = await import('../../lib/dataStore.js');
  return { dispatch, dataStore };
}

describe('pdflib: adding by URL is capped against the network, not against memory', () => {
  beforeEach(() => {
    env = installDom();
    realFetch = (globalThis as unknown as Record<string, unknown>).fetch;
  });
  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
    env.cleanup();
  });

  test('a declared Content-Length over the limit is refused without reading a byte', async () => {
    const { res, pulled } = chunkedResponse({ total: PDF_MAX_BYTES * 2, declared: PDF_MAX_BYTES * 2 });
    (globalThis as unknown as Record<string, unknown>).fetch = async () => res;
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('pdf-cap-a');

    await assert.rejects(
      () => dispatch('POST', 'books', { body: { url: 'https://example.test/huge.pdf' } }),
      /larger than the/,
      'the user is told it is over the limit',
    );
    assert.equal(pulled.bytes, 0, 'and not one byte of it was read');
  });

  test('a body that declares nothing is cut off at the cap rather than read whole', async () => {
    // The honest worst case: no Content-Length, or a lying one. The only defence is measuring as
    // it arrives.
    const { res, pulled } = chunkedResponse({ total: PDF_MAX_BYTES * 3 });
    (globalThis as unknown as Record<string, unknown>).fetch = async () => res;
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('pdf-cap-b');

    await assert.rejects(
      () => dispatch('POST', 'books', { body: { url: 'https://example.test/lying.pdf' } }),
      /larger than the/,
    );
    assert.ok(
      pulled.bytes <= PDF_MAX_BYTES + 64 * 1024,
      `stopped near the cap, not at the end: pulled ${pulled.bytes} of ${PDF_MAX_BYTES * 3}`,
    );
    assert.equal(pulled.cancelled, true, 'and the transfer was cancelled rather than left running');
  });

  test('a file within the limit still gets through, and is still checked for being a PDF', async () => {
    const { res } = chunkedResponse({ total: 1024, declared: 1024 });
    (globalThis as unknown as Record<string, unknown>).fetch = async () => res;
    const { dispatch, dataStore } = await routes();
    dataStore.setWorkspace('pdf-cap-c');

    // Zero bytes are not a PDF, so the NEXT guard is what rejects it — which is the proof that the
    // size cap let it through.
    await assert.rejects(
      () => dispatch('POST', 'books', { body: { url: 'https://example.test/small.bin' } }),
      /doesn't point to a PDF/,
    );
  });
});
