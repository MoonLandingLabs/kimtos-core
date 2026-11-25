// What a refused device TELLS the user.
//
// The whole value of this module is the sentence it produces, so that sentence is
// what is pinned here. A Windows user whose microphone is blocked at the OS level
// gets no browser prompt at all — Chrome is not permitted to ask — so if the message
// does not name the Settings path, nothing in the product ever will (#1327).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

type Mod = typeof import('./devicePermission.js');

/** Pretend to be a platform. `platform()` prefers userAgentData, so stubbing it is enough. */
function onPlatform(name: string): void {
  Object.defineProperty(navigator, 'userAgentData', { value: { platform: name }, configurable: true });
}

describe('describeCaptureError', () => {
  let env: DomEnv;
  let mod: Mod;

  before(async () => {
    env = installDom();
    mod = await import('./devicePermission.js');
  });
  after(() => env.cleanup());
  beforeEach(() => onPlatform('Windows'));

  test('a refusal that left NO decision on record offers both readings, and names the Windows path', () => {
    // Still `prompt` AFTER the rejection, which has two causes and no way to tell them
    // apart: the OS refused before a prompt could be drawn, or the user closed one they
    // did see. The user knows which; the remedy asks them instead of picking wrong.
    const p = mod.describeCaptureError(new DOMException('Permission denied', 'NotAllowedError'), 'microphone', {
      before: 'prompt',
      after: 'prompt',
    });
    assert.equal(p.kind, 'blocked');
    assert.equal(p.scope, 'system');
    // It claims only what is known — permission was not obtained — because `prompt`
    // also describes a user who closed a dialog they DID see.
    assert.match(p.message, /could not get permission/);
    assert.match(String(p.howToFix), /If you saw a prompt/);
    assert.match(String(p.howToFix), /Settings, Privacy and security, Microphone/);
    assert.match(String(p.howToFix), /desktop apps/);
  });

  test('DECLINING the prompt is the browser, not the OS — the commonest path of all', () => {
    // The regression this pins (#1335): a first-ever use starts at `prompt`, so reading
    // only the state BEFORE sent every user who clicked Block to a Windows setting that
    // was not the problem. The state after is `denied`, which is the decision they made.
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', {
      before: 'prompt',
      after: 'denied',
    });
    assert.equal(p.scope, 'browser');
    assert.match(p.message, /Access to your microphone is blocked/);
    assert.match(String(p.howToFix), /chrome:\/\/settings\/content\/microphone/);
    assert.doesNotMatch(String(p.howToFix), /Windows/);
  });

  test('a refusal already on record before we asked is the browser', () => {
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', { before: 'denied' });
    assert.equal(p.scope, 'browser');
    assert.match(String(p.howToFix), /chrome:\/\/settings\/content\/microphone/);
  });

  test('when the two readings disagree, the LATER one wins', () => {
    // They bracket an async call and are independent live reads, so they can genuinely
    // disagree — the user can reset the permission in another tab mid-call. Letting the
    // stale `before` win would put an OS block back under a browser heading, which is
    // the whole bug this pair of readings exists to fix.
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', {
      before: 'denied',
      after: 'prompt',
    });
    assert.equal(p.scope, 'system');
    assert.match(String(p.howToFix), /Settings, Privacy and security, Microphone/);
  });

  test('a device that reads as granted after the refusal gets no scope claim at all', () => {
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', {
      before: 'denied',
      after: 'granted',
    });
    assert.equal(p.scope, 'unknown');
    assert.doesNotMatch(String(p.howToFix), /If you saw a prompt/);
  });

  test('a browser that cannot report the state at all gets no guess either way', () => {
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', {
      before: 'unsupported',
      after: 'unsupported',
    });
    assert.equal(p.scope, 'unknown');
    assert.doesNotMatch(String(p.howToFix), /If you saw a prompt/);
    assert.doesNotMatch(String(p.howToFix), /Windows/);
  });

  test('the macOS path is named on macOS', () => {
    onPlatform('macOS');
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'camera', {
      before: 'prompt',
      after: 'prompt',
    });
    assert.match(String(p.howToFix), /System Settings, Privacy and Security, Camera/);
  });

  test('a platform we have no path for gets no invented one', () => {
    onPlatform('Linux');
    const p = mod.describeCaptureError(new DOMException('', 'NotAllowedError'), 'microphone', {
      before: 'prompt',
      after: 'prompt',
    });
    assert.match(String(p.howToFix), /chrome:\/\/settings/);
    assert.doesNotMatch(String(p.howToFix), /Settings, Privacy/);
  });

  test('no device is told apart from a blocked one', () => {
    const p = mod.describeCaptureError(new DOMException('', 'NotFoundError'), 'microphone');
    assert.equal(p.kind, 'missing');
    assert.equal(p.howToFix, null);
  });

  test('OverconstrainedError is NOT a DOMException, and must still read as no device', () => {
    // Chrome throws its own interface here. An `instanceof DOMException` test drops it
    // into the unknown branch, where the user gets a raw browser string instead.
    const p = mod.describeCaptureError({ name: 'OverconstrainedError', message: 'no' }, 'microphone');
    assert.equal(p.kind, 'missing');
  });

  test('a device another application is holding says so — the common Windows case', () => {
    const p = mod.describeCaptureError(new DOMException('', 'NotReadableError'), 'microphone');
    assert.equal(p.kind, 'busy');
    assert.match(p.message, /another application/);
  });

  test('an error we do not recognise keeps its own message rather than guessing', () => {
    const p = mod.describeCaptureError(new Error('something else entirely'), 'camera');
    assert.equal(p.kind, 'unknown');
    assert.equal(p.message, 'something else entirely');
  });

  test('problemLine carries the remedy, not just the complaint', () => {
    const p = mod.blockedProblem('microphone', 'browser');
    assert.equal(mod.problemLine(p), `${p.message} ${p.howToFix}`);
  });
});

describe('platform limits', () => {
  let env: DomEnv;
  let mod: Mod;

  before(async () => {
    env = installDom();
    mod = await import('./devicePermission.js');
  });
  after(() => env.cleanup());

  test('macOS cannot capture another application’s audio, so callers must be able to say so', () => {
    onPlatform('macOS');
    assert.equal(mod.supportsSystemAudio(), false);
    onPlatform('Windows');
    assert.equal(mod.supportsSystemAudio(), true);
  });

  test('screen capture has no stored permission to query, and no page in Chrome to offer', async () => {
    assert.equal(await mod.permissionState('screen'), 'unsupported');
    assert.equal(mod.browserSettingsUrl('screen'), null);
    // It does have an OS pane, but only on macOS — Windows has no per-app switch,
    // so there is nowhere to send that user.
    onPlatform('Windows');
    assert.equal(mod.systemSettingsPath('screen'), null);
    onPlatform('macOS');
    assert.match(String(mod.systemSettingsPath('screen')), /Screen Recording/);
  });

  test('a cancelled screen share names the macOS block too, since the two are indistinguishable', async () => {
    // macOS refuses screen recording to an unapproved app with the SAME
    // NotAllowedError, before any picker is drawn — so the user who did not cancel
    // must still be told what to change.
    const saved = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: () => Promise.reject(new DOMException('', 'NotAllowedError')) },
    });
    try {
      onPlatform('macOS');
      const onMac = await mod.acquireScreen({ video: true }).catch((e: unknown) => e);
      assert.match(String((onMac as { problem: { howToFix: string } }).problem.howToFix), /Screen Recording/);

      onPlatform('Windows');
      const elsewhere = await mod.acquireScreen({ video: true }).catch((e: unknown) => e);
      assert.equal((elsewhere as { problem: { howToFix: string | null } }).problem.howToFix, null);
    } finally {
      // Restored, so a test added after this one gets the real thing back.
      if (saved) Object.defineProperty(navigator, 'mediaDevices', saved);
      else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });

  test('a browser without the Permissions API is unsupported, not denied', async () => {
    // "unsupported" must never read as a refusal: the pre-flight would warn about a
    // microphone that works perfectly well.
    const saved = navigator.permissions;
    Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
    assert.equal(await mod.permissionState('microphone'), 'unsupported');
    Object.defineProperty(navigator, 'permissions', { value: saved, configurable: true });
  });
});
