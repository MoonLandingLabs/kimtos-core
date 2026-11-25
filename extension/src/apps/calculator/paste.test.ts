// parsePastedNumber pins the accept/reject boundary for Calculator paste (#816): a single
// plain number is accepted (tolerating whitespace and thousands separators), everything
// else is rejected so the paste is silently ignored.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedNumber } from './paste.js';

describe('parsePastedNumber', () => {
  test('accepts plain numbers', () => {
    assert.equal(parsePastedNumber('42'), 42);
    assert.equal(parsePastedNumber('3.14'), 3.14);
    assert.equal(parsePastedNumber('0'), 0);
    assert.equal(parsePastedNumber('.5'), 0.5);
    assert.equal(parsePastedNumber('5.'), 5);
  });

  test('accepts signs and scientific notation', () => {
    assert.equal(parsePastedNumber('-42'), -42);
    assert.equal(parsePastedNumber('+7'), 7);
    assert.equal(parsePastedNumber('1e3'), 1000);
    assert.equal(parsePastedNumber('-2.5E-2'), -0.025);
  });

  test('tolerates surrounding whitespace and thousands separators', () => {
    assert.equal(parsePastedNumber('  -42 '), -42);
    assert.equal(parsePastedNumber('1,234.5'), 1234.5);
    assert.equal(parsePastedNumber('1 234'), 1234);
    assert.equal(parsePastedNumber('\n1000\t'), 1000);
  });

  test('rejects anything that is not a single number', () => {
    for (const bad of ['', '   ', 'abc', '12+3', '1.2.3', '3px', '$5', 'Infinity', 'NaN', '--1', '1e']) {
      assert.equal(parsePastedNumber(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });
});
