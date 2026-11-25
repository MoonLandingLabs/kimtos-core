// An overlay opened from a FULL-SCREEN window has to mount inside it (#1251 -> this).
//
// A full-screen element is promoted to the browser's top layer and painted over an opaque
// `::backdrop`. Nothing outside its subtree is visible, at any z-index — and the confirm overlay
// asks for 1000000, which is what makes the symptom read as impossible: "Delete this recording?"
// appeared UNDER the Video Recorder window, unreachable and undismissable, and so did the app's own
// settings window.
//
// It was one app's problem while NotaBoard was the only thing that could go full screen. Giving
// every window a full-screen control turned it into every app's, across all nine overlay kinds
// that share this helper — confirm, prompt, info, picker, snackbar, toast, context menu, lightbox
// and the image cropper — plus every app window `createDialog` opens.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';

let env: DomEnv;
let overlayHost: typeof import('./dom.js').overlayHost;

/** happy-dom implements no Fullscreen API, so the one property this depends on is defined here.
 *  That is not a shortcut around the test: `fullscreenElement` IS the whole input. */
function setFullscreen(node: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: node });
}

describe('overlayHost: where a floating thing mounts', () => {
  beforeEach(async () => {
    env = installDom();
    ({ overlayHost } = await import('./dom.js'));
    setFullscreen(null);
  });
  afterEach(() => {
    env.cleanup();
  });

  test('the page body, when nothing is full screen', () => {
    assert.equal(overlayHost(), document.body, 'the ordinary case must be unchanged');
  });

  test('the full-screen element, when there is one', () => {
    // The fix. Mounting anywhere else puts the overlay outside the top layer, where the backdrop
    // covers it however high its z-index.
    const win = document.createElement('div');
    document.body.append(win);
    setFullscreen(win);
    assert.equal(overlayHost(), win, 'an overlay must join the element that owns the screen');
  });

  test('back to the body once full screen ends', () => {
    const win = document.createElement('div');
    document.body.append(win);
    setFullscreen(win);
    setFullscreen(null);
    assert.equal(overlayHost(), document.body);
  });

  test('a popped-out owner still wins over this page', () => {
    // The ORIGINAL reason this helper exists (#85): an app popped into a floating window lives in
    // another document, and an overlay left on this page sits behind the window the user is looking
    // at. The full-screen rule is resolved against that owner's document, never this one — so the
    // new behaviour cannot quietly undo the old one.
    const other = document.implementation.createHTMLDocument();
    const owner = other.createElement('div');
    other.body.append(owner);
    assert.equal(overlayHost(owner as Element), other.body, "the owner's own document decides");
  });

  test('a non-HTML full-screen element is ignored rather than trusted', () => {
    // `fullscreenElement` is an Element; an SVG or MathML node cannot host our markup. Falling back
    // to the body renders in the wrong layer, which is visible and fixable — appending to something
    // that cannot lay it out is neither.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    setFullscreen(svg);
    assert.equal(overlayHost(), document.body);
  });
});
