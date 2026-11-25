// Filling a real form, in a real DOM — and the one test that could not be written before
// happy-dom landed: that a React-style controlled input actually receives the data.
//
// `input.value = x` does not update React/Vue/Angular. The framework tracks the value on the
// element and, seeing no change through its own setter, never fires onChange — so the form
// submits empty while the text sits in the box. Fake Filler advertises framework support
// because THIS is what it solves, and any filler that skips it is broken on most of the modern
// web. So the headline case here mimics React's value tracker and asserts the fill still lands.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../../test/domEnv.js';

let env: DomEnv;
let doc: Document;
let fillFields: typeof import('./fill.js').fillFields;

before(async () => {
  env = installDom();
  doc = env.document;
  // Dynamic import: the module reads DOM globals, so the DOM must exist first.
  ({ fillFields } = await import('./fill.js'));
});
after(() => env.cleanup());
beforeEach(() => doc.body.replaceChildren());

/** Build a form from a compact spec and return it. */
function form(html: string): HTMLFormElement {
  const wrap = doc.createElement('form');
  wrap.innerHTML = html;
  doc.body.append(wrap);
  return wrap;
}

describe('the framework trap: a React-style controlled input', () => {
  test('a value written past a shadowing tracker still fires onChange with the new value', () => {
    const input = doc.createElement('input');
    input.type = 'email';
    input.name = 'email';
    doc.body.append(input);

    // React installs a value tracker as an OWN property that shadows the prototype setter, and
    // records what it last saw. onChange only fires when the tracked value and the DOM value
    // differ. This models exactly that.
    let tracked = '';
    let onChangeValue = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => tracked,
      set: (v: string) => {
        tracked = v;
      },
    });
    input.addEventListener('input', () => {
      // The real React reads the NATIVE value here. Our fill wrote through the prototype's
      // setter, bypassing the shadowing own-property setter above — so we read it back the way
      // React's tracker does: via the prototype's native getter, not the shadowing one.
      const nativeGet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.get;
      const domValue = nativeGet ? (nativeGet.call(input) as string) : tracked;
      if (domValue !== onChangeValue) onChangeValue = domValue;
    });

    const result = fillFields('all', { document: doc });

    assert.equal(result.filled, 1);
    // The event fired AND carried the value that was actually written — not the empty string
    // the shadowing tracker would have reported if we had assigned through it.
    assert.ok(onChangeValue && onChangeValue.includes('@'), `onChange saw "${onChangeValue}"`);
  });
});

describe('fillFields: it fills what it should and skips what it must not', () => {
  test('a representative form is filled with values that fit each field', () => {
    const f = form(`
      <input name="full_name" autocomplete="name">
      <input name="email" type="email">
      <input name="password" type="password">
      <input name="phone" type="tel">
      <input name="zip" maxlength="5">
      <input name="dob" type="date">
      <textarea name="message"></textarea>
    `);
    const r = fillFields('form', { target: f.querySelector('input'), document: doc });
    assert.equal(r.filled, 7);

    const value = (name: string) => (f.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
    assert.match(value('email'), /@example\./);
    assert.match(value('phone'), /555-01/);
    assert.ok(value('zip').length <= 5);
    assert.match(value('dob'), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(value('full_name').includes(' '));
    assert.ok(r.password && value('password') === r.password);
  });

  test('disabled, readonly, hidden and CAPTCHA fields are left alone', () => {
    const f = form(`
      <input name="a">
      <input name="b" disabled>
      <input name="c" readonly>
      <input name="d" type="hidden">
      <input name="g-recaptcha-response">
    `);
    const r = fillFields('all', { document: doc });
    assert.equal((f.querySelector('[name="a"]') as HTMLInputElement).value.length > 0, true);
    assert.equal((f.querySelector('[name="b"]') as HTMLInputElement).value, '');
    assert.equal((f.querySelector('[name="c"]') as HTMLInputElement).value, '');
    assert.equal(r.filled, 1);
    assert.ok(r.skipped >= 4);
  });

  test('a select gets a real option, never the placeholder', () => {
    const f = form(`
      <select name="plan">
        <option value="">Choose a plan</option>
        <option value="starter">Starter</option>
        <option value="team">Team</option>
      </select>
    `);
    let changed = false;
    f.querySelector('select')!.addEventListener('change', () => (changed = true));
    fillFields('all', { document: doc });
    const select = f.querySelector('select') as HTMLSelectElement;
    assert.notEqual(select.value, '');
    assert.ok(['starter', 'team'].includes(select.value));
    assert.ok(changed, 'change event fired');
  });

  test('a required checkbox is always ticked so the form can submit', () => {
    const f = form(`<input type="checkbox" name="terms" required>`);
    fillFields('all', { document: doc });
    assert.equal((f.querySelector('input') as HTMLInputElement).checked, true);
  });

  test('exactly one radio in a group is chosen', () => {
    const f = form(`
      <input type="radio" name="size" value="s">
      <input type="radio" name="size" value="m">
      <input type="radio" name="size" value="l">
    `);
    fillFields('all', { document: doc });
    const checked = f.querySelectorAll('input[name="size"]:checked');
    assert.equal(checked.length, 1);
  });

  test('two forms reusing a radio name each get their own chosen option', () => {
    const a = form(`<input type="radio" name="pick" value="1"><input type="radio" name="pick" value="2">`);
    const b = form(`<input type="radio" name="pick" value="3"><input type="radio" name="pick" value="4">`);
    fillFields('all', { document: doc });
    assert.equal(a.querySelectorAll('input:checked').length, 1);
    assert.equal(b.querySelectorAll('input:checked').length, 1);
  });

  test('a contentEditable rich editor is filled', () => {
    const editor = doc.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('aria-label', 'Your comment');
    doc.body.append(editor);
    const r = fillFields('all', { document: doc });
    assert.equal(r.filled, 1);
    assert.ok((editor.textContent ?? '').length > 0);
  });
});

describe('scope', () => {
  test('field scope fills only the focused field', () => {
    const f = form(`<input name="a"><input name="b">`);
    const target = f.querySelector('[name="a"]') as HTMLInputElement;
    const r = fillFields('field', { target, document: doc });
    assert.equal(r.filled, 1);
    assert.ok(target.value.length > 0);
    assert.equal((f.querySelector('[name="b"]') as HTMLInputElement).value, '');
  });

  test('form scope stays inside the target form; all scope crosses forms', () => {
    const a = form(`<input name="a1"><input name="a2">`);
    form(`<input name="b1">`);
    const inForm = fillFields('form', { target: a.querySelector('input'), document: doc });
    assert.equal(inForm.filled, 2);

    doc.body.replaceChildren();
    form(`<input name="a1">`);
    form(`<input name="b1">`);
    const everywhere = fillFields('all', { document: doc });
    assert.equal(everywhere.filled, 2);
  });
});

describe('undo', () => {
  test('restore puts every field back exactly, including a prior value', () => {
    const f = form(`
      <input name="name" value="original">
      <input type="checkbox" name="opt">
      <select name="plan"><option value="">--</option><option value="team">Team</option></select>
    `);
    const box = f.querySelector('[name="opt"]') as HTMLInputElement;
    box.checked = true;
    const before = {
      name: (f.querySelector('[name="name"]') as HTMLInputElement).value,
      opt: box.checked,
      plan: (f.querySelector('select') as HTMLSelectElement).value,
    };

    const r = fillFields('all', { document: doc });
    assert.ok(r.filled >= 2);
    assert.notEqual((f.querySelector('[name="name"]') as HTMLInputElement).value, before.name);

    const restored = r.restore();
    assert.ok(restored >= 2);
    assert.equal((f.querySelector('[name="name"]') as HTMLInputElement).value, before.name);
    assert.equal((f.querySelector('[name="opt"]') as HTMLInputElement).checked, before.opt);
    assert.equal((f.querySelector('select') as HTMLSelectElement).value, before.plan);
  });

  test('restore is idempotent — a second call restores nothing more', () => {
    form(`<input name="a">`);
    const r = fillFields('all', { document: doc });
    assert.equal(r.restore(), 1);
    assert.equal(r.restore(), 0);
  });
});
