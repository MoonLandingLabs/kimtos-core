// The shared in-field chip UI (#511). One primitive drives both Grammit's and
// Clipboard's field affordance, so its placement, stacking, count badge and
// fade-while-typing are worth pinning — a regression here shows up on every page.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type DomEnv } from '../test/domEnv.js';
import { createFieldChip, __resetFieldChipOffset, type FieldChip } from './fieldChip.js';

let env: DomEnv;
let doc: Document;
const made: FieldChip[] = [];

function rect(over: Partial<DOMRect>): DOMRect {
  const base = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
  return { ...base, ...over } as DOMRect;
}
// A field whose geometry we control (happy-dom does no layout).
function field(over: Partial<DOMRect>): HTMLElement {
  const el = doc.createElement('textarea');
  doc.body.append(el);
  el.getBoundingClientRect = () => rect(over);
  return el;
}
const REAL = { left: 100, top: 100, right: 400, bottom: 130, width: 300, height: 30 };
const leftOf = (c: FieldChip): number => parseFloat(c.host.style.left);
const shadow = (c: FieldChip): ShadowRoot => (c.host as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot;

describe('fieldChip — the shared in-field affordance', () => {
  beforeEach(() => {
    env = installDom();
    doc = env.document;
    __resetFieldChipOffset();
  });
  afterEach(() => {
    for (const c of made.splice(0)) c.destroy();
    env.cleanup();
  });
  const make = (name: string, order: number): FieldChip => {
    const c = createFieldChip({ name, order, icon: '<svg></svg>', title: name, onClick: () => {} });
    made.push(c);
    return c;
  };

  test('marks its host so a chip from another content-script bundle can find and stack past it', () => {
    const c = make('clipboard', 0);
    assert.equal(c.host.getAttribute('data-kimtos-chip'), 'clipboard');
    assert.equal(c.host.getAttribute('data-kimtos-chip-order'), '0');
  });

  test('hides for a tiny field, shows for a real one', () => {
    const c = make('clipboard', 0);
    c.show(field({ width: 10, height: 10, right: 10, bottom: 10 }));
    assert.equal(c.host.style.display, 'none');
    c.show(field(REAL));
    assert.equal(c.host.style.display, 'block');
  });

  test('sits inside the field bottom-right and never over the left where the text is', () => {
    const c = make('clipboard', 0);
    c.show(field(REAL));
    assert.ok(leftOf(c) > REAL.left, 'chip is on the right, not the left edge');
    assert.ok(leftOf(c) + 26 <= REAL.right, 'chip stays within the field right edge');
  });

  test('two chips stack leftward without overlapping (higher order sits further left)', () => {
    const f = field(REAL);
    const clip = make('clipboard', 0);
    const gram = make('grammit', 1);
    clip.show(f);
    gram.show(f);
    clip.show(f); // re-place now the sibling exists; slot counts visible siblings
    assert.ok(leftOf(gram) < leftOf(clip), 'grammit (order 1) should sit left of clipboard (order 0)');
    assert.ok(leftOf(clip) - leftOf(gram) >= 26, 'the two chips do not overlap');
  });

  test('setCount shows a badge only when there are suggestions, and caps at 99+', () => {
    const c = make('grammit', 1);
    const count = shadow(c).querySelector('.count') as HTMLElement;
    c.setCount(3);
    assert.equal(count.style.display, '');
    assert.equal(count.textContent, '3');
    c.setCount(0);
    assert.equal(count.style.display, 'none');
    c.setCount(120);
    assert.equal(count.textContent, '99+');
  });

  test('markActivity dims the chip while typing', () => {
    const c = make('grammit', 1);
    const chipEl = shadow(c).querySelector('.chip') as HTMLElement;
    assert.ok(!chipEl.classList.contains('dim'));
    c.markActivity();
    assert.ok(chipEl.classList.contains('dim'));
  });

  test('destroy removes the host from the page', () => {
    const c = make('clipboard', 0);
    assert.ok(doc.querySelector('[data-kimtos-chip="clipboard"]'));
    c.destroy();
    made.length = 0; // already destroyed
    assert.equal(doc.querySelector('[data-kimtos-chip="clipboard"]'), null);
  });
});
