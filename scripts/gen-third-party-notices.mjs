// Generate THIRD-PARTY-NOTICES.md — the components we actually SHIP.
//
//   node scripts/gen-third-party-notices.mjs
//
// Being open source does NOT discharge the attribution duties of our dependencies:
// MIT, Apache-2.0 and BSD all require the copyright and licence notice to be
// preserved in distributed copies. This file is how we satisfy that.
//
// WHY IT IS DONE THIS WAY. The obvious approach — list npm's production dependency
// closure — is wrong in a way that matters. That closure includes Node-only
// build-time packages that never reach a user's browser, and one of them
// (@img/sharp-libvips, pulled in by Transformers.js via sharp) is **LGPL**. Listing
// it would claim we distribute copyleft code inside an MIT-licensed extension, which
// we do not: it is a native Node binary that cannot be bundled into an extension.
//
// So instead of guessing, we ASK THE BUNDLER. We build the extension with source
// maps into a throwaway directory and read which packages actually contributed code.
// That is the set we distribute, and the set we owe notices for.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The model WEIGHTS + data files we ship are NOT npm packages, so the bundler scan below
// cannot see them. They live in scripts/model-notices.mjs — one source of truth, shared with
// scripts/check-model-notices.mjs, which fails CI when a shipped model is not attributed there.
import { MODELS } from './model-notices.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const OUT = join(ROOT, 'THIRD-PARTY-NOTICES.md');

// 1. Build with source maps into a temp dir. (Never into extension/dist: the shipped
//    build must not carry maps — they would hand out our source in the shipped bundle.)
const tmp = mkdtempSync(join(tmpdir(), 'kimtos-notices-'));
try {
  execFileSync('npx', ['vite', 'build', '--sourcemap', 'true', '--outDir', tmp, '--emptyOutDir'], {
    cwd: EXT,
    stdio: 'ignore',
  });

  // 2. Every package whose code landed in the bundle.
  const shipped = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.map')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/node_modules\/((?:@[^/"]+\/)?[^/"]+)/g)) {
          if (!m[1].startsWith('.')) shipped.add(m[1]);
        }
      }
    }
  };
  walk(tmp);

  // 3. Read each one's licence + notice straight from the installed package.
  const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'COPYING'];
  const pkgs = [];
  for (const name of [...shipped].sort()) {
    const dir = join(ROOT, 'node_modules', name);
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const j = JSON.parse(readFileSync(manifest, 'utf8'));
    const files = readdirSync(dir);
    const hit = LICENSE_FILES.find((f) => files.includes(f));
    pkgs.push({
      name,
      version: j.version ?? '',
      license: typeof j.license === 'string' ? j.license : (j.license?.type ?? 'see text below'),
      homepage: (j.homepage ?? (typeof j.repository === 'string' ? j.repository : (j.repository?.url ?? '')))
        .replace(/^git\+/, '')
        .replace(/\.git$/, ''),
      text: hit ? readFileSync(join(dir, hit), 'utf8').trim() : '',
      notice: files.includes('NOTICE') ? readFileSync(join(dir, 'NOTICE'), 'utf8').trim() : '',
    });
  }

  const out = [
    '# Third-party notices',
    '',
    'KimtOS is built on open-source software (its own terms are in `LICENSE`).',
    'The components below are included in the KimtOS extension and remain under their',
    'own licences, reproduced here as those licences require. **Nothing in this file is',
    'covered by the KimtOS licence.**',
    '',
    'This list is **generated from the shipped bundle** — it is the set of packages whose',
    'code actually reaches a user, not the wider build-time dependency tree. Regenerate it',
    'with `node scripts/gen-third-party-notices.mjs` whenever the dependencies change.',
    '',
    `${pkgs.length} components:`,
    '',
    ...pkgs.map((p) => `- ${p.name} ${p.version} — ${p.license}`),
    '',
    '---',
    '',
    '# On-device models',
    '',
    'KimtOS also downloads model weights to run its AI features on the user’s device.',
    'Those weights are **not ours**, are not covered by the KimtOS licence, and their',
    'terms are reproduced below — MIT and Apache-2.0 both require the notice to travel',
    'with what we distribute, and we distribute these to every user who installs the app.',
    '',
    ...MODELS.map((m) => `- **${m.name}** — ${m.license} — used by ${m.usedBy}`),
    '',
    ...MODELS.flatMap((m) => [
      `## ${m.name}`,
      '',
      `License: **${m.license}**`,
      `Source: ${m.source}`,
      `Used by: ${m.usedBy}`,
      '',
      m.note,
      '',
    ]),
    '---',
    '',
  ];
  for (const p of pkgs) {
    out.push(`## ${p.name} ${p.version}`, '', `License: **${p.license}**`);
    if (p.homepage) out.push(`Source: ${p.homepage}`);
    out.push('');
    if (p.notice) out.push('NOTICE:', '', '```', p.notice, '```', '');
    out.push(p.text ? '```' : `_The package ships no licence file; see the ${p.license} licence._`);
    if (p.text) out.push(p.text, '```');
    out.push('');
  }

  writeFileSync(OUT, out.join('\n'));
  console.log(`Wrote THIRD-PARTY-NOTICES.md (${pkgs.length} components actually shipped)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
