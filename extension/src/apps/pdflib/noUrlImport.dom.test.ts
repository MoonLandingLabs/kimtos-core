// PDF Library takes PDFs only as files the user picks. There is no route that fetches a URL, so
// Kimtos cannot be made to contact an outside host from here (the app makes no network request).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../../test/domEnv.js';

describe('pdflib: no import by URL', () => {
  test('POST books is not a route, and the upload route is', async () => {
    const env = installDom();
    try {
      await import('./pdflib.local.js');
      const { hasRoute } = await import('../../lib/localRouter.js');
      assert.equal(hasRoute('POST', 'books'), false, 'a URL import route came back');
      assert.equal(hasRoute('POST', 'books/upload'), true, 'uploading a local file must keep working');
    } finally {
      env.cleanup();
    }
  });
});
