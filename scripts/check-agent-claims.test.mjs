// The checker that polices agent claims, checked against its own false positives.
//
// It shipped a rule — a bare /\bcan drive\b/i, anchored to no subject — that flagged the word
// "drive" in any sentence (#213). Nothing caught it, because nothing tested it, and the first
// author to hit it did the rational thing: reworded correct prose to appease CI (3909e66).
// That is how a guard dies. So both directions are pinned here — the wolves it must catch and
// the sheep it must not.
//
//   node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flags, sentences } from './check-agent-claims.mjs';

// Real claims, taken from the booklets as they read BEFORE #170 removed them — not invented.
// If a change to the patterns stops flagging these, the checker has stopped doing its job.
const CLAIMS = [
  'Agent tools — the KimtAI assistant can list, search, read, create, copy, favorite, tag, merge, and delete clips on your behalf, all on-device.',
  'Agent tools — the built-in assistant can list, create, read, update, rename, and delete your folders and files on your behalf.',
  'The KimtAI agent can drive Tabs for you.',
  'KimtAI can drive the apps.',
  'The assistant deletes clips on request.',
];

// Honest prose. None of it claims the assistant acts; all of it must pass.
const HONEST = [
  // THE false positive that started this: "you" is the user, and the thing being driven is a
  // list, with the arrow keys.
  'Click the list once and you can drive it entirely from the keyboard:',
  'A config file can drive the build.',
  'You can drive the whole app from the keyboard.',
  // The phrasings the docs were rewritten INTO — the deferred, honest ones.
  'Tabs declares agent tools, but they do not run today.',
  'The agent cannot act on your behalf.',
  'No shipped model can call a tool yet, so the assistant is dormant.',
  'These tools are declared and inert; the assistant would retrieve your notes if it could.',
  // Ordinary product copy that happens to contain the trigger words.
  'Your data never leaves the device.',
  'Drive your workflow from the dock.',
  // THE APP'S NAME IS NOT AN AGENT (#311). An app runs, creates and updates things that are not
  // tool calls, and a local-first product says so constantly. Every one of these failed the build
  // until the verb rule stopped treating the product's own name as an actor.
  'KimtAI runs a small chat model on your own machine.',
  'KimtAI creates a new chat when you press New.',
  'KimtAI updates the model list after a download.',
  'KimtAI runs entirely in your browser.',
];

test('flags the claims the checker exists to catch', () => {
  for (const s of CLAIMS) {
    assert.equal(flags(s), true, `should be flagged as an agent claim: ${s}`);
  }
});

test('does not flag honest prose', () => {
  for (const s of HONEST) {
    assert.equal(flags(s), false, `false positive — this claims nothing: ${s}`);
  }
});

test('"drive" is an ordinary verb, not a claim on its own', () => {
  // The exact regression: the subject decides, never the verb alone.
  assert.equal(flags('you can drive it entirely from the keyboard'), false);
  assert.equal(flags('the assistant can drive the app'), true);
});

// A KNOWN, DELIBERATE GAP — pinned so it is a decision and not a surprise.
//
// A claim whose subject is "the AI" or "the model" is NOT caught, because those words are not
// in SUBJECT. Putting them there was tried and measured: it turns nine honest sentences in our
// own booklets into violations ("the model runs in a Web Worker", "the speech-recognition
// model runs inside your browser") — a local-first product says "the model runs on your
// device" constantly, and that promises nothing about an agent acting.
//
// So the checker is deliberately narrow here. It is a backstop for the phrasings we actually
// shipped (#170), not a proof of absence. If this gap ever bites, the fix is a rule anchored
// to the OBJECT of the claim ("drive the apps", "for you"), not a wider subject list.
test('known gap: a claim subjected to "the AI" is not caught, and that is on purpose', () => {
  assert.equal(flags('The AI can drive Tabs for you.'), false);
  // The reason it stays that way:
  assert.equal(flags('The model runs in a Web Worker so streaming never blocks the UI.'), false);
  assert.equal(flags('The speech-recognition model runs inside your browser.'), false);
});

// THE SECOND KNOWN GAP, and the price of the one above.
//
// A bare verb with the APP as its subject — "KimtAI deletes your clips" — is not caught, because
// the verb rule only listens to `assistant`/`agent`. That is deliberate: the alternative flags
// "KimtAI runs a small chat model on your own machine", which is the product's central promise
// and which really did fail the build (#311).
//
// It costs little. The copy this checker was built to kill said "the assistant CAN delete your
// clips on your behalf" — a capability claim — and that is still caught, whoever the subject is.
// A flat present-tense assertion that the app deletes your data is not a phrasing we have ever
// shipped. If it ever appears, the fix is the one this file already prescribes: a rule anchored
// to the OBJECT of the claim ("your files", "for you"), not a wider subject list.
test('known gap: a bare verb with the APP as subject is not caught, and that is on purpose', () => {
  assert.equal(flags('KimtAI deletes your clips.'), false);
  // The reason it stays that way — all true, all honest, all previously rejected (#311):
  assert.equal(flags('KimtAI runs a small chat model on your own machine.'), false);
  assert.equal(flags('KimtAI creates a new chat when you press New.'), false);
  // And the claim that matters is still caught, because a CAPABILITY claim names any subject:
  assert.equal(flags('KimtAI can delete your clips on your behalf.'), true);
  assert.equal(flags('KimtAI can drive the apps.'), true);
  // The actor-subject verb rule is untouched: this is what it exists for.
  assert.equal(flags('The assistant deletes clips on request.'), true);
  assert.equal(flags('The agent updates your tasks.'), true);
});

test('judges a sentence, not a line — a claim negated across a line wrap still passes', () => {
  // Markdown hard-wraps, so the claim and the words that deny it land on different lines.
  const wrapped = 'The agent tools are not yet\nreliable enough to be trusted with actions on your behalf.';
  const [first] = sentences(wrapped);
  assert.equal(flags(first.text), false, 'the honest paragraph must not be flagged');
});
