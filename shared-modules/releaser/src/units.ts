// A "releasable unit" — anything that has its own version and its own history.
//
// There are two kinds, and they had two different bugs:
//
//   APPS       all 19 declared `version: '1.0.0'` in meta.ts, that number was SHOWN to
//              users (the App Store detail dialog, and every bug report), and nothing ever
//              bumped it. NotaBoard has been rewritten repeatedly and still claimed 1.0.0.
//
//   DEPLOYABLES  www and www-docs (the static sites) had NO version at all, so there was
//              no record of what was published. When a site broke, nobody could say what
//              was live.
//
// Both are the same problem, so there is one mechanism, not two:
//
//   **The unit's CHANGELOG.md owns its version. The version IS the newest entry.**
//
// One source of truth. The version cannot drift, because there is nowhere for it to drift
// to — which is why `version` was deleted from meta.ts rather than generated into it. A
// generated field is still a second place, and one stray hand-edit re-introduces the lie.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { escapeRegExp } from './notes.js';
import { join } from 'node:path';

export type UnitKind = 'app' | 'deployable';

export interface Unit {
  /** `notaboard`, `www`, `extension` … */
  id: string;
  kind: UnitKind;
  /** Absolute path to the directory holding the CHANGELOG.md. */
  dir: string;
}

export interface UnitRelease {
  version: string;
  date: string;
  /** Clean one-line bullets: no `- ` marker, no `(#NNN)` issue ref, no HTML comments, no blanks. */
  lines: string[];
}

/**
 * The separately-built static sites (the marketing site and the docs site), each with its own
 * version and changelog.
 *
 * The EXTENSION is deliberately not here. It already has a version (`manifest.json`, which
 * is what the Chrome Web Store ships) and already has a changelog (the root CHANGELOG.md,
 * compiled into the Release notes dialog). Giving it a third one would create exactly the
 * contradiction this whole change exists to remove.
 *
 * The shared packages (@kimtos/config, /icons, /types …) are not here either: they are
 * `private: true` and every consumer references them as "*" — a workspace link. Nothing
 * resolves them by version, so a bump has no mechanical effect. Versioning a number nobody
 * reads is ceremony, not release engineering.
 */
const DEPLOYABLES = ['www', 'www-docs'];

const APPS_DIR = join('extension', 'src', 'apps');

/** Every releasable unit in the repo: the apps, then the deployables. */
export function units(root = process.cwd()): Unit[] {
  const appsPath = join(root, APPS_DIR);
  const apps: Unit[] = existsSync(appsPath)
    ? readdirSync(appsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name, kind: 'app' as const, dir: join(appsPath, e.name) }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  const deployables: Unit[] = DEPLOYABLES.filter((d) => existsSync(join(root, d))).map((d) => ({
    id: d,
    kind: 'deployable' as const,
    dir: join(root, d),
  }));

  return [...apps, ...deployables];
}

const changelogPath = (dir: string): string => join(dir, 'CHANGELOG.md');

export const hasChangelog = (dir: string): boolean => existsSync(changelogPath(dir));

/**
 * A unit's releases, newest first.
 *
 * Same shape as the root CHANGELOG.md, so the parser is shared: `## v1.2.0 — 2026-07-12`,
 * or without the `v`, because a hand-written file will be written both ways and refusing
 * one of them would only produce a mystery.
 */
export function readUnitChangelog(dir: string): UnitRelease[] {
  if (!hasChangelog(dir)) return [];
  const md = readFileSync(changelogPath(dir), 'utf8');
  const out: UnitRelease[] = [];
  for (const part of md.split(/^## /m).slice(1)) {
    const m = part.match(/^v?(\d\S*)\s+[—-]\s+(\S+)\s*\n([\s\S]*)$/);
    if (!m) continue;
    // The block between two headings is a short bullet list. Strip HTML comments over the WHOLE
    // block first (a `<!-- newest entry IS this version -->` guide can sit anywhere and used to
    // leak into the UI as a literal line). Then walk the physical lines: a `-`/`*` marker starts
    // a new bullet, and any other non-blank line is a markdown continuation of the previous one
    // (a wrapped bullet — prettier-formatted files wrap long bullets), folded in with a space.
    // Splitting on physical lines instead used to shatter one wrapped sentence into several
    // broken display bullets (#974). Finally drop any trailing `(#NNN)` issue ref from each
    // whole bullet. The result is clean display text, one entry per bullet, no markdown.
    const bullets: string[] = [];
    for (const raw of m[3]!.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const isBullet = /^[-*]\s+/.test(line);
      const text = line.replace(/^[-*]\s+/, '');
      if (isBullet || bullets.length === 0) bullets.push(text);
      else bullets[bullets.length - 1] += ` ${text}`;
    }
    const lines = bullets.map((b) => b.replace(/\s*\(#\d+\)\s*$/, '').trim()).filter(Boolean);
    out.push({ version: m[1]!, date: m[2]!, lines });
  }
  return out;
}

/**
 * The unit's version: the newest changelog entry, and nothing else.
 *
 * Returns '' when there is no changelog — and the CI assert then fails the build, rather
 * than a silent `?? '1.0.0'` fallback quietly restoring the exact bug this replaces.
 */
export function unitVersion(dir: string): string {
  return readUnitChangelog(dir)[0]?.version ?? '';
}

/**
 * The unit's first-release date: the date of the OLDEST changelog entry.
 *
 * The mirror image of `unitVersion` — that reads the newest entry, this the oldest — and it is
 * the single source for "when did this app first ship". It is what the "New" badge counts 30
 * days from (`isNewApp` in @kimtos/config, #1114), which is why the date is derived here and
 * not declared on `AppMeta`: the app already writes this line, and a second copy on the meta
 * would drift exactly as `version` did before it was removed (#132).
 *
 * Returns '' when there is no changelog, matching `unitVersion` — the caller (or the badge)
 * treats an empty date as "not new" rather than crashing.
 */
export function unitFirstReleased(dir: string): string {
  return readUnitChangelog(dir).at(-1)?.date ?? '';
}

/** Prepend a release to the unit's changelog, creating the file if it does not exist. */
export function releaseUnit(opts: { dir: string; version: string; notes: string; date?: string }): void {
  const { dir, notes } = opts;
  const version = opts.version.replace(/^v/, '');
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  const existing = hasChangelog(dir) ? readFileSync(changelogPath(dir), 'utf8') : '# Changelog\n';
  if (new RegExp(`^## v?${escapeRegExp(version)}\\b`, 'm').test(existing)) {
    throw new Error(`${dir}: CHANGELOG.md already has a ${version} section.`);
  }

  const section = `## ${version} — ${date}\n\n${notes.trim()}\n`;
  // Newest first, under the title line.
  const lines = existing.split('\n');
  const titleAt = lines.findIndex((l) => l.startsWith('# '));
  const head = titleAt === -1 ? ['# Changelog', ''] : lines.slice(0, titleAt + 1).concat('');
  const rest = titleAt === -1 ? lines : lines.slice(titleAt + 1);

  writeFileSync(changelogPath(dir), [...head, section, ...rest].join('\n').replace(/\n{3,}/g, '\n\n'));
}

/**
 * The next version, proposed from what the commits actually did.
 *
 * feat -> minor, anything else -> patch. A breaking change is not something a commit type
 * can be trusted to declare, so a major bump stays a human decision — the release asks.
 */
export function proposeBump(current: string, types: string[]): string {
  const [maj = 0, min = 0, patch = 0] = (current || '0.0.0').split('.').map(Number);
  return types.some((t) => t === 'feat') ? `${maj}.${min + 1}.0` : `${maj}.${min}.${patch + 1}`;
}

/** A workspace whose package.json and the root lockfile disagree about its version. */
export interface LockDrift {
  id: string;
  /** What the workspace's own package.json says. */
  pkg: string;
  /** What package-lock.json records for it, or '' when it records nothing. */
  lock: string;
}

/**
 * Every workspace whose version the root lockfile does not agree with.
 *
 * The lockfile records each workspace's version too, so a bump that misses it makes `main`
 * red for everyone the moment it lands — `.github/workflows/make.yml` asserts the two are in
 * sync. That is exactly how v1.0.1 shipped: four deployables bumped in package.json and stale
 * in the lockfile (#1203). `prepareRelease()` now re-resolves it, and this is what catches the next
 * way it can drift, on a laptop rather than on main.
 *
 * A plain read rather than `npm install --package-lock-only`: the npm run would be the more
 * faithful check, but this is called from `release.mjs check`, which runs on every PR, and
 * shelling out would make a fast offline guard slow and network-dependent. Comparing the
 * recorded versions catches the drift that actually happens — a version bumped in one file and
 * not the other.
 *
 * `extension` is included even though it is not a `deployable` unit: its version is bumped BY
 * HAND in manifest.json and package.json, with a documented instruction to refresh the lockfile
 * afterwards and, until this, nothing asserting it. That makes it the likeliest to drift.
 *
 * Returns [] when there is no lockfile — nothing to disagree with.
 */
export function lockfileDrift(root = process.cwd()): LockDrift[] {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) return [];
  const locked = (JSON.parse(readFileSync(lockPath, 'utf8')) as { packages?: Record<string, { version?: string }> })
    .packages;
  const ids = [
    ...units(root)
      .filter((u) => u.kind === 'deployable')
      .map((u) => u.id),
    'extension',
  ];
  return ids
    .map((id) => {
      const pkgPath = join(root, id, 'package.json');
      if (!existsSync(pkgPath)) return null;
      const pkg = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version ?? '';
      return { id, pkg, lock: locked?.[id]?.version ?? '' };
    })
    .filter((w): w is LockDrift => w !== null && w.pkg !== w.lock);
}
