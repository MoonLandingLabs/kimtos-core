// isHostGranted decides whether a declared host is covered by a manifest match pattern, and the
// manifest cross-check (manifestHosts.test.ts) rests on it. Get it wrong in either direction and
// the failure is silent: a missing grant blocks every model download at runtime, and a loose
// match hides an over-asking install prompt.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isHostGranted } from './manifestHost.js';

describe('isHostGranted — does a match pattern already cover this origin', () => {
  const patterns = ['https://*.hf.co/*', 'https://huggingface.co/*'];

  test('a wildcard pattern covers its subdomains AND the bare domain', () => {
    assert.equal(isHostGranted(patterns, 'https://us.aws.cdn.hf.co'), true);
    assert.equal(isHostGranted(patterns, 'https://cdn.hf.co'), true);
    assert.equal(isHostGranted(patterns, 'https://hf.co'), true);
  });

  test('an exact pattern covers only that host', () => {
    assert.equal(isHostGranted(patterns, 'https://huggingface.co'), true);
    assert.equal(isHostGranted(patterns, 'https://cdn.huggingface.co'), false);
  });

  test('an unrelated host is not covered', () => {
    assert.equal(isHostGranted(patterns, 'https://cdn.jsdelivr.net'), false);
  });

  test('a lookalike suffix does not sneak through — `nothf.co` is not `*.hf.co`', () => {
    // `endsWith('hf.co')` would wrongly pass this; the dot in `.hf.co` is the guard.
    assert.equal(isHostGranted(patterns, 'https://nothf.co'), false);
    assert.equal(isHostGranted(patterns, 'https://evil-hf.co'), false);
  });

  test('the scheme has to match — an http host is not granted by an https pattern', () => {
    assert.equal(isHostGranted(patterns, 'http://cdn.hf.co'), false);
    assert.equal(isHostGranted(['*://*.hf.co/*'], 'http://cdn.hf.co'), true);
  });
});
