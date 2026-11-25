// Telling the user what to do about a refused microphone, camera or screen.
//
// One sheet, shared by every recording surface, because the useful part of a
// device refusal is not the DOMException — it is the sentence saying what to change.
// Which sentence that is depends on where the block lives, and the module below
// works that out rather than guessing: a refusal Chrome recorded points at Chrome's
// own setting, while one it never got to record points at the machine (the Windows
// "let desktop apps access your microphone" switch, above all), where Chrome is not
// permitted to prompt at all (#1327, #1335).
//
// The chrome:// page is offered to COPY rather than as a link: Chrome refuses
// programmatic navigation to its own settings, so a link would look clickable and
// do nothing at all.

import { createCopyButton } from './copyButton.js';
import { infoDialog } from './infoDialog.js';
import { browserSettingsUrl, type DeviceKind, type DeviceProblem } from '../lib/devicePermission.js';
import { escapeHtml } from '../lib/dom.js';

const NOUN: Record<DeviceKind, string> = { microphone: 'Microphone', camera: 'Camera', screen: 'Screen capture' };

/** A title that says which of the three things went wrong, not just that something did. */
function titleFor(device: DeviceKind, problem: DeviceProblem): string {
  const noun = NOUN[device];
  if (problem.kind === 'blocked') return `${noun} blocked`;
  if (problem.kind === 'missing') return `No ${device} found`;
  if (problem.kind === 'busy') return `${noun} in use`;
  return `${noun} unavailable`;
}

/** Explain a device refusal, with the settings path to copy when there is one. */
export function explainDeviceProblem(
  device: DeviceKind,
  problem: DeviceProblem,
  owner?: Element | null,
): Promise<void> {
  // Only a BLOCK is fixed in settings; a busy or missing device is not, and offering
  // the page there would send the user somewhere that cannot help them.
  const url = problem.kind === 'blocked' ? browserSettingsUrl(device) : null;
  return infoDialog({
    title: titleFor(device, problem),
    html: `<p>${escapeHtml(problem.message)}</p>` + (problem.howToFix ? `<p>${escapeHtml(problem.howToFix)}</p>` : ''),
    confirmLabel: 'Close',
    actions: url ? [createCopyButton(() => url, 'Copy settings link')] : [],
    owner,
  });
}
