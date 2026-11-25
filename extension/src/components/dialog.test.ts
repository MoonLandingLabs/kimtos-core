// The dialog class contract the app-root stretch depends on (#1089).
//
// `styles/shell.css` gives an APP window's body a flex column and flex-fills its tagged
// `.app-root` in EVERY window state (mounted 720x620 included, not just maximized) by
// scoping the rules to `.dialog-app` / `.dialog:not(.dialog-static)`. A UTILITY dialog
// (Settings, App Store, launcher, …) is marked `.dialog-static` and keeps its plain,
// content-growing scroll-region body. That whole distinction is carried by these two
// classes, so if `createDialog` stops emitting them the CSS silently reverts and the
// empty-state-below-the-fold bug returns with nothing to catch it. This locks the contract.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { createDialog } from './dialog.js';

let env: DomEnv;

describe('createDialog window-vs-utility class contract (#1089 CSS scope)', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('an app window (appDialog:true, size:app) is .dialog-app and NOT .dialog-static', () => {
    const { el } = createDialog({ appDialog: true, size: 'app' });
    assert.ok(el.classList.contains('dialog-app'), 'app window carries the .dialog-app scope');
    assert.ok(
      !el.classList.contains('dialog-static'),
      'an app window must not be static — that is what earns it the every-state stretch',
    );
  });

  test('app windows are the default — appDialog omitted still yields a non-static window', () => {
    const { el } = createDialog({ size: 'app' });
    assert.ok(!el.classList.contains('dialog-static'), 'appDialog defaults to true (an app window)');
  });

  test('a utility dialog (appDialog:false) is .dialog-static so it keeps the plain scroll body', () => {
    const { el } = createDialog({ appDialog: false, size: 'lg' });
    assert.ok(el.classList.contains('dialog-static'), 'utility dialog is opted out of the app-window stretch');
    assert.ok(!el.classList.contains('dialog-app'), 'a utility dialog is not an app window');
  });
});

// Declaring a settings schema is what puts the control in an app window's header
// (appsController). Building it unconditionally would give every app a control that
// opens an empty dialog; never building it would strand an app's settings in
// Settings > Apps. Both halves of that are asserted here.
describe('createDialog settings control', () => {
  beforeEach(() => {
    env = installDom();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('is present, and clickable, when onSettings is passed', () => {
    let opened = 0;
    const { el } = createDialog({ size: 'app', onSettings: () => (opened += 1) });
    const btn = el.querySelector('.window-settings') as HTMLButtonElement;
    assert.ok(btn, 'the header carries a settings control');
    assert.equal(btn.getAttribute('aria-label'), 'Settings');
    btn.click();
    assert.equal(opened, 1, 'clicking it opens the app settings');
  });

  test('is absent for an app that declares no settings', () => {
    const { el } = createDialog({ size: 'app' });
    assert.equal(el.querySelector('.window-settings'), null, 'no schema, no control');
  });

  test('setSettingsEnabled hides it', () => {
    const dialog = createDialog({ size: 'app', onSettings: () => {} });
    const btn = dialog.el.querySelector('.window-settings') as HTMLButtonElement;
    dialog.setSettingsEnabled(false);
    assert.equal(btn.hidden, true);
    dialog.setSettingsEnabled(true);
    assert.equal(btn.hidden, false);
  });
});

// Full screen (#1251). Every window carries the control; it used to be one app's private button.
//
// happy-dom implements NONE of the Fullscreen API — no `fullscreenEnabled`, no `fullscreenElement`,
// no `requestFullscreen`, no `exitFullscreen` — which is worth knowing twice over. It is why these
// tests stub all four, and it is why the production code calls both methods optionally: without
// those `?.`s the control would throw on any browser lacking the API instead of sitting disabled.
describe('createDialog full-screen control', () => {
  /** The document as the Fullscreen API would furnish it, none of which happy-dom provides. */
  interface FsDoc extends Document {
    fullscreenEnabled: boolean;
    fullscreenElement: Element | null;
    exitFullscreen: () => Promise<void>;
  }
  const fsDoc = (): FsDoc => document as unknown as FsDoc;

  /** Requests recorded per element, so a test can assert WHICH element was asked to fill the screen
   *  — the whole point of the change was that it is the dialog's own, not one found by a selector. */
  let requested: Element[];
  let exited: number;

  const stubFullscreen = (enabled = true): void => {
    requested = [];
    exited = 0;
    const d = fsDoc();
    d.fullscreenEnabled = enabled;
    d.fullscreenElement = null;
    d.exitFullscreen = () => {
      exited += 1;
      d.fullscreenElement = null;
      return Promise.resolve();
    };
    (globalThis.Element.prototype as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen =
      function (this: Element) {
        requested.push(this);
        d.fullscreenElement = this;
        return Promise.resolve();
      };
  };

  /** What the browser does after granting or dropping full screen. The control must repaint from
   *  THIS, never from the click that may or may not have caused it. */
  const announce = (): void => void document.dispatchEvent(new globalThis.Event('fullscreenchange'));

  beforeEach(() => {
    env = installDom();
    stubFullscreen();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('every app window carries the control, and it is not the maximize control', () => {
    const { el } = createDialog({ size: 'app' });
    const fs = el.querySelector('.window-fullscreen') as HTMLButtonElement;
    assert.ok(fs, 'the header carries a full-screen control');
    assert.equal(fs.getAttribute('aria-label'), 'Full screen');
    assert.ok(el.querySelector('.window-max'), 'maximize is still there — they are different states');
  });

  test('clicking it asks for full screen on the window itself', () => {
    const { el } = createDialog({ size: 'app' });
    (el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    assert.deepEqual(requested, [el], 'the dialog asks for ITS OWN element, not one it went looking for');
  });

  test('clicking it again gives the screen back', () => {
    const { el } = createDialog({ size: 'app' });
    const fs = el.querySelector('.window-fullscreen') as HTMLButtonElement;
    fs.click();
    announce();
    fs.click();
    assert.equal(exited, 1, 'the second press exits rather than requesting again');
  });

  test('the button follows the browser, including an exit it did not cause', () => {
    // The Esc path. Nothing of ours ran — the browser simply dropped full screen — and the control
    // still has to be telling the truth afterwards.
    const { el } = createDialog({ size: 'app' });
    const fs = el.querySelector('.window-fullscreen') as HTMLButtonElement;
    fsDoc().fullscreenElement = el;
    announce();
    assert.equal(fs.title, 'Exit full screen (Esc)', 'it must reflect a state it was not told about');

    fsDoc().fullscreenElement = null;
    announce();
    assert.equal(fs.title, 'Full screen', 'and reflect losing it just as well');
  });

  test('another window taking the screen leaves this one honest', () => {
    // Only ONE element per document can hold full screen, so a second window taking it silently
    // drops the first. A button tracking its own clicks would still claim to be full screen.
    const first = createDialog({ size: 'app' });
    const second = createDialog({ size: 'app' });
    (first.el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    announce();
    (second.el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    announce();

    const firstBtn = first.el.querySelector('.window-fullscreen') as HTMLButtonElement;
    assert.equal(firstBtn.title, 'Full screen', 'the window that lost the screen must say so');
  });

  test('closing a full-screen window hands the display back', () => {
    // Otherwise the user is left looking at a full-screen nothing, with no window left to press.
    const dialog = createDialog({ size: 'app' });
    (dialog.el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    announce();
    dialog.close();
    assert.equal(exited, 1, 'close must exit full screen while this window holds it');
  });

  test('closing a window that does NOT hold the screen leaves it alone', () => {
    // A second window closing must not yank the display off the one actually using it.
    const holder = createDialog({ size: 'app' });
    const other = createDialog({ size: 'app' });
    (holder.el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    announce();
    other.close();
    assert.equal(exited, 0, 'only the window that owns the screen may give it back');
  });

  test('setFullscreenEnabled(false) hides it and surrenders the screen', () => {
    // Popping an app out moves its content to the floating window and leaves a placeholder here.
    const dialog = createDialog({ size: 'app' });
    const fs = dialog.el.querySelector('.window-fullscreen') as HTMLButtonElement;
    fs.click();
    announce();
    dialog.setFullscreenEnabled(false);
    assert.equal(fs.hidden, true, 'the control goes while there is no app in this window');
    assert.equal(exited, 1, 'and it does not keep the display it can no longer be told to release');
    dialog.setFullscreenEnabled(true);
    assert.equal(fs.hidden, false, 'coming back restores it');
  });

  test('minimizing a full-screen window hands the display back', () => {
    // The browser does NOT do this for you, which is the whole reason the guard exists. Hiding the
    // element that owns the screen leaves `document.fullscreenElement` pointing at it and fires no
    // `fullscreenchange` — measured in Chrome. Without this, Minimize leaves a blank full-screen
    // display with no window left to press, and the next open comes back inside a full screen
    // nobody asked for.
    const dialog = createDialog({ size: 'app' });
    (dialog.el.querySelector('.window-fullscreen') as HTMLButtonElement).click();
    announce();
    dialog.minimize();
    assert.equal(exited, 1, 'minimize must release the screen it cannot leave anything on');
  });

  test('a window that refuses to be maximized refuses full screen too', () => {
    // `maximizable: false` means "do not blow this surface up to fill the display", and full screen
    // is the larger version of the same thing. The Spotlight launcher caps its results at 52vh, so
    // a maximized one is mostly empty (#498) — a full-screen one more so.
    const { el } = createDialog({ size: 'lg', appDialog: false, maximizable: false });
    const fs = el.querySelector('.window-fullscreen') as HTMLButtonElement;
    assert.equal(fs.disabled, true, 'the opt-out has to cover full screen, not just maximize');
    fs.click();
    assert.deepEqual(requested, [], 'and pressing it asks for nothing');
  });

  test('where the browser forbids it the control says so instead of doing nothing', () => {
    stubFullscreen(false);
    const { el } = createDialog({ size: 'app' });
    const fs = el.querySelector('.window-fullscreen') as HTMLButtonElement;
    assert.equal(fs.disabled, true);
    assert.match(fs.title, /isn’t available/, 'a disabled control has to explain itself');
    fs.click();
    assert.deepEqual(requested, [], 'and a click on it asks for nothing');
  });
});

// Fitting the viewport. happy-dom has no layout, so `offsetWidth`/`offsetHeight` are stubbed from the
// inline size (what the browser would compute for a window with an explicit width/height), and
// `innerWidth`/`innerHeight` are driven by hand before dispatching `resize`.
describe('createDialog viewport fitting', () => {
  const setViewport = (w: number, h: number): void => {
    const win = window as unknown as { innerWidth: number; innerHeight: number };
    win.innerWidth = w;
    win.innerHeight = h;
  };
  const resize = (w: number, h: number): void => {
    setViewport(w, h);
    window.dispatchEvent(new globalThis.Event('resize'));
  };
  /** A window the user sized to `w` x `h` at (left, top), as a restored session would. */
  const sizedDialog = (w: number, h: number, left = 100, top = 60, appDialog = true) => {
    const dialog = createDialog({ size: appDialog ? 'app' : 'lg', appDialog });
    Object.defineProperty(dialog.el, 'offsetWidth', { get: () => parseFloat(dialog.el.style.width) || 720 });
    Object.defineProperty(dialog.el, 'offsetHeight', { get: () => parseFloat(dialog.el.style.height) || 620 });
    dialog.applyGeometry({ left, top, width: w, height: h, maximized: false });
    dialog.open();
    return dialog;
  };

  beforeEach(() => {
    env = installDom();
    setViewport(1280, 800);
  });
  afterEach(() => {
    env.cleanup();
  });

  test('a sized window shrinks into a smaller viewport and stays on-screen', () => {
    const { el } = sizedDialog(900, 600, 300, 150);
    resize(600, 500);
    assert.equal(parseFloat(el.style.width), 584, 'width is squeezed to the viewport minus the 8px margins');
    assert.equal(parseFloat(el.style.height), 484);
    assert.ok(parseFloat(el.style.left) + parseFloat(el.style.width) <= 600, 'right edge inside the viewport');
    assert.ok(parseFloat(el.style.top) + parseFloat(el.style.height) <= 500, 'bottom edge inside the viewport');
  });

  test('a sized window grows back to the size the user chose when the viewport grows again', () => {
    // It used to keep the smallest size it had ever been squeezed to, because the resize handler
    // read the current (already clamped) offsetWidth as the size to keep.
    const { el } = sizedDialog(900, 600, 100, 60);
    resize(600, 500);
    resize(1280, 800);
    assert.equal(parseFloat(el.style.width), 900);
    assert.equal(parseFloat(el.style.height), 600);
  });

  test('a window the user never moved is re-centred when the viewport changes', () => {
    const dialog = createDialog({ size: 'lg', appDialog: false });
    Object.defineProperty(dialog.el, 'offsetWidth', { get: () => 400 });
    Object.defineProperty(dialog.el, 'offsetHeight', { get: () => 300 });
    dialog.open();
    resize(800, 600);
    assert.equal(parseFloat(dialog.el.style.left), 200);
    assert.equal(parseFloat(dialog.el.style.top), 150);
    resize(500, 400);
    assert.equal(parseFloat(dialog.el.style.left), 50, 'centred again on the new viewport, not left hanging');
    assert.equal(parseFloat(dialog.el.style.top), 50);
  });

  test('a window the user moved is clamped, not re-centred', () => {
    const { el } = sizedDialog(400, 400, 700, 300);
    resize(600, 500);
    assert.equal(parseFloat(el.style.left), 200, 'pulled back so the whole window fits');
    assert.equal(parseFloat(el.style.top), 100);
  });

  test('restoring from maximize re-fits to a viewport that shrank while maximized', () => {
    // The remembered position belongs to the old viewport and the resize handler skips a maximized
    // window, so restore itself has to re-fit or the window comes back hanging off-screen.
    const { el } = sizedDialog(500, 400, 700, 300);
    (el.querySelector('.window-max') as HTMLButtonElement).click();
    assert.ok(el.classList.contains('is-max'));
    resize(600, 500);
    (el.querySelector('.window-max') as HTMLButtonElement).click();
    assert.ok(!el.classList.contains('is-max'));
    assert.equal(parseFloat(el.style.left), 100, 'left clamped to 600 - 500');
    assert.equal(parseFloat(el.style.top), 100, 'top clamped to 500 - 400');
  });

  test('maximize and restore leave the inline size and position untouched', () => {
    const { el } = sizedDialog(500, 400, 120, 80);
    const max = el.querySelector('.window-max') as HTMLButtonElement;
    max.click();
    assert.equal(el.style.width, '500px', 'the sized width is kept for the restore');
    max.click();
    assert.equal(el.style.width, '500px');
    assert.equal(el.style.height, '400px');
    assert.equal(el.style.left, '120px');
    assert.equal(el.style.top, '80px');
  });

  test('a window re-opened after the viewport shrank while it was hidden is re-fitted', () => {
    const dialog = sizedDialog(900, 600, 300, 150);
    dialog.minimize();
    // `hide` flips `hidden` after the fade; force it, as the timer would.
    dialog.el.hidden = true;
    setViewport(600, 500);
    dialog.open();
    assert.equal(parseFloat(dialog.el.style.width), 584);
    assert.ok(parseFloat(dialog.el.style.left) + parseFloat(dialog.el.style.width) <= 600);
  });

  test('destroy detaches the resize listener', () => {
    const dialog = sizedDialog(900, 600, 100, 60);
    dialog.destroy();
    resize(600, 500);
    assert.equal(parseFloat(dialog.el.style.width), 900, 'a destroyed window no longer reacts to the viewport');
  });
});
