// Fails the build when a Markdown doc links to a repo file that does not exist.
//
// The README and the docs tree lean on each other by reference: rather than inline a code
// example or a checklist, they point at the canonical file (`docs/extension/creating-an-app.md`,
// `CONTRIBUTING.md`, a skill under `.claude/`). That is the right shape -- one source of truth,
// linked, not copied -- but a link is only as good as its target, and nothing stopped a moved or
// renamed file from leaving a dead pointer behind. Prettier formats Markdown and check-agent-claims
// reads its prose, but neither one opens a link (#737 was formatting only). So a broken relative
// link was invisible until a reader clicked it.
//
// WHAT THIS CHECKS. Every RELATIVE link and image target in a tracked Markdown doc must resolve to
// a tracked file or directory. It does NOT touch:
//   - external links (http:, https:, mailto:, tel:, protocol-relative //, data:) -- the conventions
//     job installs nothing and must not hit the network;
//   - pure anchors (`#section`) and the `#fragment` tail of a file link -- heading anchors are a
//     separate, far more brittle problem, and validating them here would punish honest links;
//   - link text or targets inside fenced or inline code -- `[x](y)` in a code sample is not a link.
//
// The judgement (`brokenLinks`) is exported and covered by check-doc-links.test.mjs, so the parser
// is tested against its own false positives (code fences, titles, anchors) rather than a copy of it.
//
//   node scripts/check-doc-links.mjs
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Which docs to walk. README + the docs tree + the root guides + every package README. Kept as a
// scope list (not "all *.md") so the generated docs-site output and vendored markdown never count.
const SCOPES = [/^README\.md$/, /^CONTRIBUTING\.md$/, /^CLAUDE\.md$/, /^docs\//, /\/README\.md$/];
const SKIP = /(^|\/)(node_modules|dist|\.output|\.nuxt)\//;

// A target we never resolve on disk: it leaves the repo, or it is an in-page anchor.
const EXTERNAL = /^(https?:|mailto:|tel:|data:|\/\/)/i;

// Strip fenced code blocks (``` or ~~~) and inline code spans so a `[x](y)` in a sample is not read
// as a link. Fences are removed line-for-line (blanked, not deleted) so reported line numbers stay
// true to the source file.
function stripCode(text) {
  const lines = text.split('\n');
  let fence = null; // the fence marker that opened the current block, or null
  return lines.map((line) => {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (m && line.trim().startsWith(fence)) fence = null;
      return '';
    }
    if (m) {
      fence = m[1];
      return '';
    }
    return line.replace(/`[^`]*`/g, ' ');
  });
}

// Pull the resolvable target out of one Markdown link/image destination. Handles a `<path>` form and
// a trailing "title" / 'title'. Returns the bare path (fragment kept for the caller to trim), or null
// for an external/anchor target that should not be resolved.
function linkTarget(dest) {
  let d = dest.trim();
  if (d.startsWith('<') && d.endsWith('>')) d = d.slice(1, -1).trim();
  else d = d.split(/\s+/)[0]; // drop a title: (path "title")
  if (!d || d.startsWith('#') || EXTERNAL.test(d)) return null;
  return d;
}

/** Every relative link in `text` whose file target does not satisfy `exists`, as {line, target}.
 *  `fromDir` is the directory of the containing file; `exists(absPath)` says whether it resolves.
 *  The whole judgement lives here so the test exercises what CI runs. */
export function brokenLinks(text, fromDir, exists) {
  const out = [];
  // Inline `[text](dest)` / `![alt](dest)`, and reference definitions `[label]: dest`.
  const inline = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const refDef = /^\s*\[[^\]]+\]:\s*(\S+)/;
  stripCode(text).forEach((line, i) => {
    const dests = [];
    let m;
    while ((m = inline.exec(line))) dests.push(m[1]);
    const ref = line.match(refDef);
    if (ref) dests.push(ref[1]);
    for (const dest of dests) {
      const target = linkTarget(dest);
      if (target === null) continue;
      const file = target.split('#')[0]; // trim a #fragment; keep the file part
      if (!file) continue; // a same-file anchor like (#usage)
      if (!exists(resolve(fromDir, file))) out.push({ line: i + 1, target });
    }
  });
  return out;
}

function main() {
  const files = execSync('git ls-files', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => /\.md$/i.test(f) && SCOPES.some((r) => r.test(f)) && !SKIP.test(f));

  const failures = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const b of brokenLinks(text, dirname(resolve(file)), existsSync)) {
      failures.push({ file, line: b.line, target: b.target });
    }
  }

  if (failures.length) {
    console.error('check-doc-links: a Markdown doc links to a repo path that does not exist.\n');
    for (const f of failures) console.error(`  ${f.file}:${f.line}  ->  ${f.target}`);
    console.error('\nFix the link or restore the target. Relative links resolve from the linking');
    console.error('file, so a moved doc needs every pointer to it updated. External links (http,');
    console.error('mailto) and in-page anchors (#section) are not checked.');
    process.exit(1);
  }

  console.log(`check-doc-links: ${files.length} docs, every relative link resolves.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
