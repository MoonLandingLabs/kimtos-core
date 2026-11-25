// The ZIP container, tested against the real thing. A zip we can only read with our own reader
// proves nothing — every archive here is either produced by the system `zip` tool, or
// decompressed by Node's zlib, so both directions are checked against code we did not write.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildZip, listZip, readZipEntry, crc32, type ZipEntry } from './zip.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const FIXED = new Date(2026, 0, 2, 3, 4, 5); // a ZIP embeds the clock; pin it so bytes are stable

// A real archive, made by the system `zip` tool:
//   docs/         an empty-directory entry
//   docs/big.txt  5600 bytes of a repeated line, deflated
//   café.txt      a UTF-8 name
//   readme.txt    31 stored bytes
// Its local headers carry `UT`/`ux` extra fields — exactly what a naive reader trips over: it
// must take each local header's OWN name and extra lengths, not the central directory's.
const REAL_ZIP = Buffer.from(
  'UEsDBAoAAAAAAG1Y7VwAAAAAAAAAAAAAAAAFABwAZG9jcy9VVAkAA86bVGrOm1RqdXgLAAEE9QEAAAQAAAAAUEsDBBQAAAAI' +
    'AG1Y7VwsehWKOwAAAOAVAAAMABwAZG9jcy9iaWcudHh0VVQJAAPOm1RqzptUanV4CwABBPUBAAAEAAAAAO3JQQqAIBAAwHuv' +
    '2K8JLhSoQYnvD3qFh7kNzDwz3tIz2jUy7pVPlFF/HNM555xzzjnnnHPOOefctvcBUEsDBAoAAAAAAG1Y7VxQ9nTlCgAAAAoA' +
    'AAAJABwAY2Fmw6kudHh0VVQJAAPOm1RqzptUanV4CwABBPUBAAAEAAAAAGNhZsOpIOKYlQpQSwMECgAAAAAAbVjtXN/o5mYf' +
    'AAAAHwAAAAoAHAByZWFkbWUudHh0VVQJAAPOm1RqzptUanV4CwABBPUBAAAEAAAAAGhlbGxvIGZyb20gdGhlIHN5c3RlbSB6' +
    'aXAgdG9vbApQSwECHgMKAAAAAABtWO1cAAAAAAAAAAAAAAAABQAYAAAAAAAAABAA7UEAAAAAZG9jcy9VVAUAA86bVGp1eAsA' +
    'AQT1AQAABAAAAABQSwECHgMUAAAACABtWO1cLHoVijsAAADgFQAADAAYAAAAAAABAAAApIE/AAAAZG9jcy9iaWcudHh0VVQF' +
    'AAPOm1RqdXgLAAEE9QEAAAQAAAAAUEsBAh4DCgAAAAAAbVjtXFD2dOUKAAAACgAAAAkAGAAAAAAAAQAAAKSBwAAAAGNhZsOp' +
    'LnR4dFVUBQADzptUanV4CwABBPUBAAAEAAAAAFBLAQIeAwoAAAAAAG1Y7Vzf6OZmHwAAAB8AAAAKABgAAAAAAAEAAACkgQ0B' +
    'AAByZWFkbWUudHh0VVQFAAPOm1RqdXgLAAEE9QEAAAQAAAAAUEsFBgAAAAAEAAQAPAEAAHABAAAAAA==',
  'base64',
);

describe('reading a zip made by another tool', () => {
  const bytes = new Uint8Array(REAL_ZIP);

  test('lists every entry, including the directory', () => {
    const paths = listZip(bytes)
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ['café.txt', 'docs/', 'docs/big.txt', 'readme.txt']);
  });

  test('reads a stored entry', async () => {
    const readme = listZip(bytes).find((e) => e.path === 'readme.txt')!;
    assert.equal(dec(await readZipEntry(bytes, readme)), 'hello from the system zip tool\n');
  });

  test('inflates a deflated entry, past the extra fields in its local header', async () => {
    const big = listZip(bytes).find((e) => e.path === 'docs/big.txt')!;
    assert.equal(big.method, 8); // the real tool deflated it
    const data = await readZipEntry(bytes, big);
    assert.equal(data.length, 5600);
    assert.equal(dec(data.subarray(0, 27)), 'the same line over and over');
  });

  test('decodes a UTF-8 name', () => {
    assert.ok(listZip(bytes).some((e) => e.path === 'café.txt'));
  });
});

describe('writing a zip', () => {
  test('round-trips through our own reader', async () => {
    const entries: ZipEntry[] = [
      { path: 'notes.txt', data: enc('hello') },
      { path: 'deep/inner.json', data: enc('{"a":1}') },
    ];
    const zip = await buildZip(entries, FIXED);
    const list = listZip(zip);
    assert.deepEqual(
      list.map((e) => e.path),
      ['notes.txt', 'deep/inner.json'],
    );
    assert.equal(dec(await readZipEntry(zip, list[1]!)), '{"a":1}');
  });

  test('its deflate stream is real — Node inflates it, not us', async () => {
    // The round-trip above would still pass if buildZip and readZipEntry were symmetrically
    // wrong. An independent decompressor is the only thing that proves these are real bytes.
    const text = 'the same line over and over\n'.repeat(200);
    const zip = await buildZip([{ path: 'big.txt', data: enc(text) }], FIXED);
    const entry = listZip(zip)[0]!;
    assert.equal(entry.method, 8);
    const start = 30 + enc('big.txt').length; // our own headers carry no extra fields
    const payload = zip.subarray(start, start + entry.packed);
    assert.equal(inflateRawSync(payload).toString(), text);
  });

  test('stores rather than deflates when compressing would make it bigger', async () => {
    // Incompressible bytes stand in for the JPEGs and MP4s this app is mostly full of. A zip
    // that inflates its own contents is a bug the user can see.
    // A deterministic xorshift, so the test does not depend on a random seed. (An arithmetic
    // sequence is NOT good enough here — deflate finds the pattern and compresses it.)
    const noise = new Uint8Array(2048);
    let x = 0x9e3779b9;
    for (let i = 0; i < noise.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      noise[i] = x & 0xff;
    }
    const zip = await buildZip([{ path: 'noise.bin', data: noise }], FIXED);
    const entry = listZip(zip)[0]!;
    assert.equal(entry.method, 0, 'incompressible bytes must be STORED');
    assert.deepEqual(await readZipEntry(zip, entry), noise);
  });

  test('keeps an empty file empty, and an empty directory a directory', async () => {
    const zip = await buildZip(
      [
        { path: 'empty.txt', data: new Uint8Array(0) },
        { path: 'folder/', data: new Uint8Array(0) },
      ],
      FIXED,
    );
    const list = listZip(zip);
    assert.equal(list[0]!.size, 0);
    assert.equal(list[1]!.path, 'folder/');
    assert.equal((await readZipEntry(zip, list[0]!)).length, 0);
  });

  test('survives a name that is not ASCII', async () => {
    const zip = await buildZip([{ path: 'café note.txt', data: enc('ok') }], FIXED);
    assert.equal(listZip(zip)[0]!.path, 'café note.txt');
  });

  test('is byte-identical for the same input and the same clock', async () => {
    const a = await buildZip([{ path: 'a.txt', data: enc('x') }], FIXED);
    const b = await buildZip([{ path: 'a.txt', data: enc('x') }], FIXED);
    assert.deepEqual(a, b);
  });
});

describe('a damaged archive fails loudly', () => {
  test('rotted bytes are caught by the CRC, not handed back as garbage', async () => {
    const zip = await buildZip([{ path: 'a.txt', data: enc('the original contents') }], FIXED);
    const entry = listZip(zip)[0]!;
    // Flip a byte inside the payload. Without the CRC check this extracts corruption straight
    // into the user's file system, silently.
    zip[30 + 5 + 3] ^= 0xff; // header + 'a.txt' + a few bytes in
    await assert.rejects(() => readZipEntry(zip, entry), /checksum/);
  });

  test('something that is not a zip at all is rejected', () => {
    assert.throws(() => listZip(enc('this is a text file, not an archive')), /Not a ZIP/);
  });
});

test('crc32 matches the value every implementation is checked against', () => {
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
});
