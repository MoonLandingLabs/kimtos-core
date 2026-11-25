// What FakeForm thinks a field is asking for.
//
// This is the app's whole substance: everything downstream is plumbing, and a detector that
// calls a postcode box a paragraph makes the feature worse than not having it. It is pure, so
// every case here is a plain object — no DOM, no browser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, emptyFieldInfo, isCaptcha, isFillable, type FieldKind } from './detect.js';

const kindOf = (over: Parameters<typeof emptyFieldInfo>[0]): FieldKind => detectKind(emptyFieldInfo(over));

describe('detectKind: the type attribute wins', () => {
  // The one rule the reference implementation states outright — the page author has already
  // told us the answer, so no amount of naming may override it.
  for (const [type, expected] of [
    ['email', 'email'],
    ['tel', 'tel'],
    ['url', 'url'],
    ['password', 'password'],
    ['color', 'color'],
    ['range', 'range'],
    ['time', 'time'],
    ['month', 'month'],
    ['week', 'week'],
    ['datetime-local', 'datetime'],
    ['checkbox', 'checkbox'],
    ['radio', 'radio'],
  ] as const) {
    test(`type="${type}" is ${expected} even when it is called something else`, () => {
      assert.equal(kindOf({ type, name: 'company_street_address' }), expected);
    });
  }

  test('a select is a select whatever it is named', () => {
    assert.equal(kindOf({ tag: 'select', type: '', name: 'email' }), 'select');
  });

  test('the text REFINES a type it cannot contradict: date + birthday is a birth date', () => {
    assert.equal(kindOf({ type: 'date', name: 'dob' }), 'birth-date');
    assert.equal(kindOf({ type: 'date', name: 'start_date' }), 'date');
  });

  test('number + age is an age, number + price is currency, number alone is a number', () => {
    assert.equal(kindOf({ type: 'number', name: 'age' }), 'age');
    assert.equal(kindOf({ type: 'number', name: 'unit_price' }), 'currency');
    assert.equal(kindOf({ type: 'number', name: 'seats' }), 'number');
  });
});

describe('detectKind: autocomplete beats a guess at the name', () => {
  test('a plain text input with autocomplete="given-name"', () => {
    assert.equal(kindOf({ autocomplete: 'given-name' }), 'first-name');
  });

  test('section and mode prefixes are ignored', () => {
    assert.equal(kindOf({ autocomplete: 'shipping address-level2' }), 'city');
    assert.equal(kindOf({ autocomplete: 'section-blue billing postal-code' }), 'postal-code');
  });
});

describe('detectKind: the words around the field', () => {
  test('punctuation is stripped before matching', () => {
    for (const name of ['username', 'user_name', 'user-name', 'userName', 'User.Name']) {
      assert.equal(kindOf({ name }), 'username', name);
    }
  });

  test('the label counts, not just the name', () => {
    assert.equal(kindOf({ name: 'f_2841', label: 'Postal code' }), 'postal-code');
    assert.equal(kindOf({ name: 'f_9', ariaLabel: 'Date of birth' }), 'birth-date');
    assert.equal(kindOf({ name: 'q1', placeholder: 'Your reference' }), 'text'); // no word to match
  });

  test('specific rules beat generic ones — firstName is not "a name"', () => {
    assert.equal(kindOf({ name: 'firstName' }), 'first-name');
    assert.equal(kindOf({ name: 'lastName' }), 'last-name');
    assert.equal(kindOf({ name: 'name' }), 'full-name');
    assert.equal(kindOf({ name: 'address2' }), 'address-line2');
    assert.equal(kindOf({ name: 'address1' }), 'street-address');
  });

  test('a short ambiguous word only matches as a whole word', () => {
    // "age" inside "homepage" / "message" / "package_id" must not make those age fields.
    assert.equal(kindOf({ name: 'homepage' }), 'url');
    assert.equal(kindOf({ name: 'package_id' }), 'text');
    assert.equal(kindOf({ name: 'your_age' }), 'age');
    // and "zip" must not be found inside "zipline"
    assert.equal(kindOf({ name: 'zipline_tour' }), 'text');
    assert.equal(kindOf({ name: 'zip' }), 'postal-code');
  });

  test('two sources cannot be spliced into a phrase that neither contains', () => {
    // `id="first"` + `placeholder="Name"` must not become "firstname".
    assert.equal(kindOf({ id: 'first', placeholder: 'Name' }), 'full-name');
  });

  test('class is a last resort, never a competitor', () => {
    // A real label wins outright...
    assert.equal(kindOf({ className: 'form-control city-input', label: 'Email address' }), 'email');
    // ...but on a form whose name and id are generated, the class is all there is.
    assert.equal(kindOf({ name: 'x7f2', className: 'form-control city-input' }), 'city');
  });
});

describe('detectKind: what is left alone', () => {
  test('a field the author closed off', () => {
    assert.equal(kindOf({ name: 'email', disabled: true }), 'skip');
    assert.equal(kindOf({ name: 'email', readOnly: true }), 'skip');
  });

  test('inputs that hold no user-authored value', () => {
    for (const type of ['hidden', 'submit', 'button', 'reset', 'image', 'file']) {
      assert.equal(kindOf({ type, name: 'email' }), 'skip', type);
    }
  });

  test('a CAPTCHA is the one field a program must not answer', () => {
    assert.equal(kindOf({ name: 'g-recaptcha-response' }), 'skip');
    assert.equal(kindOf({ id: 'cf-turnstile-response' }), 'skip');
    assert.ok(isCaptcha(emptyFieldInfo({ className: 'h-captcha-input' })));
  });

  test('an element that is not a field at all', () => {
    assert.equal(kindOf({ tag: 'div', type: '' }), 'skip');
    assert.ok(!isFillable(emptyFieldInfo({ tag: 'span', type: '' })));
    assert.ok(isFillable(emptyFieldInfo({ tag: 'div', type: '', editable: true })));
  });
});

describe('detectKind: the fallbacks', () => {
  test('a textarea with nothing to go on wants prose', () => {
    assert.equal(kindOf({ tag: 'textarea', type: '' }), 'paragraph');
  });

  test('a contentEditable with nothing to go on wants prose', () => {
    assert.equal(kindOf({ tag: 'div', type: '', editable: true }), 'paragraph');
  });

  test('an unrecognised text input is text', () => {
    assert.equal(kindOf({ name: 'favourite_colour_of_hat' }), 'text');
  });
});
