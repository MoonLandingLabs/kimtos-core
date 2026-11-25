// DevTools Base64 — the UTF-8 round-trip, cross-checked against Node's own
// Base64 codec. btoa/atob speak Latin-1 code units, so unguarded use corrupts
// any non-ASCII input (#631: Arabic text failed to decode at all; #722: plain
// encode → decode returned garbage). A round-trip our own code both produces
// and consumes proves little on its own, so every encode is also compared with
// Buffer's Base64 of the same UTF-8 bytes.
//
// Emoji-range code points are written as \u escapes on purpose — literal
// colour emoji are banned repo-wide (scripts/check-emoji.mjs runs in CI).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64, decodeBase64, decodeJwt } from './lib.js';

const nodeB64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

describe('encodeBase64 / decodeBase64', () => {
  const cases: Array<[string, string]> = [
    ['ascii', 'hello, world'],
    ['empty', ''],
    ['arabic (RTL, the #631 report)', 'يوسف'],
    ['mixed direction', 'name: يوسف (Yousef) — عمر: 30'],
    ['hebrew (RTL)', 'שלום עולם'],
    ['cjk', '你好，世界。日本語のテキスト。한국어'],
    ['accents and symbols', 'café naïve — “quotes” © ±5°'],
    ['combining marks', 'éàñ'],
    ['emoji range', '\u{1F600}\u{1F680} \u{1F469}\u{200D}\u{1F4BB} \u{2764}\u{FE0F}'],
    ['surrogate-pair math letters', '\u{1D49C}\u{1D4B7}\u{1D4C8}'],
    ['null and control characters', 'a\u0000b\u0001c\ttab\nline'],
  ];
  for (const [label, text] of cases) {
    test(`round-trips ${label}`, () => {
      const encoded = encodeBase64(text);
      assert.equal(encoded, nodeB64(text)); // byte-identical to Node's codec
      assert.equal(decodeBase64(encoded), text); // and exactly restored
    });
  }

  test('round-trips a large multi-byte input without overflowing the stack', () => {
    const big = 'проверка-\u{1F9EA}-'.repeat(30_000); // ~1.5 MB of UTF-8, all multi-byte
    const encoded = encodeBase64(big);
    assert.equal(encoded, nodeB64(big)); // chunked stitching, checked against Node's codec
    assert.equal(decodeBase64(encoded), big);
  });

  test('decodes the URL-safe alphabet and forgives missing padding', () => {
    const standard = nodeB64('data?key=value+more/parts'); // yields + and /
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(decodeBase64(urlSafe), 'data?key=value+more/parts');
  });

  test('decodes Base64 wrapped across lines, as copied from an email or a log', () => {
    const wrapped = nodeB64('يوسف').replace(/(.{4})/g, '$1\n  ');
    assert.equal(decodeBase64(wrapped), 'يوسف');
  });

  test('rejects non-Base64 input with a legible message, not a raw atob error', () => {
    assert.throws(() => decodeBase64('definitely not base64!!!'), /look like Base64/);
    assert.throws(() => decodeBase64('abc%$'), /look like Base64/);
  });

  test('rejects Base64 of non-UTF-8 bytes instead of returning mojibake', () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString('base64');
    assert.throws(() => decodeBase64(binary), /aren’t UTF-8 text/);
  });
});

describe('decodeJwt', () => {
  test('decodes unpadded base64url segments carrying unicode claims', () => {
    const seg = (o: unknown): string =>
      Buffer.from(JSON.stringify(o), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const token = `${seg({ alg: 'none', typ: 'JWT' })}.${seg({ sub: '42', name: 'يوسف' })}.`;
    const out = decodeJwt(token);
    assert.match(out, /"name": "يوسف"/);
    assert.match(out, /"alg": "none"/);
  });
});
