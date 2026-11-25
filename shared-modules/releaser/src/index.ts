// @kimtos/releaser — the release pipeline as a library.
//
// It used to be two scripts plus a shell heredoc in the Makefile, with no tests, and it was
// rebuilt three times in a week. It is now one place, and it has tests over fixture git
// histories — which is the actual point of the extraction. See #121.
//
//   generateNotes(from, to)   -> markdown, bucketed New / Improved / Fixed
//   mergedPRs(from, to)       -> [{ number, title, type, scope }]
//   readChangelog()           -> [{ version, date, body }]
//   addRelease(version, notes)-> writes CHANGELOG.md
//   compile()                 -> emits extension/src/data/changelog.ts
//   diffReport(from, to)      -> { prs, commits, files, apps, workspaces }
//   prepareRelease(version)   -> notes + changelogs + commit, on a branch. No push, no tag.
//   tagRelease(version)       -> tag + push the tag, from main, once that PR is merged.
//
// The last two are deliberately separate and each refuses to do the other's job — see the
// header of release.ts for why (#1208).

export { mergedPRs, generateNotes, clean, categorize, prFiles, type MergedPR } from './notes.js';
export {
  readChangelog,
  addRelease,
  compile,
  compileAppChangelogs,
  formatFiles,
  type ChangelogEntry,
} from './changelog.js';
export { diffReport, type DiffReport } from './report.js';
export {
  prepareRelease,
  tagRelease,
  release,
  preflight,
  previousTag,
  RELEASE_BRANCH,
  type ReleaseOptions,
} from './release.js';
export {
  units,
  unitVersion,
  unitFirstReleased,
  readUnitChangelog,
  releaseUnit,
  hasChangelog,
  proposeBump,
  lockfileDrift,
  type LockDrift,
  type Unit,
  type UnitKind,
  type UnitRelease,
} from './units.js';
export { proposeBumps, type UnitBump } from './bump.js';
