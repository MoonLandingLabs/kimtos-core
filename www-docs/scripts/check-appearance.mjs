// The docs must open LIGHT for a reader who has chosen nothing (#1217) — asserted against the
// BUILT page, because that is the only place the truth actually lives.
//
// `.vitepress/config.mts` sets `appearance: 'light'`, which VitePress interpolates into the
// inline `check-dark-mode` script it emits. Two things about that are outside our control:
// the string is passed through by the runtime while the TYPES only allow 'dark', and the
// script's shape is VitePress's to change. So an upgrade can quietly turn the setting back
// into "follow the OS" with nothing failing — the config still reads `appearance: 'light'`,
// the typecheck still passes, the tests still pass, and the site silently changes behaviour
// for every reader on a dark machine.
//
// This runs as `postbuild`, so it fires on `npm run build -w @kimtos/www-docs` — which is
// what the Docs CI job runs and what the local gate runs. A unit test could not do this job:
// the docs tests run in the Unit tests job with no build before them, so there is no `dist`
// for them to read.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_KEY } from 'vitepress/dist/client/shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// `outDir: './dist'` in .vitepress/config.mts — not VitePress's default `.vitepress/dist`.
// If that moves, this fails with the path it looked in rather than passing on nothing.
const INDEX = join(HERE, '..', 'dist', 'index.html');

const fail = (why) => {
  process.stderr.write(`check-appearance: ${why}\n`);
  process.exit(1);
};

if (!existsSync(INDEX)) fail(`no built page at ${INDEX} — this must run after \`vitepress build\``);

const html = readFileSync(INDEX, 'utf8');

// The bootstrap VitePress emits for `appearance`. Located by the storage key rather than by
// the script's id, so a renamed id is not mistaken for a missing script.
const script = html.split('<script').find((s) => s.includes(APPEARANCE_KEY));
if (!script) {
  fail(
    `the built page has no inline script referencing ${APPEARANCE_KEY}. Either VitePress no ` +
      `longer emits its appearance bootstrap, or \`appearance\` was removed from ` +
      `.vitepress/config.mts — in both cases the docs are back to following the reader's OS.`,
  );
}

// The whole point: with nothing stored, the fallback must be 'light'. VitePress writes it as
// `localStorage.getItem('<key>') || '<fallback>'`.
const fallback = /\|\|\s*(['"])(.*?)\1/.exec(script);
if (!fallback) fail(`could not find the fallback preference in the emitted bootstrap:\n${script.trim()}`);
if (fallback[2] !== 'light') {
  fail(
    `the built page falls back to '${fallback[2]}', not 'light'. A reader who has chosen nothing ` +
      `would get ${fallback[2] === 'auto' ? 'whatever their OS says' : `'${fallback[2]}'`}. ` +
      `Check \`appearance\` in .vitepress/config.mts still reaches VitePress's bootstrap.`,
  );
}

// And that the fallback is actually USED rather than short-circuited — `force-dark` and
// `force-auto` emit a different script entirely, with no preference lookup at all.
if (!script.includes('prefers-color-scheme')) {
  fail(
    `the emitted bootstrap no longer reads prefers-color-scheme at all, so its shape has ` +
      `changed and the fallback above may no longer mean what this check assumes:\n${script.trim()}`,
  );
}

process.stdout.write(`check-appearance: the docs open light by default (fallback '${fallback[2]}').\n`);
