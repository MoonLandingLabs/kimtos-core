// The generators — believable, and reproducible.
//
// The two properties every case here is really testing: a SEED replays exactly (so a filled
// form can be reproduced and asserted on), and every value is SAFE to actually submit (reserved
// e-mail hosts, the fiction phone range, no live card).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  address,
  createRng,
  creditCardNumber,
  hexColor,
  isoDate,
  numberIn,
  password,
  person,
  phoneNumber,
  url,
} from './fakeData.js';

describe('createRng: same seed, same output', () => {
  test('two generators with one seed agree on everything', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 50; i += 1) assert.equal(a.next(), b.next());
  });

  test('different seeds diverge', () => {
    assert.notEqual(createRng(1).next(), createRng(2).next());
  });

  test('int stays in range, inclusive of both ends', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const n = rng.int(3, 7);
      assert.ok(n >= 3 && n <= 7 && Number.isInteger(n));
      seen.add(n);
    }
    assert.ok(seen.has(3) && seen.has(7)); // both bounds are reachable
  });

  test('a whole generated person replays from its seed', () => {
    assert.deepEqual(person(createRng(42)), person(createRng(42)));
  });
});

describe('person: coherent, not random noise', () => {
  const p = person(createRng(7));

  test('the full name is the first and last', () => {
    assert.equal(p.full, `${p.first} ${p.last}`);
  });

  test('the username and email are derived from the name', () => {
    assert.ok(p.username.includes(p.first.toLowerCase()));
    assert.ok(p.username.includes(p.last.toLowerCase()));
    assert.ok(p.email.startsWith(p.username));
  });

  test('the email host is a reserved, undeliverable domain', () => {
    assert.match(p.email, /@example\.(com|org|net)$/);
  });

  test('the birth date is a real adult date', () => {
    assert.match(p.birthDate, /^\d{4}-\d{2}-\d{2}$/);
    const age = (Date.now() - Date.parse(p.birthDate)) / (365.25 * 86400000);
    assert.ok(age >= 20 && age <= 66, `age was ${age}`);
  });
});

describe('phoneNumber: reserved for fiction', () => {
  test('every number is in the 555-01xx range', () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i += 1) {
      assert.match(phoneNumber(rng), /^\+1 \(\d{3}\) 555-01\d{2}$/);
    }
  });
});

describe('password: satisfies a normal policy and is readable', () => {
  const rng = createRng(5);
  for (let i = 0; i < 100; i += 1) {
    const pw = password(rng);
    test(`sample ${i}: upper, lower, digit, symbol, length`, () => {
      assert.ok(pw.length >= 12);
      assert.match(pw, /[A-Z]/);
      assert.match(pw, /[a-z]/);
      assert.match(pw, /[0-9]/);
      assert.match(pw, /[^A-Za-z0-9]/);
      // No ambiguous glyphs, so a tester can read it back off the screen.
      assert.doesNotMatch(pw, /[O0Il1]/);
    });
  }

  test('a maxlength is honoured', () => {
    assert.ok(password(createRng(1), 10).length === 10);
    assert.ok(password(createRng(1), 8).length === 8);
  });
});

describe('creditCardNumber: passes Luhn, is not a real card', () => {
  const luhnValid = (digits: string): boolean => {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let d = Number(digits[i]);
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      double = !double;
      sum += d;
    }
    return sum % 10 === 0;
  };

  test('16 digits, Luhn-valid, Visa prefix', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i += 1) {
      const card = creditCardNumber(rng);
      assert.equal(card.length, 16);
      assert.equal(card[0], '4');
      assert.ok(luhnValid(card), card);
    }
  });
});

describe('the smaller generators', () => {
  test('numberIn respects the range and decimals', () => {
    const rng = createRng(2);
    for (let i = 0; i < 200; i += 1) {
      const n = Number(numberIn(rng, 5, 9));
      assert.ok(n >= 5 && n <= 9 && Number.isInteger(n));
    }
    assert.match(numberIn(createRng(2), 0, 1, 2), /^\d+\.\d{2}$/);
  });

  test('hexColor is a six-digit hex', () => {
    assert.match(hexColor(createRng(1)), /^#[0-9a-f]{6}$/);
  });

  test('url is https on a reserved domain', () => {
    assert.match(url(createRng(1)), /^https:\/\/www\.example\.(com|org|net)\//);
  });

  test('isoDate is local, not UTC-shifted', () => {
    // 1am on the 2nd, local: toISOString() could report the 1st in a positive-offset zone.
    assert.equal(isoDate(new Date(2026, 0, 2, 1, 0, 0)), '2026-01-02');
  });

  test('address is fully populated', () => {
    const a = address(createRng(8));
    assert.ok(a.line1 && a.city && a.region && a.country);
    assert.match(a.postalCode, /^\d{5}$/);
  });
});
