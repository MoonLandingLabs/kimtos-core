// A floating thing must mount through `overlayHost()`, never on `document.body` directly.
//
// Every app window can go full screen (#1251). A full-screen element is promoted to the browser's
// TOP LAYER and painted over an opaque `::backdrop`, so anything left on `document.body` is
// covered — whatever its z-index. The confirm overlay asks for 1000000 and was still invisible,
// which is why the symptom reads as impossible until you remember the top layer is not part of the
// z-index game: "Delete this recording?" appeared under the Video Recorder window, unreachable.
//
// `lib/dom.ts` -> `overlayHost(owner)` answers the question properly: the owner's document (so a
// popped-out app's overlay follows it into the floating window, #85) and its full-screen element
// when there is one. Nine overlay kinds and every `createDialog` window go through it.
//
// This guard exists because the fix is invisible at the call site. `document.body.append(overlay)`
// looks completely correct, works in every state anyone routinely tests, and fails only in full
// screen — which is exactly the state a bug hides in. One new app appending directly reintroduces
// it for that app alone, silently.
//
//   node scripts/check-overlay-host.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../extension/src', import.meta.url));

/**
 * Mounts that are NOT floating UI, each with the reason it cannot be covered by the backdrop.
 *
 * A reason is required. "It looked fine" is not one: the whole point is that every one of these
 * looks fine until something goes full screen.
 */
const EXEMPT = {
  'apps/notes/print.ts': 'A hidden print iframe, never rendered — it exists to be handed to the print dialog.',
  'apps/vidrec/mixer.ts':
    'The offscreen `.vid-offscreen` holder for the compositor video elements. Deliberately not visible.',
  'lib/fieldChip.ts':
    'A CONTENT SCRIPT, running in the visited page. Our full-screen state is in the new tab and has no bearing on it.',
  'content/clipboardPicker.ts': 'A content script, in the visited page — see lib/fieldChip.ts.',
  'content/fakeform.ts': 'A content script, in the visited page — see lib/fieldChip.ts.',
  'content/toast.ts': 'A content script, in the visited page — see lib/fieldChip.ts.',
  'controllers/appController.ts':
    'Two: a hidden host for session governance, and the first-visit onboarding overlay, which runs before any app window exists and so before anything can be full screen.',
};

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
  }
})(ROOT);

// `document.body.append(` / `.appendChild(` — the direct mount. A `pip.document.body` mount is a
// different thing (the popped-out window, which cannot be full screen here) and is not matched.
const DIRECT = /(?<![\w.])document\.body\.(?:append|appendChild)\s*\(/;

const problems = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (EXEMPT[rel]) continue;
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (DIRECT.test(line) && !line.trimStart().startsWith('//')) {
      problems.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
  });
}

// The other direction: an exemption for a file that no longer mounts anything. A stale entry is a
// standing permission nobody decided to grant.
for (const rel of Object.keys(EXEMPT)) {
  const full = join(ROOT, rel);
  let src = '';
  try {
    src = readFileSync(full, 'utf8');
  } catch {
    problems.push(`EXEMPT lists ${rel}, which no longer exists — remove the entry`);
    continue;
  }
  if (!DIRECT.test(src))
    problems.push(`EXEMPT lists ${rel}, which no longer mounts on document.body — remove the entry`);
}

if (problems.length) {
  process.stderr.write(
    'check-overlay-host: a floating element is mounted on document.body directly.\n\n' +
      problems.map((p) => `  ${p}\n`).join('') +
      '\nIn full screen the page body is behind the backdrop, so this is invisible and unreachable\n' +
      'however high its z-index. Use `overlayHost(owner)` from lib/dom.ts, which resolves the\n' +
      "owner's document AND its full-screen element.\n\n" +
      'If it is genuinely not floating UI — a hidden iframe, an offscreen holder, a content script —\n' +
      'add it to EXEMPT in this script WITH THE REASON it cannot be covered.\n',
  );
  process.exit(1);
}

process.stdout.write(`check-overlay-host: ${files.length} files, every overlay mounts through overlayHost().\n`);
