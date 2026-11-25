// checkGrounding (#913) — the guard that stops Thoth presenting an AI summary
// that invents details as if it were grounded in the user's notes. The headline
// cases are what the model actually produced in the issue's repro: a made-up
// server address and a moved launch date/budget, stated confidently with
// citations. The rest of the suite is about NOT crying wolf — citation markers,
// whole-hour times, question echoes and spelled-out numbers must all pass.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounding, describeInvented, stripMarkers } from './grounding.js';

// The sources as the caller passes them: the question first, then each retrieved
// hit's title and text.
const sources = [
  'What is the staging server IP?',
  'Server setup',
  'The staging server IP is 192.168.4.17 and it runs Ubuntu 24.04. SSH port is 2222, user deploy.',
  'Meeting notes 2026-07-01',
  'The launch date is September 14. Budget approved: 45,000 EUR. Appointment at 9:00.',
];

describe('stripMarkers', () => {
  test('removes inline [n] markers so they are not counted as facts', () => {
    assert.ok(!stripMarkers('The IP is 192.168.4.17 [1], see also [2].').includes('[1]'));
  });

  test('leaves longer bracketed numbers alone', () => {
    assert.equal(stripMarkers('order [20260722]'), 'order [20260722]');
  });

  test('removes ordered-list enumerators at line starts and after a colon', () => {
    assert.ok(!stripMarkers('You should:\n1. Bring two photos.\n2. Bring the old passport.').match(/\d/));
  });

  test('keeps a real figure that merely ends a sentence mid-line', () => {
    assert.ok(stripMarkers('Confirmed on September 29. As for the rest, see the notes.').includes('29'));
  });
});

describe('checkGrounding', () => {
  test('passes a summary whose numbers all come from the sources', () => {
    const res = checkGrounding('The staging server IP is 192.168.4.17 [1]; SSH is on port 2222.', sources);
    assert.equal(res.ok, true);
    assert.deepEqual(res.invented, []);
  });

  test('flags an invented address (the #913 repro output)', () => {
    const res = checkGrounding('The staging server IP is 255 200 17.', sources);
    assert.equal(res.ok, false);
    assert.ok(res.invented.includes('255'));
    assert.ok(res.invented.includes('200'));
  });

  test('flags a changed date and figure', () => {
    const res = checkGrounding('The launch date is September 29 and the budget is 40,080 EUR.', sources);
    assert.equal(res.ok, false);
    assert.ok(res.invented.includes('29'));
    assert.ok(res.invented.includes('40080'));
  });

  test('does not count citation markers as invented numbers', () => {
    assert.equal(checkGrounding('The launch is September 14 [2].', sources).ok, true);
  });

  test('accepts a whole-hour time written without minutes', () => {
    // Sources say "9:00"; "at 9" carries the same fact.
    assert.equal(checkGrounding('Your appointment is at 9.', sources).ok, true);
  });

  test('allows numbers that only appear in the question', () => {
    const res = checkGrounding('Q3 ends in September.', ['When does Q3 end?', 'Planning', 'It ends in September.']);
    assert.equal(res.ok, true);
  });

  test('passes a summary with no numbers at all', () => {
    assert.equal(checkGrounding('Your notes do not cover that.', sources).ok, true);
    assert.equal(checkGrounding('', sources).ok, true);
  });

  test('does not flag spelled-out numbers (prose, not provable facts)', () => {
    assert.equal(checkGrounding('Bring two photos and the old passport.', sources).ok, true);
  });
});

describe('describeInvented', () => {
  test('names a single invented detail', () => {
    assert.equal(describeInvented(['29']), 'This summary mentions a detail not found in your notes (29).');
  });

  test('lists several and truncates past four', () => {
    const msg = describeInvented(['1', '2', '3', '4', '5']);
    assert.ok(msg.includes('details'));
    assert.ok(msg.includes('1, 2, 3, 4, …'));
  });
});
