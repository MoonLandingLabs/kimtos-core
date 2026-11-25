// Reading a real form, and writing to it in a way the page actually notices.
//
// THE TRAP THIS MODULE EXISTS FOR: `input.value = 'x'` does not update React, Vue or Angular.
//
// React attaches a value tracker to the node as an OWN property, shadowing the prototype's
// `value` setter. Assigning through it updates the tracker as well, so React compares old and
// new, sees no difference, and never dispatches `onChange`. Its state stays empty, and the form
// submits empty — while the user is looking at the text sitting in the box. It looks like it
// works, right up until you press Submit.
//
// So every write here goes through the PROTOTYPE's native setter (`nativeSet`), which bypasses
// the instance-level tracker and leaves it stale, and is then followed by real bubbling `input`
// and `change` events. That is the whole reason the reference implementation advertises
// framework support, and any filler that skips it is broken on most of the modern web.
//
// Everything with a DOM in it lives here, so `detect.ts` and `values.ts` stay pure.

import { execEdit, applyToRange } from '../editCommand.js';
import { detectKind, emptyFieldInfo, type FieldInfo, type FieldKind } from './detect.js';
import { createFillContext, valueFor, type FillContext } from './values.js';

/** Which fields an action addresses. */
export type FillScope =
  /** Only the focused field. */
  | 'field'
  /** Every field in the form containing the focused field (the whole page if it is in none). */
  | 'form'
  /** Every field on the page, across forms. */
  | 'all';

export interface FillOptions {
  /** The element the action was aimed at. Defaults to the document's active element. */
  target?: Element | null;
  /** Replay a previous fill exactly. Omit for a fresh one. */
  seed?: number;
  /** "Today" — injected so date generation is testable. */
  now?: Date;
  document?: Document;
}

export interface FillResult {
  filled: number;
  /** Candidate fields the pass deliberately left alone (hidden, disabled, CAPTCHA, a file box). */
  skipped: number;
  /** The password that was written, if any — shown to the tester so they can log back in. */
  password: string | null;
  /** The seed this fill used. Feed it back to reproduce the identical values. */
  seed: number;
  /** Put every field this fill touched back exactly as it was; returns how many were restored. */
  restore: () => number;
}

const FIELD_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

// ── reading the page ──────────────────────────────────────────────────────────────────────

const attr = (el: Element, name: string): string => el.getAttribute(name) ?? '';

/** The text a sighted user sees as this field's label. */
function labelTextOf(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];

  for (const id of attr(el, 'aria-labelledby').split(/\s+/).filter(Boolean)) {
    const node = doc.getElementById(id);
    if (node) parts.push(node.textContent ?? '');
  }
  const id = el.id;
  if (id) {
    // `[for]` needs escaping: an id may legally contain characters a selector treats as syntax
    // (Tailwind and Rails both generate them), and an unescaped one throws and takes the whole
    // fill down rather than losing one label.
    const escaped = cssEscape(id);
    if (escaped) for (const node of doc.querySelectorAll(`label[for="${escaped}"]`)) parts.push(node.textContent ?? '');
  }
  const wrapping = el.closest('label');
  if (wrapping) parts.push(wrapping.textContent ?? '');

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const cssEscape = (value: string): string => {
  const esc = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return esc ? esc(value) : /^[\w-]+$/.test(value) ? value : '';
};

/** Describe an element as the pure detector wants it. */
export function describe(el: Element): FieldInfo {
  const tag = el.tagName.toLowerCase();
  const input = el as HTMLInputElement; // the shared shape of input/textarea/select; missing
  // properties simply read undefined, which the fallbacks below handle.
  const contentEditable = attr(el, 'contenteditable').toLowerCase();
  const editable =
    el.hasAttribute('contenteditable') &&
    (contentEditable === '' || contentEditable === 'true' || contentEditable === 'plaintext-only');
  return emptyFieldInfo({
    tag,
    type: tag === 'input' ? (attr(el, 'type') || 'text').toLowerCase() : '',
    name: input.name ?? '',
    id: el.id ?? '',
    className: typeof el.className === 'string' ? el.className : '',
    placeholder: attr(el, 'placeholder'),
    ariaLabel: attr(el, 'aria-label'),
    label: labelTextOf(el),
    autocomplete: attr(el, 'autocomplete'),
    maxLength: typeof input.maxLength === 'number' ? input.maxLength : -1,
    min: attr(el, 'min'),
    max: attr(el, 'max'),
    step: attr(el, 'step'),
    pattern: attr(el, 'pattern'),
    required: Boolean(input.required),
    disabled: Boolean(input.disabled),
    readOnly: Boolean(input.readOnly),
    editable,
  });
}

/**
 * Is this field hidden from the user?
 *
 * Deliberately a STYLE test, not a bounding-box one. A box measures zero for plenty of honest
 * reasons — a collapsed accordion mid-animation, a field in an off-screen carousel, any headless
 * environment — and treating those as "hidden" quietly halves what the filler fills. What we
 * actually mean is "the author took it out of the page", which is `display:none`,
 * `visibility:hidden` or the `hidden` attribute.
 */
function isHidden(el: Element): boolean {
  if ((el as HTMLElement).hidden) return true;
  const view = el.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

// ── writing to the page ───────────────────────────────────────────────────────────────────

/**
 * Set a property through the PROTOTYPE's setter, bypassing any instance-level override.
 *
 * This one line is the difference between a filler that works on React/Vue/Angular and one that
 * only works on a plain HTML demo. See the header.
 */
function nativeSet(el: Element, prop: 'value' | 'checked', value: string | boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, prop);
  if (descriptor?.set) descriptor.set.call(el, value);
  else (el as unknown as Record<string, unknown>)[prop] = value;
}

/** A bubbling event of the page's own Event class, so a listener in the page sees it as native. */
function fire(el: Element, type: 'input' | 'change'): void {
  const view = el.ownerDocument.defaultView;
  const Ctor = view?.Event ?? Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
}

/** Write a text value and tell the page about it. */
function writeValue(el: Element, value: string): void {
  nativeSet(el, 'value', value);
  fire(el, 'input');
  fire(el, 'change');
}

/**
 * Set a checkbox/radio to `want`.
 *
 * `click()` rather than assigning `checked`: a click runs the element's default action (which
 * flips it) AND dispatches the same `input`/`change` events a real user would, through the
 * page's own listeners. Assigning `checked` and firing events by hand is close, but a radio
 * group's siblings are only un-checked correctly by the real activation behaviour.
 */
function writeChecked(el: HTMLInputElement, want: boolean): void {
  if (el.checked === want) return;
  el.click();
  // A page that calls preventDefault on the click leaves the state unchanged. Fall back so the
  // field still ends up right, rather than silently doing nothing.
  if (el.checked !== want) {
    nativeSet(el, 'checked', want);
    fire(el, 'input');
    fire(el, 'change');
  }
}

/** Replace a contentEditable's text through execCommand, so a rich editor's own model follows. */
function writeEditable(el: HTMLElement, value: string): void {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const selection = view?.getSelection?.();
  const range = doc.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  el.focus();
  if (!execEdit(value, doc)) applyToRange(range, value, el);
}

// ── choosing an option the page already offers ────────────────────────────────────────────

/** Option labels that mean "nothing chosen" — never the answer a form is looking for. */
const PLACEHOLDER_OPTION = /^\s*(--+\s*)?(please\s+)?(select|choose|pick|none|any|-+)\b/i;

/** Every option a `<select>` would accept as a real answer. */
function realOptions(select: HTMLSelectElement): HTMLOptionElement[] {
  const all = Array.from(select.options).filter((o) => !o.disabled);
  const real = all.filter((o) => o.value !== '' && !PLACEHOLDER_OPTION.test(o.textContent ?? ''));
  return real.length ? real : all;
}

// ── the fill ──────────────────────────────────────────────────────────────────────────────

/** Collect the fields an action addresses, in document order. */
function candidates(scope: FillScope, opts: FillOptions): Element[] {
  const doc = opts.document ?? document;
  const target = opts.target === undefined ? doc.activeElement : opts.target;
  if (scope === 'field') return target && target !== doc.body ? [target] : [];
  const root = scope === 'form' ? (target?.closest?.('form') ?? doc) : doc;
  return Array.from(root.querySelectorAll(FIELD_SELECTOR));
}

/**
 * Fill a scope of the page with believable data.
 *
 * Every field is overwritten, including ones that already have a value — this is a tool you
 * invoke on purpose, and `restore()` is what makes that safe. That is also why `restore` is
 * returned rather than kept in a module global: the caller owns the undo, so two surfaces (the
 * in-page filler and the app window's demo form) cannot clobber each other's.
 */
export function fillFields(scope: FillScope, opts: FillOptions = {}): FillResult {
  const ctx: FillContext = createFillContext(opts.seed, opts.now);
  const restorers: (() => void)[] = [];
  // Every radio already covered by a group we filled. Keyed by ELEMENT, not by `name`: two
  // forms on one page routinely reuse a name, and a string key would silently skip the second
  // form's group entirely.
  const radiosDone = new Set<Element>();
  const single = scope === 'field';
  let filled = 0;
  let skipped = 0;
  let password: string | null = null;

  for (const el of candidates(scope, opts)) {
    const info = describe(el);
    const kind = detectKind(info);
    // `field` scope is an explicit aim at one element; anything else must be visible to count.
    if (kind === 'skip' || (!single && isHidden(el))) {
      skipped += 1;
      continue;
    }

    const wrote = applyOne(el, kind, info, ctx, restorers, radiosDone, single);
    if (wrote === null) {
      skipped += 1;
      continue;
    }
    filled += 1;
    if (kind === 'password' && password === null) password = wrote;
  }

  return {
    filled,
    skipped,
    password,
    seed: ctx.seed,
    restore: () => {
      // Reverse order, so a radio group's members are restored in the order they were changed.
      for (const undo of [...restorers].reverse()) undo();
      const n = restorers.length;
      restorers.length = 0;
      return n;
    },
  };
}

/**
 * Write one field. Returns the value written (`''` for the non-text kinds), or `null` when
 * nothing was written — a radio group already handled, or a select with no usable option.
 */
function applyOne(
  el: Element,
  kind: FieldKind,
  info: FieldInfo,
  ctx: FillContext,
  restorers: (() => void)[],
  radiosDone: Set<Element>,
  single: boolean,
): string | null {
  const { rng } = ctx;

  if (kind === 'radio') {
    const radio = el as HTMLInputElement;
    if (radiosDone.has(radio)) return null;
    // "Fill this input" aimed at one radio means that radio, not a random sibling.
    const group = single
      ? [radio]
      : Array.from((radio.form ?? el.ownerDocument).querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
          (r) => r.name === radio.name && !r.disabled && !isHidden(r),
        );
    if (!group.length) return null;
    for (const r of group) radiosDone.add(r);
    const previous = group.map((r) => [r, r.checked] as const);
    restorers.push(() => {
      for (const [r, was] of previous) writeChecked(r, was);
    });
    writeChecked(rng.pick(group), true);
    return '';
  }

  if (kind === 'checkbox') {
    const box = el as HTMLInputElement;
    const was = box.checked;
    restorers.push(() => writeChecked(box, was));
    // A required checkbox is a "I accept the terms" box: the form does not submit without it,
    // so leaving it to chance would mean the fill randomly fails to do its job.
    writeChecked(box, info.required ? true : rng.chance(0.7));
    return '';
  }

  if (kind === 'select') {
    const select = el as HTMLSelectElement;
    const options = realOptions(select);
    if (!options.length) return null;
    if (select.multiple) {
      const previous = Array.from(select.options).map((o) => [o, o.selected] as const);
      restorers.push(() => {
        for (const [o, was] of previous) o.selected = was;
        fire(select, 'input');
        fire(select, 'change');
      });
      for (const o of select.options) o.selected = false;
      for (let i = 0; i < Math.min(options.length, rng.int(1, 2)); i += 1) rng.pick(options).selected = true;
      fire(select, 'input');
      fire(select, 'change');
    } else {
      const was = select.value;
      restorers.push(() => writeValue(select, was));
      writeValue(select, rng.pick(options).value);
    }
    return '';
  }

  const value = valueFor(kind, info, ctx);
  if (value === null) return null;

  if (info.editable) {
    const host = el as HTMLElement;
    const was = host.textContent ?? '';
    restorers.push(() => writeEditable(host, was));
    writeEditable(host, value);
    return value;
  }

  const field = el as HTMLInputElement;
  const was = field.value;
  restorers.push(() => writeValue(field, was));
  writeValue(field, value);
  return value;
}
