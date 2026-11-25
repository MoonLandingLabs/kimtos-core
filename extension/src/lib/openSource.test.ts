// Kimtos v1 states, inside the extension, that it is free and open source (MIT) with the source on
// GitHub. This pins the Settings -> About panel to that statement: the licence line, the repository
// link, and that the link is the same repository "Report an issue" files into.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installChrome } from '../test/domEnv.js';
import { ISSUES_URL, LICENSE_NAME, OPEN_SOURCE_NOTICE, REPO_URL } from './openSource.js';
import { reportIssueUrl } from './reportIssue.js';

describe('open source facts', () => {
  test('the licence is MIT and the repository is on GitHub', () => {
    assert.equal(LICENSE_NAME, 'MIT');
    assert.equal(new URL(REPO_URL).hostname, 'github.com');
    assert.match(OPEN_SOURCE_NOTICE, /Free and open source, MIT licensed/);
  });

  test('"Report an issue" files into the same repository the About panel links', () => {
    assert.equal(ISSUES_URL, `${REPO_URL}/issues`);
    assert.ok(reportIssueUrl('kimtos', 'Kimtos').startsWith(`${REPO_URL}/issues/new?`));
  });
});

describe('Settings -> About', () => {
  beforeEach(() => {
    installDom();
    installChrome();
  });

  test('shows the version, the open-source notice and a link to the repository', async () => {
    const { about } = await import('../views/settings.js');
    const panel = about();
    assert.match(panel.querySelector('.about-version')?.textContent ?? '', /^Version \S+/);
    assert.match(panel.textContent ?? '', /Free and open source, MIT licensed/);
    const hrefs = [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    assert.ok(hrefs.includes(REPO_URL), `About must link ${REPO_URL}; got ${hrefs.join(', ')}`);
  });

  test('mentions no account', async () => {
    const { about } = await import('../views/settings.js');
    const text = (about().textContent ?? '').toLowerCase();
    assert.doesNotMatch(text.replace('no account', ''), /account|sign in|log in/);
  });
});
