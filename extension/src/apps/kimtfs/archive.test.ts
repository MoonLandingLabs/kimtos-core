// The archive dispatcher and the pure extraction planner. The format readers are proven against
// real tool-made fixtures (see zip.test.ts / tar.test.ts); here we prove the layer above them:
// which formats are recognised, how a name maps to a destination, and — the two rules extraction
// must never get wrong — the zip-slip guard and the collision policy, both decided in one place
// (planExtraction) so the app and these tests cannot drift.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { buildZip } from './zip.js';
import { detectKind } from './viewer.js';
import {
  archiveFormat,
  archiveBaseName,
  canExtract,
  isCompressedArchive,
  unsupportedArchiveExt,
  isSafeEntryPath,
  uniqueChildName,
  planExtraction,
  gunzip,
  openArchive,
  UnsupportedArchiveError,
  type ArchiveItem,
} from './archive.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

// A tar.gz made by Python (gzip of the USTAR tar used in tar.test.ts): readme.txt, docs/,
// docs/big.txt (5600 bytes), café.txt, empty/.
const TGZ = Buffer.from(
  'H4sIAAAAAAAC/+2ZTQ7CIBBGWXuKOYFCBTkPtuNP0hZD0eiRPIcXk3anRo0LGqPf2zDhLdqEzJDwBXZVw9N4jCIbMrHQelgT96uUcyuUNoW2Vup+X6U9I0iKEdh30YX0K+I/2XBde1oF31DcMHWnLnIqXaDofT0R4LepfNnNMn+jb3FrzPP+T/VN/8uFTSOBDPp/nPNfbtc5b4DX818VVsv7+V9ozP9RGIa+a5jqbcvkDxzItdVQTODg4ODg4ODg4ODg4ODg4ODg4ODg4L7XvXv/Ld3qcs4b/77Pf9X8If/VFu//YzCcP7U+MrLef4SbXTxlDoA/z3+t6vM/5L8AAJCPK5LqJ10AKAAA',
  'base64',
);

// A lone gzip of "hello from the system tar tool\n".
const GZ = Buffer.from('H4sIAAAAAAAC/8tIzcnJV0grys9VKMlIVSiuLC5JBTITixRK8vNzuADROV7qHwAAAA==', 'base64');

describe('recognising formats', () => {
  test('the extractable set is exactly zip, tar, gz, tgz, tar.gz', () => {
    assert.equal(archiveFormat('photos.zip'), 'zip');
    assert.equal(archiveFormat('backup.tar'), 'tar');
    assert.equal(archiveFormat('notes.txt.gz'), 'gzip');
    assert.equal(archiveFormat('site.tgz'), 'tgz');
    assert.equal(archiveFormat('site.tar.gz'), 'tgz');
    // Case does not matter — the name is what the user typed.
    assert.equal(archiveFormat('PHOTOS.ZIP'), 'zip');
  });

  test('canExtract is true for an archive we open, false for a plain file', () => {
    for (const name of ['a.zip', 'a.tar', 'a.gz', 'a.tgz', 'a.tar.gz']) assert.equal(canExtract(name), true, name);
    for (const name of ['notes.txt', 'image.png', 'data.json', 'noext']) assert.equal(canExtract(name), false, name);
  });

  test('isCompressedArchive is true for compressed files, false for tar and plain files', () => {
    // Already compressed → "Compress to ZIP" is pointless and must be hidden.
    for (const name of ['a.zip', 'a.gz', 'a.tgz', 'a.tar.gz', 'a.7z', 'a.rar', 'a.xz', 'a.zst', 'a.bz2'])
      assert.equal(isCompressedArchive(name), true, name);
    // A bare .tar is uncompressed, and ordinary files aren't archives — both still offer Compress.
    for (const name of ['a.tar', 'notes.txt', 'image.png', 'data.json', 'noext'])
      assert.equal(isCompressedArchive(name), false, name);
  });

  test('a 7z/rar/xz/zst/bz2 is a recognised archive to the viewer but has no Extract action', () => {
    for (const name of ['a.7z', 'a.rar', 'a.xz', 'a.zst', 'a.bz2']) {
      assert.equal(detectKind(name), 'archive', `${name} is shown as an archive`);
      assert.equal(canExtract(name), false, `${name} offers no Extract`);
      assert.ok(unsupportedArchiveExt(name), `${name} is a known-unsupported ext`);
    }
  });
});

describe('the destination name', () => {
  test('is the filename minus its archive suffix', () => {
    assert.equal(archiveBaseName('photos.zip'), 'photos');
    assert.equal(archiveBaseName('site.tar.gz'), 'site');
    assert.equal(archiveBaseName('site.tgz'), 'site');
    assert.equal(archiveBaseName('backup.tar'), 'backup');
    assert.equal(archiveBaseName('notes.txt.gz'), 'notes.txt'); // a lone gzip unwraps to that file
  });
});

describe('the zip-slip guard', () => {
  test('refuses any path that escapes the destination', () => {
    for (const bad of ['../evil', '../../evil.txt', 'a/../../evil', '/etc/passwd', 'C:\\Windows\\x', '..\\evil']) {
      assert.equal(isSafeEntryPath(bad), false, bad);
    }
  });
  test('allows ordinary nested paths', () => {
    for (const ok of ['a.txt', 'docs/a.txt', 'a/b/c/d.txt', 'café.txt']) {
      assert.equal(isSafeEntryPath(ok), true, ok);
    }
  });
});

describe('the collision policy: auto-rename, never overwrite', () => {
  test('appends " (2)", " (3)" before the extension', () => {
    const taken = new Set(['file.txt', 'file (2).txt']);
    assert.equal(uniqueChildName('file.txt', taken), 'file (3).txt');
    assert.equal(uniqueChildName('fresh.txt', taken), 'fresh.txt');
    assert.equal(uniqueChildName('folder', new Set(['folder'])), 'folder (2)');
    assert.equal(uniqueChildName('.env', new Set(['.env'])), '.env (2)'); // a dotfile has no extension
  });
});

describe('planExtraction — the whole tree in one pure step', () => {
  const items: ArchiveItem[] = [
    { path: 'docs/', size: 0, isDir: true },
    { path: 'docs/a.txt', size: 1, isDir: false },
    { path: 'b.txt', size: 1, isDir: false },
  ];

  test('to a fresh folder, the tree is verbatim', () => {
    const plan = planExtraction(items, []);
    assert.deepEqual(
      plan.map((op) => `${op.kind}:${op.path}`),
      ['dir:docs', 'file:docs/a.txt', 'file:b.txt'],
    );
  });

  test('Extract Here renames a colliding file, leaving the original untouched', () => {
    const plan = planExtraction([{ path: 'b.txt', size: 1, isDir: false }], ['b.txt']);
    assert.deepEqual(
      plan.map((op) => op.path),
      ['b (2).txt'],
    );
  });

  test('Extract Here renames a colliding folder, and its children follow the new name', () => {
    const plan = planExtraction(items, ['docs']); // a sibling folder "docs" already exists
    assert.deepEqual(
      plan.map((op) => `${op.kind}:${op.path}`),
      ['dir:docs (2)', 'file:docs (2)/a.txt', 'file:b.txt'],
    );
  });

  test('an escaping entry is dropped from the plan — nothing is written outside the target', () => {
    const withEvil: ArchiveItem[] = [
      { path: 'ok.txt', size: 1, isDir: false },
      { path: '../../evil.txt', size: 1, isDir: false },
    ];
    const plan = planExtraction(withEvil, []);
    assert.deepEqual(
      plan.map((op) => op.path),
      ['ok.txt'],
    );
    assert.ok(!plan.some((op) => op.path.includes('..')));
  });
});

describe('openArchive round-trips every native format byte-identical', () => {
  const readAll = async (name: string, bytes: Uint8Array): Promise<Record<string, string>> => {
    const archive = await openArchive(name, bytes);
    const out: Record<string, string> = {};
    for (const item of archive.items) {
      if (!item.isDir) out[item.path] = dec(await archive.read(item));
    }
    return out;
  };

  test('zip', async () => {
    const zip = await buildZip([
      { path: 'readme.txt', data: enc('hello') },
      { path: 'deep/inner.json', data: enc('{"a":1}') },
    ]);
    const got = await readAll('bundle.zip', zip);
    assert.deepEqual(got, { 'readme.txt': 'hello', 'deep/inner.json': '{"a":1}' });
  });

  test('gzip — a lone member unwraps to its named file', async () => {
    const archive = await openArchive('greeting.txt.gz', new Uint8Array(GZ));
    assert.equal(archive.items.length, 1);
    assert.equal(archive.items[0]!.path, 'greeting.txt');
    assert.equal(dec(await archive.read(archive.items[0]!)), 'hello from the system tar tool\n');
  });

  test('tar', async () => {
    const tar = new Uint8Array(gunzipSync(TGZ)); // the raw tar inside the fixture
    const got = await readAll('backup.tar', tar);
    assert.equal(got['readme.txt'], 'hello from the system tar tool\n');
    assert.equal(got['docs/big.txt'], 'the same line over and over\n'.repeat(200));
    assert.equal(got['café.txt'], 'café note\n');
  });

  test('tar.gz', async () => {
    const got = await readAll('backup.tar.gz', new Uint8Array(TGZ));
    assert.equal(got['readme.txt'], 'hello from the system tar tool\n');
    assert.equal(got['docs/big.txt'], 'the same line over and over\n'.repeat(200));
    assert.equal(got['café.txt'], 'café note\n');
  });
});

describe('an unsupported format fails honestly, not with a throw the caller cannot read', () => {
  test('openArchive rejects a .7z with the honest message', async () => {
    await assert.rejects(
      () => openArchive('secret.7z', enc('7z\xbc\xaf')),
      (err) => {
        assert.ok(err instanceof UnsupportedArchiveError);
        assert.match(err.message, /can’t open \.7z/);
        return true;
      },
    );
  });
});

describe('gunzip', () => {
  test('decompresses a single-member stream', async () => {
    assert.equal(dec(await gunzip(new Uint8Array(GZ))), 'hello from the system tar tool\n');
  });
});
