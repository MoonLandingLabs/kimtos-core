// Acquiring a camera, a microphone or the screen — in ONE place, because the
// interesting part is not the getUserMedia call, it is the refusal.
//
// There is NO manifest permission for the microphone or the camera in an extension.
// `audioCapture` and `videoCapture` are Chrome Apps keys; declaring them here got
// two warnings out of Chrome and changed nothing (#1335). An extension gets these
// devices exactly as a web page does: a runtime prompt against its own origin, which
// the browser remembers per origin. Our UI is the New Tab override, an ordinary
// extension page in a real tab, so the prompt does appear — it is the popup and the
// side panel that cannot show one.
//
// What the prompt cannot do is overrule the machine. On Windows the OS can block
// Chrome's microphone or camera outright (Settings, Privacy and security, Microphone,
// "Let desktop apps access your microphone"); when it does, getUserMedia rejects at
// once and no dialog is permitted. The only useful thing software can do there is
// name the exact setting, so every caller routes through here rather than showing
// `err.message` — which for a denial is the bare string "Permission denied" and
// tells the user nothing about where to go.

/** What went wrong, in terms a caller can act on. */
export type DeviceProblem = {
  /** `blocked` covers both a browser-level and an OS-level refusal — see `scope`. */
  kind: 'blocked' | 'missing' | 'busy' | 'insecure' | 'dismissed' | 'unknown';
  /** For `blocked`: where the block most likely lives. `unknown` when we cannot tell. */
  scope: 'browser' | 'system' | 'unknown';
  /** One line, safe to show as-is. */
  message: string;
  /** Where to go to change it, or null when there is nothing to change. */
  howToFix: string | null;
};

export type DeviceKind = 'microphone' | 'camera' | 'screen';

/**
 * Windows is the platform where an OS-level block is both common and invisible:
 * desktop-app access to the mic and camera is a single switch that is off for
 * plenty of users, and the browser is not allowed to ask about it.
 *
 * `userAgentData` is Chromium-only and the platform string is not, so try the
 * structured one first and fall back to the UA string.
 */
function platform(): 'windows' | 'macos' | 'other' {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const raw = (nav.userAgentData?.platform || navigator.userAgent || '').toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  return 'other';
}

/**
 * Chrome on macOS captures TAB audio but never system audio, so a "record what
 * another application is playing" option is a promise it cannot keep there.
 * Callers use this to word the choice honestly rather than to hide it — a switch
 * that silently records silence is the failure #805 exists to prevent.
 */
export function supportsSystemAudio(): boolean {
  return platform() !== 'macos';
}

/**
 * Chrome's own page for this device. Deliberately returned as TEXT, not a link:
 * Chrome refuses programmatic navigation to `chrome://` from a page, so an anchor
 * here would look clickable and do nothing. Callers offer it to copy instead.
 */
export function browserSettingsUrl(kind: DeviceKind): string | null {
  return kind === 'screen' ? null : `chrome://settings/content/${kind}`;
}

/**
 * The OS setting the browser cannot prompt for, on the platforms that have one.
 * `null` elsewhere — naming a path that does not exist is worse than saying nothing.
 *
 * Screen capture is macOS-only here, and deliberately: macOS gates screen recording
 * per application in its own pane, while Windows has no equivalent switch to send
 * anyone to. This is the single source of the phrasing — every caller composes from
 * it rather than writing its own copy of the same path.
 */
export function systemSettingsPath(kind: DeviceKind): string | null {
  const mac = platform() === 'macos';
  if (kind === 'screen') return mac ? 'System Settings, Privacy and Security, Screen Recording' : null;
  const label = kind === 'camera' ? 'Camera' : 'Microphone';
  if (platform() === 'windows') return `Settings, Privacy and security, ${label}`;
  if (mac) return `System Settings, Privacy and Security, ${label}`;
  return null;
}

/**
 * Where to send someone whose device is refused, worded for their platform.
 *
 * The `system` case deliberately offers TWO readings, because Chrome leaves the
 * permission at `prompt` for both of them: the OS refused before a prompt could be
 * drawn, or the user closed a prompt they did see without answering. Nothing in the
 * platform tells the two apart — but the user knows instantly which happened, so the
 * remedy asks them rather than asserting the wrong one at them.
 */
function fixFor(kind: DeviceKind, scope: DeviceProblem['scope']): string {
  const url = browserSettingsUrl(kind);
  const browser = url ? `Open ${url} and allow this extension.` : 'Allow this extension in Chrome’s site settings.';
  if (scope !== 'system') return browser;

  const retry = 'If you saw a prompt, try again and choose Allow.';
  const system = systemSettingsPath(kind);
  // No OS pane to name on this platform, so fall back to the one setting there is —
  // Chrome's own. Saying only "something is blocking it" leaves the user nowhere.
  if (!system) return `${retry} If no prompt appeared, something outside Chrome is blocking it. ${browser}`;
  const os = platform() === 'windows' ? 'Windows' : 'macOS';
  const verb = platform() === 'windows' ? 'turn on access for desktop apps' : 'allow Chrome';
  return `${retry} If no prompt appeared, ${os} is blocking it: open ${system}, and ${verb}.`;
}

/**
 * The diagnosis for a device that is refused. Shared by the rejection mapper below
 * and by the pre-flight check a caller runs BEFORE recording, so the sentence a user
 * reads is the same one either way.
 */
export function blockedProblem(kind: DeviceKind, scope: DeviceProblem['scope']): DeviceProblem {
  return {
    kind: 'blocked',
    scope,
    // The `system` wording claims only what is known: permission was not obtained.
    // It used to state that the block was outside the browser, which is one of the two
    // things `prompt` can mean — and the wrong one for a user who dismissed the dialog.
    message:
      scope === 'system' ? `Chrome could not get permission for your ${kind}.` : `Access to your ${kind} is blocked.`,
    howToFix: fixFor(kind, scope),
  };
}

/**
 * What Chrome has on record for this device, which is how we tell "the user said no"
 * from "something above the browser said no" — see `describeCaptureError`.
 *
 * `screen` has no queryable permission (getDisplayMedia is gesture-gated, not
 * persisted), and `microphone`/`camera` are outside the DOM's PermissionName
 * union even though Chrome implements both — hence the cast.
 */
export async function permissionState(kind: DeviceKind): Promise<PermissionState | 'unsupported'> {
  if (kind === 'screen' || !navigator.permissions?.query) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

/**
 * Turn a getUserMedia/getDisplayMedia rejection into something worth showing.
 *
 * `states` are the permission states read around the attempt. The one that matters is
 * `after`: see the NotAllowedError branch.
 */
export function describeCaptureError(
  err: unknown,
  kind: DeviceKind,
  states: { before?: PermissionState | 'unsupported'; after?: PermissionState | 'unsupported' } = {},
): DeviceProblem {
  // Not `err instanceof DOMException`: OverconstrainedError is its own interface in
  // Chrome, not a DOMException, so the instanceof test dropped it into `unknown` and
  // the user got a raw message instead of "no device".
  const name = typeof (err as { name?: unknown })?.name === 'string' ? (err as { name: string }).name : '';

  switch (name) {
    case 'NotAllowedError': {
      // Chrome uses NotAllowedError for BOTH "the user said no" and "this was refused
      // without anyone being asked". The state AFTER the rejection separates them:
      //
      //   denied  -> a decision is on record. The user declined the prompt, or a
      //              policy declined for them. Either way the block is IN the browser.
      //   prompt  -> nothing was recorded, so the browser never got its answer — it
      //              was overruled from above. That is the OS switch, and the browser
      //              is not permitted to prompt its way out of it.
      //
      // Reading only the state BEFORE was wrong, and wrong on the commonest path there
      // is: a first-ever use starts at `prompt`, so a user who simply clicked Block was
      // sent to a Windows setting that was not the problem (#1335).
      //
      // `before` is consulted ONLY when there is no `after` to have. The two are
      // independent live reads bracketing an async call, so they can genuinely disagree
      // — the user can reset the permission in another tab while the call is in flight —
      // and when they do, the later reading is the true one. Letting a stale `before`
      // win would put us back where we started: an OS block read as a browser one.
      const { before, after } = states;
      const known = after && after !== 'unsupported' ? after : before;
      const scope: DeviceProblem['scope'] = known === 'denied' ? 'browser' : known === 'prompt' ? 'system' : 'unknown';
      return blockedProblem(kind, scope);
    }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        kind: 'missing',
        scope: 'unknown',
        message: `No ${kind} was found. Plug one in, or pick a different source.`,
        howToFix: null,
      };
    case 'NotReadableError':
    case 'AbortError':
      // Very common on Windows: a conferencing app holds the device exclusively.
      return {
        kind: 'busy',
        scope: 'unknown',
        message: `Your ${kind} is in use by another application. Close it and try again.`,
        howToFix: null,
      };
    case 'SecurityError':
      return {
        kind: 'insecure',
        scope: 'browser',
        message: `Your ${kind} cannot be used from this page.`,
        howToFix: fixFor(kind, 'browser'),
      };
    default:
      return {
        kind: 'unknown',
        scope: 'unknown',
        message: err instanceof Error && err.message ? err.message : `Could not use your ${kind}.`,
        howToFix: null,
      };
  }
}

/** Thrown by the acquire helpers so a caller can show the diagnosis it carries. */
export class DeviceError extends Error {
  readonly problem: DeviceProblem;
  readonly device: DeviceKind;

  constructor(device: DeviceKind, problem: DeviceProblem, cause: unknown) {
    super(problem.message, { cause });
    this.name = 'DeviceError';
    this.device = device;
    this.problem = problem;
  }
}

/** The whole diagnosis as one line, for a caller with only a text slot to fill. */
export function problemLine(problem: DeviceProblem): string {
  return problem.howToFix ? `${problem.message} ${problem.howToFix}` : problem.message;
}

async function acquire(kind: DeviceKind, constraints: MediaStreamConstraints): Promise<MediaStream> {
  const before = await permissionState(kind);
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // Re-read AFTER the refusal: that is the reading that says whether a decision was
    // recorded, and so whether the block is the browser's or the machine's (#1335).
    const after = await permissionState(kind);
    throw new DeviceError(kind, describeCaptureError(err, kind, { before, after }), err);
  }
}

/** The microphone. Rejects with a `DeviceError` carrying a usable explanation. */
export function acquireMic(constraints: MediaTrackConstraints | true = true): Promise<MediaStream> {
  return acquire('microphone', { audio: constraints });
}

/** The camera. Rejects with a `DeviceError` carrying a usable explanation. */
export function acquireCamera(constraints: MediaTrackConstraints | true = true): Promise<MediaStream> {
  return acquire('camera', { video: constraints });
}

/**
 * The screen (and, where the platform allows, the audio playing through it).
 *
 * Screen capture is not a stored permission — the user chooses a surface in
 * Chrome's own picker every time — so a rejection here is USUALLY "the picker was
 * cancelled". Not always: macOS refuses screen recording to an application that
 * has not been allowed in System Settings, and it rejects with the same
 * `NotAllowedError` before any picker is drawn. We cannot tell the two apart, so
 * the message names the cancel (much the commoner case) and the remedy names the
 * setting, for the user who did not cancel anything.
 */
export async function acquireScreen(options: DisplayMediaStreamOptions): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError') {
      const macPane = systemSettingsPath('screen');
      throw new DeviceError(
        'screen',
        {
          kind: 'dismissed',
          scope: 'unknown',
          message: 'Screen sharing was cancelled.',
          howToFix: macPane
            ? `If you did not cancel it, macOS is blocking screen recording: open ${macPane}, and allow Chrome.`
            : null,
        },
        err,
      );
    }
    throw new DeviceError('screen', describeCaptureError(err, 'screen'), err);
  }
}
