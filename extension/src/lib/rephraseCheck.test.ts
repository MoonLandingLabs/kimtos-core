// checkRephrase (#644) — the guard that stops Rewordit presenting a rewrite that
// changed the meaning. The two cases from the issue are the headline tests: a
// changed time and a changed weight. The rest of the suite is about NOT crying
// wolf — a genuine rewrite must pass, including one that swaps 25 for
// twenty-five, drops a whole-hour ":00", or reorders the sentence completely.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkRephrase, numericFacts, numericMentions, describeProblems } from './rephraseCheck.js';

const kinds = (original: string, rewrite: string): string[] =>
  checkRephrase(original, rewrite).problems.map((p) => p.kind);

describe('numericFacts', () => {
  test('canonicalizes digits so notation does not matter', () => {
    assert.deepEqual([...numericFacts('1,000 items at 3.50 each')], ['1000', '3.5']);
  });

  test('a clock time is one fact, not two numbers', () => {
    assert.deepEqual([...numericFacts('at 10:00 AM')], ['10']);
    assert.deepEqual([...numericFacts('at 09:05 AM')], ['9:05']);
  });

  test('spelled-out numbers are not facts on their own', () => {
    assert.deepEqual([...numericFacts('one of the boxes')], []);
  });
});

describe('numericMentions', () => {
  test('reads spelled-out numbers, including compound runs', () => {
    assert.ok(numericMentions('twenty-five kilograms').has('25'));
    assert.ok(numericMentions('one hundred and twenty crates').has('120'));
    assert.ok(numericMentions('three thousand people').has('3000'));
  });

  test('prose ends a run, so neighbouring numbers stay separate', () => {
    const mentions = numericMentions('one of the two boxes');
    assert.ok(mentions.has('1'));
    assert.ok(mentions.has('2'));
    assert.ok(!mentions.has('3'));
  });
});

describe('checkRephrase — the cases from #644', () => {
  test('a changed time is drift', () => {
    const check = checkRephrase(
      'The meeting starts at 10:00 AM.',
      'After the meeting began at 9:05 AM, the participants were informed that they would have to wait until the next available time slot.',
    );
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((p) => p.kind === 'facts'));
    assert.ok(check.problems.some((p) => p.kind === 'length'));
    assert.match(describeProblems(check.problems), /9:05/);
  });

  test('a changed weight is drift', () => {
    const check = checkRephrase('The package weighs 25 kg.', 'It weighed about 27 kilograms.');
    assert.equal(check.ok, false);
    assert.deepEqual(
      check.problems.map((p) => p.kind),
      ['facts'],
    );
    assert.match(check.problems[0]?.message ?? '', /25 became 27/);
  });
});

describe('checkRephrase — a faithful rewrite passes', () => {
  test('a full reword with the same facts is accepted', () => {
    const check = checkRephrase('The meeting starts at 10:00 AM.', 'At 10:00 AM, the meeting will begin.');
    assert.deepEqual(check, { ok: true, problems: [] });
  });

  test('spelling a number out is not a change', () => {
    const check = checkRephrase('The package weighs 25 kg.', 'The parcel comes to twenty-five kilograms.');
    assert.equal(check.ok, true);
  });

  test('writing a spelled number as digits is not an invention', () => {
    const check = checkRephrase('The parcel weighs twenty-five kilograms.', 'The package comes to 25 kg.');
    assert.equal(check.ok, true);
  });

  test('a whole hour written without the minutes is the same time', () => {
    assert.equal(checkRephrase('The meeting starts at 10:00 AM.', 'The meeting begins at 10 AM.').ok, true);
    assert.equal(checkRephrase('The meeting starts at 10 AM.', 'The meeting begins at 10:00 AM.').ok, true);
  });

  test('a rewrite with no numbers at all is left alone', () => {
    const check = checkRephrase(
      'The manager fell ill, so the meeting was postponed.',
      'Because the manager was unwell, the meeting got delayed.',
    );
    assert.deepEqual(check, { ok: true, problems: [] });
  });

  test('one extra word on a short sentence is within the length band', () => {
    assert.equal(checkRephrase('The cat sat.', 'The cat was sitting down.').ok, true);
  });
});

describe('checkRephrase — the other drift the guard can prove', () => {
  test('a dropped number is drift', () => {
    assert.deepEqual(kinds('We shipped 12 crates to Berlin.', 'We sent crates over to Berlin.'), ['facts']);
  });

  test('an invented number is drift', () => {
    assert.deepEqual(kinds('We shipped crates to Berlin.', 'We sent 12 crates over to Berlin.'), ['facts']);
  });

  test('an answer instead of a rewrite blows the length band', () => {
    const long = 'Rewriting text means expressing the same idea in different words. '.repeat(6);
    assert.ok(kinds('Reword this line.', long).includes('length'));
  });

  test('a collapsed rewrite that drops information is drift', () => {
    const check = checkRephrase(
      'The courier collected the parcel from the office and delivered it to the warehouse before noon.',
      'It was delivered.',
    );
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((p) => p.kind === 'length'));
  });

  test('a question that stops being a question is drift', () => {
    assert.deepEqual(kinds('Where did you put the keys?', 'You put the keys somewhere.'), ['intent']);
  });

  test('a statement turned into a question is drift', () => {
    assert.deepEqual(kinds('You put the keys on the shelf.', 'Did you put the keys on the shelf?'), ['intent']);
  });

  test('an empty result is drift, not a pass', () => {
    const check = checkRephrase('The cat sat on the mat.', '   ');
    assert.equal(check.ok, false);
    assert.deepEqual(
      check.problems.map((p) => p.kind),
      ['empty'],
    );
  });
});

describe('checkRephrase — a faithful but useless rewrite', () => {
  test('echoing the input is a weak problem, not drift', () => {
    const check = checkRephrase('The cat sat on the mat.', 'the cat sat on the mat!');
    assert.equal(check.ok, true);
    assert.deepEqual(
      check.problems.map((p) => `${p.kind}:${p.severity}`),
      ['echo:weak'],
    );
  });
});

describe('describeProblems', () => {
  test('joins every message into one line', () => {
    const check = checkRephrase('The package weighs 25 kg.', 'It weighed about 27 kilograms.');
    assert.equal(describeProblems(check.problems), 'A number or time changed: 25 became 27.');
  });

  test('is empty when nothing was found', () => {
    assert.equal(describeProblems([]), '');
  });
});
