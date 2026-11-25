// A guard is only worth having if it FAILS on the thing it exists to catch. These tests are mostly
// about the failing cases, and about the two ways a check like this quietly passes everything: a
// `return` that belongs to a nested helper, and a bare `return;` early exit.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  code,
  holdingApisUsed,
  renderReturnsTeardown,
  sidebarsMounted,
  undestroyedSidebars,
  HOLDING_APIS,
} from './check-app-teardown.mjs';

describe('spotting an app that takes hold of something', () => {
  test('finds a player, a recorder and a timer', () => {
    assert.deepEqual(holdingApisUsed('const p = createAudioPlayer(url);'), ['createAudioPlayer']);
    assert.deepEqual(holdingApisUsed('new MediaRecorder(stream)'), ['MediaRecorder']);
    assert.deepEqual(holdingApisUsed('setInterval(tick, 1000)'), ['setInterval']);
  });

  test('an app that holds nothing is not policed', () => {
    assert.deepEqual(holdingApisUsed('const x = 1; render() { body.append(el); }'), []);
  });

  // Otherwise the guard would fire on the comment explaining why the guard exists.
  test('a mention in a comment or a string is not a use', () => {
    assert.deepEqual(holdingApisUsed('// we deliberately avoid createAudioPlayer here'), []);
    assert.deepEqual(holdingApisUsed('/* setInterval is banned */'), []);
    assert.deepEqual(holdingApisUsed("throw new Error('MediaRecorder failed')"), []);
  });

  test('reports every distinct API it finds', () => {
    const used = holdingApisUsed('createAudioPlayer(a); createVideoPlayer(b); setInterval(c, 1);');
    assert.deepEqual(used.sort(), ['createAudioPlayer', 'createVideoPlayer', 'setInterval'].sort());
  });
});

describe('deciding whether render hands back a teardown', () => {
  test('an arrow teardown counts', () => {
    assert.equal(renderReturnsTeardown('render(body) { const p = 1; return () => stop(); }'), true);
  });

  test('a named teardown counts — several apps return one', () => {
    assert.equal(renderReturnsTeardown('render(body) { function down() {} return down; }'), true);
  });

  test('returning nothing is the failure this exists to catch', () => {
    assert.equal(renderReturnsTeardown('render(body) { const p = createAudioPlayer(u); body.append(p.el); }'), false);
  });

  // THE way a check like this fools itself: the helper returns, the render does not.
  test('a return inside a nested helper does NOT count', () => {
    const src = `render(body) {
      const rows = items.map((i) => { return row(i); });
      body.append(...rows);
    }`;
    assert.equal(renderReturnsTeardown(src), false);
  });

  test('a nested helper AND a real teardown still counts', () => {
    const src = `render(body) {
      const rows = items.map((i) => { return row(i); });
      return () => stop();
    }`;
    assert.equal(renderReturnsTeardown(src), true);
  });

  // An early exit is not a teardown; treating it as one would pass an app that returns nothing.
  test('a bare early `return;` does not count', () => {
    assert.equal(renderReturnsTeardown('render(body) { if (!ok) return; body.append(x); }'), false);
  });

  test('an early `return;` before a real teardown still counts', () => {
    assert.equal(renderReturnsTeardown('render(body) { if (!ok) return; return () => stop(); }'), true);
  });

  test('a render with a typed ctx parameter is still found', () => {
    const src = 'render(body: HTMLElement, ctx: { openApp?: (id: string) => void } = {}) { return () => stop(); }';
    assert.equal(renderReturnsTeardown(src), true);
  });

  // Null, not false: the caller treats "no render here" as "the factory owns it", which is how
  // Voice to Text passes without its own render.
  test('no render at all is reported as unknown, not as a failure', () => {
    assert.equal(renderReturnsTeardown('export default createMediaTextApp({ id: "televoica" });'), null);
  });

  test('a word ending in `return` is not a return statement', () => {
    assert.equal(renderReturnsTeardown('render(body) { const noreturn = 1; body.append(x); }'), false);
  });

  // The guard was defeatable by a variable name. `let returnValue = ...` at the top level of a
  // render body matched the word `return`, so an app holding a microphone with NO teardown passed
  // the one check that exists to stop it. Both word boundaries are now required.
  test('an identifier that merely STARTS with `return` does not count', () => {
    const src = `render(body) {
      setInterval(() => {}, 100);
      let returnValue = compute();
      body.append(returnValue);
    }`;
    assert.equal(renderReturnsTeardown(src), false);
  });

  test('a property access like `x.returns` does not count', () => {
    assert.equal(renderReturnsTeardown('render(body) { const n = x.returns; body.append(n); }'), false);
  });

  test('an identifier starting with `return` alongside a real teardown still counts', () => {
    const src = `render(body) {
      let returnValue = compute();
      return () => stop();
    }`;
    assert.equal(renderReturnsTeardown(src), true);
  });
});

test('the policed list names the APIs that hold a device or a timer', () => {
  for (const api of ['createAudioPlayer', 'createVideoPlayer', 'MediaRecorder', 'getUserMedia', 'setInterval'])
    assert.ok(HOLDING_APIS.includes(api), `${api} must be policed`);
});

// The stripper is the guard's eyes. Everything above trusts it to have read the whole file, so its
// failure mode is not a wrong answer — it is a confident "all clear" for a span it never looked at.
describe('reading the code and nothing but the code', () => {
  test('a comment and a string are both blanked out', () => {
    const src = "// createAudioPlayer\nconst m = 'MediaRecorder'; setInterval(t, 1);";
    assert.deepEqual(holdingApisUsed(src), ['setInterval']);
  });

  // THE bug this scanner replaced. A wildcard mime type contains slash-star, the old stripper read
  // it as the start of a block comment, and everything up to the next real close vanished — in
  // Retouch that was two hundred lines, including the history sidebar it mounts (#1329).
  test('a slash-star inside a string does not open a comment', () => {
    const src = ["const input = Object.assign(el('input'), { accept: 'image/*' });", 'setInterval(tick, 100);'].join(
      '\n',
    );
    assert.deepEqual(holdingApisUsed(src), ['setInterval'], 'the code after the wildcard must still be read');
  });

  test('a real block comment is still stripped', () => {
    assert.deepEqual(holdingApisUsed('/* setInterval\n   MediaRecorder */\nconst x = 1;'), []);
  });

  test('a quote inside a comment cannot swallow the code after it', () => {
    assert.deepEqual(holdingApisUsed("// we don't call it here\nsetInterval(tick, 1);"), ['setInterval']);
  });

  test('an escaped quote does not end the string early', () => {
    assert.deepEqual(holdingApisUsed("const s = 'it\\'s setInterval'; MediaRecorder;"), ['MediaRecorder']);
  });

  test('a template literal may span lines; a plain string may not', () => {
    assert.deepEqual(holdingApisUsed('const s = `line\nsetInterval`; MediaRecorder;'), ['MediaRecorder']);
    // An unterminated quote costs one line, not the rest of the file.
    assert.deepEqual(holdingApisUsed("const s = 'oops;\nsetInterval(t, 1);"), ['setInterval']);
  });

  test('braces inside a string never confuse the brace matcher', () => {
    assert.equal(renderReturnsTeardown("render(body) { const s = '}'; return () => stop(); }"), true);
  });

  test('line numbers survive, so anything reading them still lines up', () => {
    assert.equal(code('a\n/* two\nthree */\nd').split('\n').length, 4);
  });
});

describe('spotting a history sidebar nobody destroys', () => {
  const MOUNT = 'const history = createHistorySidebar({ load, remove, itemOf });';

  test('a host that destroys its sidebar passes', () => {
    assert.deepEqual(undestroyedSidebars(`${MOUNT}\nreturn () => { history.destroy(); };`), []);
  });

  test('a host that never destroys it is the failure this exists to catch', () => {
    assert.deepEqual(undestroyedSidebars(`${MOUNT}\nreturn () => { stopPlayers(); };`), ['history']);
  });

  // THE near-miss. Five of the six hosts already tear down a resizer in the same teardown, so a
  // check for a bare `.destroy(` would have passed every one of them without the sidebar being
  // touched at all.
  test('destroying something else does not count', () => {
    assert.deepEqual(undestroyedSidebars(`${MOUNT}\nreturn () => { shell.responsive.destroy?.(); };`), ['history']);
  });

  test('an optional call counts — the shared factory declares its sidebar nullable', () => {
    const src = 'let history = null;\nhistory = createHistorySidebar({ load });\nreturn () => history?.destroy();';
    assert.deepEqual(sidebarsMounted(src), ['history']);
    assert.deepEqual(undestroyedSidebars(src), []);
  });

  test('a file that mounts no sidebar is not policed', () => {
    assert.deepEqual(sidebarsMounted('import { createHistorySidebar } from "../../components/historySidebar.js";'), []);
  });

  test('a mount shown in a comment is not a mount', () => {
    assert.deepEqual(sidebarsMounted(`// ${MOUNT}`), []);
  });

  // `$` is legal in an identifier and is an anchor in a regex, so a name carrying one would match
  // nothing and be reported as never destroyed — a red build for code that is correct.
  test('a name containing a dollar sign is matched literally', () => {
    const src = 'const $history = createHistorySidebar({ load });\nreturn () => $history.destroy();';
    assert.deepEqual(sidebarsMounted(src), ['$history']);
    assert.deepEqual(undestroyedSidebars(src), []);
  });

  test('each distinct sidebar is judged on its own name', () => {
    const src = `${MOUNT}\nconst clips = createHistorySidebar({ load });\nreturn () => history.destroy();`;
    assert.deepEqual(undestroyedSidebars(src), ['clips']);
  });
});
