// Long-running work goes through the orchestrator, not through a registry an app rolled itself.
//
// App convention 11 says anything that outlives the user's attention — a model download, a
// transcription, an export — is registered with `lib/kimtManager.ts`. Work started on the side is
// INVISIBLE: it cannot be seen, cannot be stopped, and cannot be told apart from the app having
// hung. That is the whole reason the orchestrator exists (#1172).
//
// The convention was prose, and prose is what let four apps miss it. The last one was KimtAI's
// model library, which kept a hand-rolled `activeDownloads` map with its own AbortController, its
// own listener set and its own terminal states — a re-implementation of the orchestrator, wired
// into exactly one dialog. So a download of up to a gigabyte was absent from KimtManager, from
// Stop all, and from the list a takeover names before it destroys it (#1275).
//
// WHAT IT CHECKS. An app that keeps a module-scope Map or Set of in-flight work — the shape of a
// private registry — must also mention `kimtManager`. It deliberately does not try to understand
// what the map holds: the point is to make a SECOND registry hard to add by accident, and to put
// the convention in front of whoever adds one, not to prove the first one is used correctly.
//
// It is dependency-free (it runs in the `conventions` CI job, which has no `npm ci`), so it reads
// the source text rather than parsing it.
//
//   node scripts/check-orchestrated-jobs.mjs

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = join(HERE, '..', 'extension', 'src', 'apps');

/** A module-scope `Map`/`Set` whose name says it is tracking work in flight.
 *
 *  Still anchored to the start of a line, and still a NAME heuristic — which makes it a loose net,
 *  so keeping it conservative is the point. Unanchoring it to catch a registry inside a `render()`
 *  closure (which does outlive a call, whatever the old comment here claimed) immediately flagged
 *  `const pendingHidden = new Set(...)` in Tabs: a set of rows being deleted, declared and used
 *  two lines later. The precise rule is `ownCancellation` below, and that one needs no anchor. */
export const REGISTRY_RE =
  /^(?:const|let)\s+(\w*(?:active|pending|running|inflight|inFlight|current)\w*)\s*(?::[^=]+)?=\s*new\s+(?:Map|Set)\b/gm;

/** Names that are plainly about UI state rather than work: a set of selected rows, the currently
 *  open panel. Matching those would train people to rename around the guard instead of using the
 *  orchestrator, which is worse than not checking at all. */
const UI_STATE = /^(?:current|active)(?:Tab|Panel|View|Row|Item|Id|Ids|Key|Sel|Selection|Filter|Sort)s?$/i;

/** The names a private registry is caught by, for an app's source text. */
export function privateRegistries(src) {
  return [...src.matchAll(REGISTRY_RE)].map((m) => m[1]).filter((name) => !UI_STATE.test(name));
}

/**
 * Does this app keep its own CANCELLATION — an `AbortController` held in a collection, or in a
 * type that a collection holds?
 *
 * This is the signal that separates a private registry from a legitimate map of orchestrator
 * handles, and mentioning `kimtManager` is not: Voice Studio mentioned it (for a different job)
 * while keeping a `Map` of AbortControllers for its downloads, so the guard passed it (#1304).
 * After that work the same app keeps a `Map` of Jobs — the same shape, the opposite meaning — and
 * a rule based on the collection's name or scope cannot tell the two apart. What it stores can.
 *
 * Deliberately narrow: one controller in a local, awaited and discarded, is how a single cancel is
 * written and is not a registry. It is the COLLECTION of them that re-implements the orchestrator.
 */
export function ownCancellation(src) {
  // Direct: `new Map<string, AbortController>()`, or a Set of them.
  const direct = /new\s+(?:Map|Set)\s*<[^>]*AbortController[^>]*>/.exec(src);
  if (direct) return direct[0];
  // Indirect: a type with an AbortController field, used as a collection's value.
  for (const m of src.matchAll(/interface\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (!/:\s*AbortController\b/.test(m[2])) continue;
    const held = new RegExp(`new\\s+(?:Map|Set)\\s*<[^>]*\\b${m[1]}\\b[^>]*>`).exec(src);
    if (held) return `${held[0]} (${m[1]} holds an AbortController)`;
  }
  return null;
}

/** True when the module hands its long work to the orchestrator. */
export const usesOrchestrator = (src) => src.includes('kimtManager');

export function check() {
  const problems = [];
  let scanned = 0;
  let checked = 0;

  for (const id of readdirSync(APPS_DIR).sort()) {
    const dir = join(APPS_DIR, id);
    if (!statSync(dir).isDirectory()) continue;
    // EVERY source file in the app, not just index.ts. Ten apps split their logic across four or
    // more files, so a registry in `archive.ts` beside the one in `index.ts` is the normal shape
    // of this codebase — a guard that only read the entry point would miss the very thing it is
    // for, and read as reassurance while doing it.
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    if (!files.length) continue;
    scanned++;
    // The orchestrator only has to be reached from SOMEWHERE in the app: a registry declared in
    // one file is routinely fed by a `kimtManager.start` in another.
    const sources = files.map((f) => readFileSync(join(dir, f), 'utf8'));
    const orchestrated = sources.some(usesOrchestrator);
    const found = sources.flatMap((src, i) => privateRegistries(src).map((n) => `${n} (${files[i]})`));
    // Its OWN cancellation is the disqualifying part, whatever else the app does — an app can hand
    // one job to the orchestrator and still run its downloads beside it, which is exactly what
    // happened (#1304). So this is checked even when the app mentions kimtManager.
    const owned = sources.map((src, i) => [ownCancellation(src), files[i]]).find(([hit]) => hit);
    if (owned) {
      checked++;
      problems.push(
        `  ${id}: keeps its own cancellation — ${owned[0]} in ${owned[1]}.\n` +
          `      A collection of AbortControllers IS a second orchestrator: it has its own start, its own\n` +
          `      stop and its own idea of what is in flight, and none of it is visible to KimtManager,\n` +
          `      to Stop all, or to the takeover notice that is about to destroy the work (#1275, #1304).\n` +
          `      Register each piece of work and keep the Job it hands back; cancel through that.`,
      );
      continue;
    }
    if (!found.length) continue;
    checked++;
    if (orchestrated) continue;
    problems.push(
      `  ${id}: keeps ${found.join(', ')} and never mentions kimtManager.\n` +
        `      Long-running work is registered with lib/kimtManager.ts, which is what gives it a row,\n` +
        `      a real Stop, a place in the queue and a name when a takeover is about to destroy it.\n` +
        `      Do not keep both and mirror one into the other — two registries that must agree is\n` +
        `      how this drifted (#1275).`,
    );
  }

  if (problems.length) {
    console.error('check-orchestrated-jobs: an app runs long work on its own registry.\n');
    console.error(problems.join('\n\n'));
    console.error('\nSee app convention 11 in CLAUDE.md.');
    process.exit(1);
  }
  // Say what was SCANNED, not only what matched. A guard whose subject has gone to zero prints a
  // reassuring line while checking nothing, and this one is at zero by design — the registry it was
  // written for is the one it just helped delete.
  console.log(
    checked
      ? `check-orchestrated-jobs: ${scanned} app(s) scanned, ${checked} track work in flight, all through KimtManager.`
      : `check-orchestrated-jobs: ${scanned} app(s) scanned, none keeps a private work registry.`,
  );
}

// Only when run directly, so the test can import the pure halves without tripping the check.
if (process.argv[1] === fileURLToPath(import.meta.url)) check();
