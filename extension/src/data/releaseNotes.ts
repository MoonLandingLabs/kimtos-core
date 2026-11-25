import { marked } from 'marked';
import { CHANGELOG } from './changelog.js';

// The version actually running (from the extension manifest), so the pill and the
// About panel always reflect what's installed. Falls back to a literal during
// `vite dev`, where there's no extension manifest.
function getVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.1.0';
  }
}

export const VERSION = getVersion();

interface ReleaseNote {
  version: string;
  date?: string;
  /** Markdown. */
  body?: string;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'release-loading';
  p.textContent = text;
  return p;
}

function head(release: ReleaseNote, installed: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'release-head';
  el.innerHTML =
    `<span class="release-version">v${release.version}</span>` +
    (release.date ? `<span class="release-date">${release.date}</span>` : '') +
    (release.version === installed ? '<span class="release-installed">Installed</span>' : '');
  return el;
}

// Match a release against a lowercased query across version, name, date and body.
const matchesQuery = (release: ReleaseNote, q: string): boolean =>
  !q || [release.version, release.date, release.body].some((f) => (f || '').toLowerCase().includes(q));

// Wrap every (case-insensitive) occurrence of `q` under `root` in <mark>, working
// on text nodes only so the rendered Markdown's tags are left intact.
function highlight(root: Element, q: string): void {
  if (!q) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Node[] = [];
  while (walker.nextNode()) {
    if ((walker.currentNode.nodeValue || '').toLowerCase().includes(q)) targets.push(walker.currentNode);
  }
  for (const node of targets) {
    const text = node.nodeValue || '';
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0;
    let idx: number;
    while ((idx = lower.indexOf(q, i)) !== -1) {
      if (idx > i) frag.append(text.slice(i, idx));
      const mark = document.createElement('mark');
      mark.className = 'release-mark';
      mark.textContent = text.slice(idx, idx + q.length);
      frag.append(mark);
      i = idx + q.length;
    }
    if (i < text.length) frag.append(text.slice(i));
    node.parentNode?.replaceChild(frag, node);
  }
}

function draw(host: Element, releases: ReleaseNote[], installed: string, q: string): void {
  const sections = releases.map((release) => {
    const section = document.createElement('section');
    section.className = 'release';
    const body = document.createElement('div');
    body.className = 'release-body';
    body.innerHTML = marked.parse(release.body || '_No notes for this release._') as string;
    section.append(head(release, installed), body);
    highlight(section, q); // mark the matched text in the result
    return section;
  });
  host.replaceChildren(...sections);
}

// The release notes are BUNDLED, not fetched: `CHANGELOG` is compiled into the build
// from CHANGELOG.md (scripts/gen-changelog.mjs), so the notes for a version ship WITH
// that version. There is no network call, no cache to go stale, and nothing to fail —
// which also means this works offline, like the rest of the app.
//
// (It used to fetch GitHub Releases from a public repo. That broke the moment the repo
// went private: an extension in a user's browser is an anonymous client and simply gets
// a 404. Bundling removes the dependency on a repo's visibility entirely.)
//
// A sticky search box filters the list by version, date or note text.
export function renderReleaseNotes(host: HTMLElement): void {
  const installed = getVersion();
  const releases: ReleaseNote[] = CHANGELOG.map((e) => ({
    version: e.version,
    date: e.date,
    body: e.body,
  }));

  // Persistent shell: a sticky search box above a scrolling list. Rebuilding the
  // list on filter never disturbs the input (so typing isn't interrupted).
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input release-search';
  search.placeholder = 'Search releases…';
  search.setAttribute('aria-label', 'Search releases');
  search.hidden = !releases.length;
  const list = document.createElement('div');
  list.className = 'release-list';
  host.replaceChildren(search, list);

  const render = (): void => {
    if (!releases.length) {
      // No release sections in CHANGELOG.md yet (the first release has not been cut).
      // Show the version the user is actually on rather than a bare "nothing here",
      // which reads as broken on a product they are already running (#416).
      list.replaceChildren(
        note(
          installed
            ? `You're on Kimtos ${installed}. Release notes will appear here with each update.`
            : 'Release notes will appear here with each update.',
        ),
      );
      return;
    }
    const raw = search.value.trim();
    const q = raw.toLowerCase();
    const filtered = releases.filter((r) => matchesQuery(r, q));
    if (!filtered.length) {
      list.replaceChildren(note(`No releases match “${raw}”.`));
      return;
    }
    draw(list, filtered, installed, q);
  };

  search.addEventListener('input', render);
  render();
}
