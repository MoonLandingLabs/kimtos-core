// The generated-file guard, checked against what it must catch and what it must pass.
//
// The bug it exists for: a source edit that skips the generator leaves the committed
// derived file stale, and nothing goes red (#905). So a file the generator reproduces
// byte-for-byte must pass, a file it does not must fail, a missing file must fail — and
// the guard must leave the working tree exactly as it found it, because it runs on a
// developer's dirty checkout too.
//
// The last two tests are the anti-rot ones: the guard names three files and three npm
// scripts, and runs ONE aggregate command to regenerate them. If a file is renamed, or a
// fourth target is added that the aggregate does not actually regenerate, the guard would
// quietly check nothing while still printing success. That is precisely how a guard decays
// into a no-op (#213).
//
//   node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driftedTargets, TARGETS, REGENERATE, ROOT } from './check-generated.mjs';

/** A fake tree plus a generator whose output is dictated per file. */
function fakeIo(tree, produces) {
  let runs = 0;
  return {
    tree,
    runs: () => runs,
    read: (file) => (file in tree ? tree[file] : null),
    restore: (file, content) => {
      if (content === null) delete tree[file];
      else tree[file] = content;
    },
    regenerate: () => {
      runs += 1;
      for (const [file, out] of Object.entries(produces)) {
        if (out instanceof Error) throw out;
        tree[file] = out;
      }
    },
  };
}

const target = { file: 'a.ts', source: 'a.md', fix: 'npm run gen:a' };

test('a file the generator reproduces exactly passes', () => {
  const io = fakeIo({ 'a.ts': 'same' }, { 'a.ts': 'same' });
  assert.deepEqual(driftedTargets([target], io), []);
  assert.equal(io.runs(), 1, 'the generator must actually have run');
});

test('a stale file is caught, and reported with its fix command', () => {
  const io = fakeIo({ 'a.ts': 'stale' }, { 'a.ts': 'fresh' });
  const drifted = driftedTargets([target], io);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].file, 'a.ts');
  assert.equal(drifted[0].fix, 'npm run gen:a');
  assert.equal(drifted[0].reason, 'stale');
});

test('a generated file that was never committed is caught as missing', () => {
  const io = fakeIo({}, { 'a.ts': 'fresh' });
  const drifted = driftedTargets([target], io);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].reason, 'missing');
});

test('a target nothing generates any more fails rather than passing silently', () => {
  // Absent before AND absent after: a plain before-vs-after equality check calls this
  // "in sync" and prints success while asserting nothing. That is the guard rotting.
  const io = fakeIo({}, {});
  const drifted = driftedTargets([target], io);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].reason, 'ungenerated');
});

test('one drifted file among several is reported, and only that one', () => {
  const other = { file: 'b.ts', source: 'b.md', fix: 'npm run gen:b' };
  const io = fakeIo({ 'a.ts': 'same', 'b.ts': 'stale' }, { 'a.ts': 'same', 'b.ts': 'fresh' });
  const drifted = driftedTargets([target, other], io);
  assert.deepEqual(
    drifted.map((d) => d.file),
    ['b.ts'],
  );
  assert.equal(io.runs(), 1, 'the aggregate command runs once, not once per file');
});

test('the working tree is restored, whether the file was stale, clean or absent', () => {
  const stale = fakeIo({ 'a.ts': 'stale' }, { 'a.ts': 'fresh' });
  driftedTargets([target], stale);
  assert.deepEqual(stale.tree, { 'a.ts': 'stale' }, 'a stale file must be left exactly as found');

  const absent = fakeIo({}, { 'a.ts': 'fresh' });
  driftedTargets([target], absent);
  assert.deepEqual(absent.tree, {}, 'a file the guard created must be removed again');
});

test('a generator that fails is not swallowed, and still restores the file', () => {
  const io = fakeIo({ 'a.ts': 'stale' }, { 'a.ts': new Error('boom') });
  assert.throws(() => driftedTargets([target], io), /boom/);
  assert.deepEqual(io.tree, { 'a.ts': 'stale' });
});

test('every target it checks still exists and still declares itself generated', () => {
  assert.ok(TARGETS.length >= 3, `expected the generated data files, found ${TARGETS.length}`);
  for (const target of TARGETS) {
    const path = join(ROOT, target.file);
    assert.ok(existsSync(path), `${target.file} is checked but does not exist`);
    // If one stops being generated, this guard asserts something nobody generates any more.
    assert.match(readFileSync(path, 'utf8').slice(0, 200), /GENERATED/, `${target.file} is no longer generated`);
  }
});

test('the aggregate command really regenerates every target', () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'extension', 'package.json'), 'utf8')).scripts;

  const named = (command) => {
    const m = command.match(/^npm run (\S+) -w @kimtos\/extension$/);
    assert.ok(m, `unrecognised command "${command}" — expected \`npm run <script> -w @kimtos/extension\``);
    assert.ok(scripts[m[1]], `the extension has no "${m[1]}" script`);
    return m[1];
  };

  // What `npm run gen` chains, e.g. "npm run gen:app-install && npm run gen:changelog".
  const chained = scripts[named(REGENERATE)].match(/npm run (\S+)/g).map((s) => s.replace('npm run ', ''));

  for (const target of TARGETS) {
    assert.ok(
      chained.includes(named(target.fix)),
      `${target.file}: "${target.fix}" is not part of "${REGENERATE}", so the guard never regenerates it`,
    );
  }
});
