// Editing a file's content must actually change the FILE — whichever way KimtFS stores it.
//
// A file created in the app is a `text` node (content inline); a file you UPLOAD is a `blob`
// node (bytes in the blob store). Before #651 the PATCH route only ever wrote the inline
// `text` field, so an edit to an uploaded file reported "Saved", left the bytes untouched,
// and was gone the next time the file was opened. That is the worst shape a storage bug can
// take — silent, and it loses what the user just typed.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';

describe('KimtFS: editing a file writes where its bytes actually live (#651)', () => {
  let env: DomEnv;
  afterEach(() => env.cleanup());

  test('an UPLOADED text file is edited in its blob, not into a stray text field', async () => {
    env = installDom();
    const { dataStore } = await import('../../lib/dataStore.js');
    dataStore.setWorkspace('kimtfs-edit-blob');
    await import('./kimtfs.local.js');
    const { dispatch } = await import('../../lib/localRouter.js');

    const form = new FormData();
    form.append('file', new File(['before'], 'notes.md', { type: 'text/markdown' }));
    form.append('parentId', '');
    const created = (await dispatch('POST', 'kimtfs/upload', { form })) as { id: string; kind: string };
    assert.equal(created.kind, 'blob', 'precondition: an upload is stored as a blob');

    const saved = (await dispatch('PATCH', `kimtfs/nodes/${created.id}`, { body: { text: 'after' } })) as {
      size: number;
      text?: string;
    };

    const blob = await dataStore.getBlob(`kimtfs:${created.id}`);
    assert.ok(blob, 'the blob still exists');
    assert.equal(await blob!.text(), 'after', 'the edit is in the bytes the viewer reads back');
    assert.equal(saved.text, undefined, 'and no shadow copy is left on the node to disagree with them');
    assert.equal(saved.size, 5, 'the size follows the new bytes');
  });

  test('a file CREATED in the app still keeps its content inline', async () => {
    env = installDom();
    const { dataStore } = await import('../../lib/dataStore.js');
    dataStore.setWorkspace('kimtfs-edit-text');
    await import('./kimtfs.local.js');
    const { dispatch } = await import('../../lib/localRouter.js');

    const created = (await dispatch('POST', 'kimtfs/files', { body: { name: 'a.txt', text: 'one' } })) as {
      id: string;
    };
    const saved = (await dispatch('PATCH', `kimtfs/nodes/${created.id}`, { body: { text: 'two' } })) as {
      text: string;
      size: number;
    };

    assert.equal(saved.text, 'two');
    assert.equal(saved.size, 3);
    assert.equal(await dataStore.getBlob(`kimtfs:${created.id}`), null, 'and no blob is invented for it');
  });
});
