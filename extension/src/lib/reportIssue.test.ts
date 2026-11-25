// "Report an issue" opens a pre-filled GitHub issue; nothing is posted anywhere by the extension.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportIssueUrl } from './reportIssue.js';

test('the report is a pre-filled new issue on the public repo, carrying the app and versions', () => {
  const url = new URL(reportIssueUrl('notes', 'Notes'));
  assert.equal(url.origin + url.pathname, 'https://github.com/MoonLandingLabs/kimtos-core/issues/new');
  assert.equal(url.searchParams.get('title'), '[Notes] ');
  const body = url.searchParams.get('body') ?? '';
  assert.match(body, /Notes v/);
  assert.match(body, /Kimtos v/);
});
