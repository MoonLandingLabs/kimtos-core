// The docs open light by default (#1217), asserted on the CONFIG.
//
// `scripts/check-appearance.mjs` is the real guard — it reads the built page, which is the
// only place the behaviour actually exists — but it can only run after a build, and the docs
// tests run in the Unit tests job with no build before them. So this is the cheap half: it
// catches the setting being removed or changed, which is the likeliest regression by far, and
// fails in the fast job rather than waiting for the Docs build.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_KEY } from 'vitepress/dist/client/shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Comments stripped: this file EXPLAINS the mechanism at length, quoting the very forms it
// asserts against. Matching the prose would pass on a config that sets nothing at all — which
// it briefly did.
const config = readFileSync(join(HERE, '..', '.vitepress', 'config.mts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the docs default theme (#1217)', () => {
  test('appearance is the OBJECT form with a light initial value', () => {
    // The object, not the bare string: only the object survives hydration (see the client
    // contract test below). A string 'light' builds a correct-looking page and then reverts.
    assert.match(
      config,
      /appearance:\s*\{[^}]*initialValue:\s*'light'/,
      "config.mts must set `appearance: { initialValue: 'light' }` — a bare string collapses " +
        "to 'auto' on the client, and no config at all follows the reader's OS",
    );
  });

  test('the storage key it relies on is still the one VitePress ships', () => {
    // The bootstrap reads this key; if VitePress renames it, `check-appearance.mjs` locates the
    // script by it and would report the script missing rather than the rename. Pinning it here
    // names the real cause. (`scripts/storage-disclosure.test.mjs` pins the same constant for
    // the privacy policy, for the same reason.)
    assert.equal(APPEARANCE_KEY, 'vitepress-theme-appearance');
  });

  // THE half that failed silently, and the reason this test exists at all.
  //
  // VitePress resolves `appearance` twice. The server interpolates it into the pre-paint
  // script; the client passes it to `useDark`:
  //
  //   initialValue: () => (appearance === 'dark' ? 'dark' : 'auto'),
  //   ...(typeof appearance === 'object' ? appearance : {})
  //
  // A plain string 'light' satisfies only the first — on the client it collapses to 'auto'
  // and follows the OS. The first attempt at this shipped exactly that: the built page was
  // correct, `check-appearance.mjs` passed, and the theme still flipped back to dark after
  // hydration on a dark machine. Only a browser showed it.
  //
  // The object form works because it is SPREAD LAST, overriding `initialValue`. That spread
  // is the contract; if VitePress drops it, the object silently stops overriding and we are
  // back to following the OS with everything else still green.
  test('the client still lets an object appearance override initialValue', () => {
    // Resolved rather than path-joined: this is an npm workspace, so vitepress is hoisted to
    // the ROOT node_modules and a path relative to www-docs does not exist.
    const data = readFileSync(fileURLToPath(import.meta.resolve('vitepress/dist/client/app/data.js')), 'utf8');
    assert.match(
      data,
      /initialValue[\s\S]{0,120}\.\.\.\(typeof appearance === 'object' \? appearance : \{\}\)/,
      "VitePress no longer spreads an object `appearance` over useDark's initialValue — " +
        "`appearance: { initialValue: 'light' }` has stopped overriding it, so the docs are " +
        'back to following the OS after hydration. Re-check the mechanism in .vitepress/config.mts.',
    );
  });

  test('nothing seeds that key on the reader behalf', () => {
    // Deliberate: storing a preference for someone who expressed none would make the privacy
    // policy's description of that key untrue (#1045). `appearance` writes nothing.
    assert.doesNotMatch(
      config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      /setItem/,
      'the docs config must not write to storage — the appearance setting needs no seeding',
    );
  });
});
