// Generates src/data/appChangelogs.ts from each app's CHANGELOG.md.
//
// The app's changelog is the SINGLE source of truth for its version — the newest entry IS
// the version. That is why `version` no longer exists in meta.ts: a second place is a place
// to drift, and it did. All 19 apps claimed 1.0.0 forever while the App Store showed that
// number to users and every bug report carried it.
//
// The extension is a browser bundle and cannot read files at runtime, so the changelogs are
// compiled in — the same approach as appInstall.ts, and the same reason: the notes for a
// version ship WITH that version.
//
// The generation itself lives in @kimtos/releaser (`compileAppChangelogs`), so the RELEASE
// path (`make release-prepare`) regenerates this exact file too — see #889. This script is only the
// build-time entry point (`prebuild`/`pretypecheck`) and stays a thin wrapper, so there is
// one generator, not two that can drift.
//
//   node scripts/gen-app-changelogs.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAppChangelogs } from '@kimtos/releaser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // repo root

try {
  const apps = await compileAppChangelogs(ROOT);
  console.log(`src/data/appChangelogs.ts: ${apps} apps`);
} catch (err) {
  // Loud, not silent. A missing changelog means the app has no version — and a silent
  // fallback to "1.0.0" is precisely the bug this replaces.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
