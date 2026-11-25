// "Report an issue" from an app window's header (and Settings → About). There is no server to
// file a ticket with, so it opens a pre-filled GitHub issue in a new tab: the app id/name and
// versions go in the body so the report arrives with the context needed to reproduce it. The
// user reviews and submits it on GitHub; nothing is sent from the extension itself.

import { VERSION } from '../data/releaseNotes.js';
import { appVersion } from '../data/appChangelogs.js';

import { ISSUES_URL } from './openSource.js';

const NEW_ISSUE_URL = `${ISSUES_URL}/new`;

/** The new-issue URL for `appName`, with the title prefix and the context block pre-filled. Pure,
 *  so the URL can be checked without opening a tab. */
export function reportIssueUrl(appId: string, appName: string): string {
  const version = appVersion(appId) || 'unknown';
  const body = `What happened?\n\n\nSteps to reproduce\n1.\n2.\n\n---\n${appName} v${version} / KimtOS v${VERSION}`;
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set('title', `[${appName}] `);
  url.searchParams.set('body', body);
  return url.toString();
}

/** Open the pre-filled GitHub issue for `appName` in a new tab. */
export function openReportIssue(appId: string, appName: string): void {
  window.open(reportIssueUrl(appId, appName), '_blank', 'noopener,noreferrer');
}
