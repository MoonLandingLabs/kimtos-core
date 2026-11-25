// A model may only claim it can be stopped if its download actually takes the signal.
//
// The claim used to be implicit and wrong: `installManager` gave every download a Stop, so six
// installs rendered an enabled button, deleted their row when it was pressed, and went on
// downloading up to 300 MB (#1302). A Stop that reports success while the transfer continues is
// worse than no Stop, because the user believes they stopped it.
//
// Asserted against the SOURCE rather than by running a download: the property is "this entry's
// download forwards its signal", which is legible in the text and would otherwise need every
// engine and its worker mocked to observe. The same technique as apps/pdflib/selectLayout.test.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (): string => readFileSync(join(HERE, 'appModels.ts'), 'utf8');

/** Comments stripped, so a mention of the word in prose cannot pass for a use of it. The first
 *  version read the raw text, and a `download` whose only "signal" was in a comment above it
 *  satisfied the very check written to stop that. */
const decommented = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Each `<id>: { ... }` entry of APP_MODELS, as raw text. */
function entries(text: string): { id: string; body: string }[] {
  const start = text.indexOf('const APP_MODELS');
  const body = text.slice(start);
  return [...body.matchAll(/\n {2}(\w+): \{\n([\s\S]*?)\n {2}\},/g)].map((m) => ({ id: m[1], body: m[2] }));
}

describe('appModels: what a Stop is allowed to promise', () => {
  test('every model declares whether it can be stopped', () => {
    const missing = entries(src())
      .filter((e) => !/\bcancellable:\s*(true|false)\b/.test(e.body))
      .map((e) => e.id);
    assert.deepEqual(
      missing,
      [],
      'a new app that forgets this would inherit whatever the default happened to be, which is how #1302 shipped',
    );
  });

  test('an entry only claims it can stop when its download forwards the signal', () => {
    const lying = entries(src())
      .filter((e) => /\bcancellable:\s*true\b/.test(e.body))
      .filter((e) => {
        const download = /download:([\s\S]*?)(?:\n {4}\w+:|$)/.exec(decommented(e.body))?.[1] ?? '';
        return !/\bsignal\b/.test(download);
      })
      .map((e) => e.id);
    assert.deepEqual(lying, [], 'these promise a Stop their download cannot honour');
  });

  test('and the ones that cannot stop say so, rather than being left to a default', () => {
    const cannot = entries(src())
      .filter((e) => /\bcancellable:\s*false\b/.test(e.body))
      .map((e) => e.id);
    assert.ok(cannot.length, 'if this ever empties, every engine honours its signal and #1304 is done');
  });

  test('KimtAI passes its signal — it always could, and simply did not', () => {
    const kimtai = entries(src()).find((e) => e.id === 'kimtai');
    assert.ok(kimtai, 'the entry exists');
    assert.match(kimtai.body, /download:.*signal.*=>|download: \(onProgress, signal\)/s);
    assert.match(kimtai.body, /cancellable:\s*true/);
  });
});
