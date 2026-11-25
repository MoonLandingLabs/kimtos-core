// The guard that would have caught #1335 before Chrome did.
//
// The bug it exists for: `audioCapture` and `videoCapture` are Chrome APPS permissions.
// Declared in an extension manifest they do nothing, and Chrome warns on every load —
// but nothing in CI reads a manifest key, so they passed everything and shipped.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidPermissions, EXTENSION_PERMISSIONS, APP_ONLY } from './check-manifest-permissions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('invalidPermissions', () => {
  test('the Chrome Apps keys that caused #1335 are rejected', () => {
    const bad = invalidPermissions({ permissions: ['storage', 'audioCapture', 'videoCapture'] });
    assert.deepEqual(
      bad.map((b) => b.key),
      ['audioCapture', 'videoCapture'],
    );
  });

  test('an optional permission is checked too — Chrome ignores an invalid one either way', () => {
    const bad = invalidPermissions({ permissions: ['tabs'], optional_permissions: ['usb'] });
    assert.deepEqual(bad, [{ key: 'usb', field: 'optional_permissions' }]);
  });

  test('a typo is caught, which a deny-list of known-bad keys never would be', () => {
    assert.deepEqual(
      invalidPermissions({ permissions: ['storag'] }).map((b) => b.key),
      ['storag'],
    );
  });

  test('a valid manifest is silent', () => {
    assert.deepEqual(invalidPermissions({ permissions: ['storage', 'alarms', 'downloads.open'] }), []);
  });

  test('host permissions are left alone — they are patterns, and another guard owns them', () => {
    assert.deepEqual(invalidPermissions({ host_permissions: ['https://*.example.test/*'] }), []);
  });

  test('a manifest declaring nothing is not an error', () => {
    assert.deepEqual(invalidPermissions({}), []);
  });

  test('every key in the Apps-only advice table is genuinely invalid for an extension', () => {
    // Otherwise the message would talk a caller out of a permission that works.
    for (const key of Object.keys(APP_ONLY)) {
      assert.equal(EXTENSION_PERMISSIONS.has(key), false, `${key} is in both lists`);
    }
  });
});

describe('the shipped manifest', () => {
  test('declares only permissions Chrome grants an extension', () => {
    const manifest = JSON.parse(readFileSync(join(HERE, '..', 'extension', 'manifest.json'), 'utf8'));
    assert.deepEqual(invalidPermissions(manifest), []);
  });
});
