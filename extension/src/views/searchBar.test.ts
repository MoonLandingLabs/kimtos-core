// The search bar's contracts. Both of the originals here guarded #177 — that we kept ONE
// engine list, so a user who picked DuckDuckGo did not silently get Google. That whole class
// of bug is gone by construction: there is no engine list to keep in sync, because the bar no
// longer picks a provider at all. It submits through `chrome.search.query` and the browser's
// own default answers.
//
// What replaces them is the contract that made the Chrome Web Store reject 0.5.0 (#885): a
// plain query must reach the USER's provider, and we must never rebuild a URL for a provider
// of our own. If someone reintroduces a hardcoded engine, the first test here fails.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isUrlLike, toUrl } from './searchBar.js';
import { migrateHomeLayout } from '../models/store.js';

describe('the bar never picks a provider (#885)', () => {
  test('the module exports no engine map, default or URL builder', async () => {
    const mod: Record<string, unknown> = await import('./searchBar.js');
    for (const gone of ['ENGINES', 'DEFAULT_ENGINE', 'engineOptions', 'buildSearchUrl']) {
      assert.equal(
        gone in mod,
        false,
        `${gone} is back — the new tab page must not choose a search engine, it must defer ` +
          `to chrome.search.query. This is the single-purpose violation the store rejected.`,
      );
    }
  });

  // Scan the WHOLE submit path, not just this module. The routing decision lives in
  // appController's renderSearchBar, so a guard that only reads searchBar.ts would stay
  // green while someone put `location.href = 'https://google.com/search?q=' + q` straight
  // into the controller — reintroducing the exact violation this suite exists to prevent.
  for (const file of ['./searchBar.ts', '../controllers/appController.ts']) {
    test(`no search-provider URL is built in ${file}`, async () => {
      const fs = await import('node:fs/promises');
      const src = await fs.readFile(new URL(file, import.meta.url), 'utf8');
      // The comments legitimately name the engines and the history; only real code counts.
      const code = src
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      // Any provider endpoint shape, not just `q=` — Yandex uses `text=`, Baidu `wd=`.
      assert.doesNotMatch(
        code,
        /https?:\/\/[^\s'"`]*[?#&](q|query|text|wd|p|search)=/i,
        'a search-provider URL is being built again — submit must go through chrome.search.query',
      );
    });
  }

  test('the submit path actually calls chrome.search.query', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../controllers/appController.ts', import.meta.url), 'utf8');
    assert.match(src, /chrome\.search\.query\(/, 'the web-search branch no longer defers to the browser');
  });
});

describe('only an explicit scheme navigates; everything else searches', () => {
  test('a pasted URL navigates', () => {
    for (const input of [
      'https://github.com',
      'http://a.io/b',
      'https://github.com/MoonLandingLabs/kimtos-core/issues/885',
      'http://localhost:3000/x',
      'HTTPS://SHOUTING.EXAMPLE',
    ]) {
      assert.ok(isUrlLike(input), `${input} should navigate, not search`);
    }
  });

  // The regression this replaces: a bare dotted token was treated as a host, so every one
  // of these navigated to a nonexistent domain and answered a reasonable question with a
  // DNS error. Nothing short of a public-suffix list can tell these from a real host, so
  // they search — which is what the bar did before #885 anyway.
  test('a dotted token that is NOT a URL is searched, not navigated', () => {
    for (const input of [
      'tsconfig.json',
      'package.json',
      'vue.js',
      'node.js',
      'README.md',
      'main.py',
      'file.tar.gz',
      '1.2.3',
      'v1.2.3',
      '3.14',
      'Mr.Bean',
      'github.com', // a real host, but bare — searching it is safe; guessing is not
    ]) {
      assert.equal(isUrlLike(input), false, `${input} must search — navigating it is a dead host`);
    }
  });

  test('prose and bare words are searched', () => {
    for (const input of ['how to center a div', 'kimtos', 'what is node.js good for', 'e.g.', 'St. Louis']) {
      assert.equal(isUrlLike(input), false, `${input} should search, not navigate`);
    }
  });

  test('no other scheme can be smuggled through the navigate branch', () => {
    // toUrl feeds location.href, so a javascript:/data:/mailto: input reaching it would be
    // a script-injection vector. Only http(s) matches, so they all fall through to search.
    for (const input of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'mailto:a@b.c', 'file:///etc']) {
      assert.equal(isUrlLike(input), false, `${input} must never reach location.href`);
    }
  });

  test('the URL is passed through exactly as typed', () => {
    assert.equal(toUrl('https://a.io'), 'https://a.io');
    assert.equal(toUrl('  http://localhost:3000/x  '), 'http://localhost:3000/x');
  });
});

describe('homeLayout migration — the mode is a mode, not a vendor (#177)', () => {
  test("a profile written before the rename ('google') becomes 'web'", () => {
    assert.equal(migrateHomeLayout({ homeLayout: 'google' } as never), 'web');
  });

  test("'kimtai' survives — the one value that has behaviour attached", () => {
    assert.equal(migrateHomeLayout({ homeLayout: 'kimtai' }), 'kimtai');
  });

  test('a fresh profile, or junk, lands on web', () => {
    assert.equal(migrateHomeLayout({}), 'web');
    assert.equal(migrateHomeLayout({ homeLayout: 'bogus' } as never), 'web');
  });
});
