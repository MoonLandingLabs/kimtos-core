// The TAR reader, tested against a real archive — one written by Python's `tarfile` (USTAR) and
// gzipped by Python's `gzip`, not by us. A reader we can only check with our own writer proves
// nothing; this fixture is produced by code we did not write, exactly as zip.test.ts checks the
// zip container. The bytes below are the tar.gz; `gunzipSync` (Node's zlib, also not us) hands
// back the raw tar the reader walks.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { listTar, readTarEntry } from './tar.js';

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

// A tar.gz made by Python, holding a USTAR tar of:
//   readme.txt    "hello from the system tar tool\n"
//   docs/         a directory entry
//   docs/big.txt  200 repeats of "the same line over and over\n" (5600 bytes)
//   café.txt      a UTF-8 name
//   empty/        an empty directory entry
const TGZ = Buffer.from(
  'H4sIAAAAAAAC/+2ZTQ7CIBBGWXuKOYFCBTkPtuNP0hZD0eiRPIcXk3anRo0LGqPf2zDhLdqEzJDwBXZVw9N4jCIbMrHQelgT96uUcyuUNoW2Vup+X6U9I0iKEdh30YX0K+I/2XBde1oF31DcMHWnLnIqXaDofT0R4LepfNnNMn+jb3FrzPP+T/VN/8uFTSOBDPp/nPNfbtc5b4DX818VVsv7+V9ozP9RGIa+a5jqbcvkDxzItdVQTODg4ODg4ODg4ODg4ODg4ODg4ODg4L7XvXv/Ld3qcs4b/77Pf9X8If/VFu//YzCcP7U+MrLef4SbXTxlDoA/z3+t6vM/5L8AAJCPK5LqJ10AKAAA',
  'base64',
);
const REAL_TAR = new Uint8Array(gunzipSync(TGZ));

describe('reading a tar made by another tool', () => {
  const bytes = REAL_TAR;

  test('lists every entry, files and directories alike', () => {
    const paths = listTar(bytes)
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ['café.txt', 'docs/', 'docs/big.txt', 'empty/', 'readme.txt']);
  });

  test('marks directories, and gives them no size', () => {
    const docs = listTar(bytes).find((e) => e.path === 'docs/')!;
    assert.equal(docs.isDir, true);
    assert.equal(docs.size, 0);
  });

  test('reads a small entry back byte-identical', () => {
    const readme = listTar(bytes).find((e) => e.path === 'readme.txt')!;
    assert.equal(dec(readTarEntry(bytes, readme)), 'hello from the system tar tool\n');
  });

  test('reads a multi-block entry back byte-identical', () => {
    const big = listTar(bytes).find((e) => e.path === 'docs/big.txt')!;
    const data = readTarEntry(bytes, big);
    assert.equal(data.length, 5600);
    assert.equal(dec(data), 'the same line over and over\n'.repeat(200));
  });

  test('decodes a UTF-8 name', () => {
    const cafe = listTar(bytes).find((e) => e.path === 'café.txt')!;
    assert.equal(dec(readTarEntry(bytes, cafe)), 'café note\n');
  });
});

describe('a non-tar is rejected, not read as garbage', () => {
  test('random bytes fail the header checksum', () => {
    const junk = new Uint8Array(1024);
    junk.fill(0x41); // 'A' — a non-zero first byte, so it is not read as the end marker
    assert.throws(() => listTar(junk), /Not a TAR/);
  });
});
