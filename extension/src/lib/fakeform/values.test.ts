// Kind -> value, honouring the field's own constraints.
//
// The point of these cases is the constraints. A value that ignores maxlength/min/max/step is
// not a smaller bug than a wrong TYPE — it fails the form's validation, and now the tester is
// debugging the filler instead of their form.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFieldInfo } from './detect.js';
import { createFillContext, valueFor } from './values.js';

const ctx = () => createFillContext(2026, new Date(2026, 5, 15));
const forKind = (kind: Parameters<typeof valueFor>[0], over: Parameters<typeof emptyFieldInfo>[0] = {}) =>
  valueFor(kind, emptyFieldInfo(over), ctx());

describe('valueFor: the field takes its value from the page', () => {
  for (const kind of ['select', 'checkbox', 'radio', 'skip'] as const) {
    test(`${kind} returns null (the generator has no say)`, () => {
      assert.equal(forKind(kind), null);
    });
  }
});

describe('valueFor: constraints are honoured', () => {
  test('maxlength truncates — a script-set value is NOT auto-truncated by the browser', () => {
    const value = forKind('paragraph', { maxLength: 12 });
    assert.ok(value !== null && value.length <= 12, `got ${value?.length} chars`);
  });

  test('a number stays within min/max', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const value = valueFor('number', emptyFieldInfo({ min: '10', max: '20' }), createFillContext(seed));
      const n = Number(value);
      assert.ok(n >= 10 && n <= 20, `${n} out of [10,20]`);
    }
  });

  test('step decides the decimal places', () => {
    assert.match(String(valueFor('number', emptyFieldInfo({ min: '0', max: '5', step: '0.01' }), ctx())), /\.\d{2}$/);
    assert.doesNotMatch(String(forKind('number', { min: '0', max: '5', step: '1' })), /\./);
  });

  test('a date is clamped inside the field min/max', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const value = valueFor('date', emptyFieldInfo({ min: '2026-06-01', max: '2026-06-30' }), createFillContext(seed));
      assert.ok(value! >= '2026-06-01' && value! <= '2026-06-30', value ?? 'null');
    }
  });

  test('a password never exceeds a short maxlength', () => {
    assert.ok((forKind('password', { maxLength: 10 }) ?? '').length <= 10);
  });
});

describe('valueFor: shapes that a form actually validates', () => {
  test('email is a reserved deliverable-nowhere address', () => {
    assert.match(forKind('email')!, /@example\.(com|org|net)$/);
  });
  test('a date input gets YYYY-MM-DD', () => {
    assert.match(forKind('date')!, /^\d{4}-\d{2}-\d{2}$/);
  });
  test('a datetime input gets the datetime-local shape', () => {
    assert.match(forKind('datetime')!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  test('a color input gets #rrggbb', () => {
    assert.match(forKind('color')!, /^#[0-9a-f]{6}$/);
  });
  test('a card expiry is MM/YY', () => {
    assert.match(forKind('card-expiry')!, /^\d{2}\/\d{2}$/);
  });
  test('a cvc is three digits', () => {
    assert.match(forKind('card-cvc')!, /^\d{3}$/);
  });
  test('an ip address is in the reserved documentation block', () => {
    assert.match(forKind('ip-address')!, /^198\.51\.100\.\d{1,3}$/);
  });
});

describe('valueFor: reproducibility', () => {
  test('the same seed fills a field the same way', () => {
    const f = emptyFieldInfo({ name: 'note' });
    assert.equal(valueFor('paragraph', f, createFillContext(500)), valueFor('paragraph', f, createFillContext(500)));
  });
});
