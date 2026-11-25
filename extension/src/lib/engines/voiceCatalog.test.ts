// The Voice Studio voice palette. The catalog is load-bearing: every id must be a
// real Kokoro voice file, the accent→language mapping drives phonemisation (a UK
// voice phonemised as US sounds wrong), and the grouping is what the palette UI
// renders. No emoji may sneak into the metadata (this repo forbids them).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, DEFAULT_VOICE, TOP_VOICES, voiceById, isKnownVoice, langOf, groupedVoices } from './voiceCatalog.js';

describe('VOICES', () => {
  test('every id is unique and well-formed', () => {
    const ids = VOICES.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate voice id');
    for (const v of VOICES) assert.match(v.id, /^[ab][fm]_[a-z]+$/, `bad id ${v.id}`);
  });

  test("the id's first letter agrees with its language and gender", () => {
    for (const v of VOICES) {
      assert.equal(langOf(v.id), v.lang, `${v.id} lang mismatch`);
      assert.equal(v.id.charAt(1) === 'f' ? 'Female' : 'Male', v.gender, `${v.id} gender mismatch`);
    }
  });

  test('no emoji in any voice field', () => {
    // Emoji-presentation and variation-selected characters are banned repo-wide.
    const emoji = /\p{Extended_Pictographic}|️/u;
    for (const v of VOICES) {
      for (const field of [v.id, v.name, v.lang, v.gender, v.grade]) {
        assert.ok(!emoji.test(field), `emoji in voice ${v.id}: "${field}"`);
      }
    }
  });

  test('spans both accents and both genders', () => {
    const langs = new Set(VOICES.map((v) => v.lang));
    const genders = new Set(VOICES.map((v) => v.gender));
    assert.deepEqual([...langs].sort(), ['en-gb', 'en-us']);
    assert.deepEqual([...genders].sort(), ['Female', 'Male']);
    assert.ok(VOICES.length >= 20, 'the palette should be large');
  });
});

describe('lookups', () => {
  test('the default voice exists', () => {
    assert.ok(voiceById(DEFAULT_VOICE), 'default voice missing from catalog');
    assert.ok(isKnownVoice(DEFAULT_VOICE));
  });

  test('the preview shortlist are all real voices', () => {
    for (const id of TOP_VOICES) assert.ok(isKnownVoice(id), `top voice ${id} not in catalog`);
  });

  test('an unknown id is rejected', () => {
    assert.equal(isKnownVoice('zz_nobody'), false);
    assert.equal(voiceById('zz_nobody'), undefined);
  });

  test('langOf defaults US for an American prefix and UK for a British one', () => {
    assert.equal(langOf('af_heart'), 'en-us');
    assert.equal(langOf('am_michael'), 'en-us');
    assert.equal(langOf('bf_emma'), 'en-gb');
    assert.equal(langOf('bm_george'), 'en-gb');
  });
});

describe('groupedVoices', () => {
  test('groups cover every voice exactly once, in a stable order', () => {
    const groups = groupedVoices();
    assert.deepEqual(
      groups.map((g) => g.label),
      ['US · Female', 'US · Male', 'UK · Female', 'UK · Male'],
    );
    const flat = groups.flatMap((g) => g.voices);
    assert.equal(flat.length, VOICES.length);
    assert.equal(new Set(flat.map((v) => v.id)).size, VOICES.length);
  });
});
