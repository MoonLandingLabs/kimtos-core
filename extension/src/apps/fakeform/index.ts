// FakeForm — fill any form with believable fake data, in one keypress.
//
// The app window is not where the work happens: the filling happens on the page you are
// testing, through `content/fakeform.ts` (the badge) and `content/fakeformFill.ts` (the filler,
// injected on demand). This window is the place to turn that on, to see what the generator
// produces, and to find the shortcuts.
//
// The demo form below runs the SAME `fillFields` the page filler runs. That is deliberate: it
// is the app's own smoke test, so a generator that has quietly stopped producing a usable
// e-mail is visible here rather than only on somebody else's signup page.

import './fakeform.css';
import { el } from '../../lib/dom.js';
import { hasAllSites, requestAllSites } from '../../lib/hostPermission.js';
import { detectKind, emptyFieldInfo, type FieldKind } from '../../lib/fakeform/detect.js';
import { fillFields, type FillResult } from '../../lib/fakeform/fill.js';
import { createFillContext, valueFor } from '../../lib/fakeform/values.js';
import { person as makePerson, createRng, randomSeed } from '../../lib/fakeData.js';
import appMeta from './meta.js';

interface ToolResult {
  ok: boolean;
  result: string;
  summary: string;
}

const ok = (result: string, summary: string): ToolResult => ({ ok: true, result, summary });
const fail = (result: string): ToolResult => ({ ok: false, result, summary: 'failed' });

/** Every kind the generator can produce a value for — the vocabulary the agent tools speak. */
const VALUE_KINDS: FieldKind[] = [
  'email',
  'password',
  'tel',
  'url',
  'first-name',
  'last-name',
  'full-name',
  'username',
  'organization',
  'job-title',
  'street-address',
  'address-line2',
  'city',
  'region',
  'postal-code',
  'country',
  'date',
  'birth-date',
  'time',
  'month',
  'week',
  'datetime',
  'number',
  'age',
  'currency',
  'color',
  'credit-card',
  'card-cvc',
  'card-expiry',
  'uuid',
  'ip-address',
  'paragraph',
  'text',
];

const str = (args: Record<string, unknown>, key: string): string => String(args[key] ?? '').trim();

// ── the demo form ─────────────────────────────────────────────────────────────────────────

interface DemoField {
  label: string;
  tag: 'input' | 'textarea' | 'select';
  attrs?: Record<string, string>;
  options?: string[];
}

/** A cross-section of what a real signup/checkout form asks for, so the demo is representative. */
const DEMO_FIELDS: DemoField[] = [
  { label: 'Full name', tag: 'input', attrs: { name: 'full_name', autocomplete: 'name' } },
  { label: 'Email', tag: 'input', attrs: { name: 'email', type: 'email' } },
  { label: 'Password', tag: 'input', attrs: { name: 'password', type: 'password' } },
  { label: 'Phone', tag: 'input', attrs: { name: 'phone', type: 'tel' } },
  { label: 'Company', tag: 'input', attrs: { name: 'company' } },
  { label: 'Street address', tag: 'input', attrs: { name: 'address_line_1' } },
  { label: 'City', tag: 'input', attrs: { name: 'city' } },
  { label: 'Postcode', tag: 'input', attrs: { name: 'zip_code' } },
  { label: 'Date of birth', tag: 'input', attrs: { name: 'dob', type: 'date' } },
  { label: 'Website', tag: 'input', attrs: { name: 'website', type: 'url' } },
  { label: 'Card number', tag: 'input', attrs: { name: 'cc_number', maxlength: '16' } },
  { label: 'Seats', tag: 'input', attrs: { name: 'quantity', type: 'number', min: '1', max: '9' } },
  { label: 'Plan', tag: 'select', options: ['Choose a plan', 'Starter', 'Team', 'Enterprise'] },
  { label: 'Tell us about your project', tag: 'textarea', attrs: { name: 'message' } },
];

function buildDemoForm(doc: Document): HTMLFormElement {
  const form = doc.createElement('form');
  form.className = 'ff-demo';
  form.addEventListener('submit', (e) => e.preventDefault());

  for (const spec of DEMO_FIELDS) {
    const row = el('label', 'ff-row');
    row.append(el('span', 'ff-label', spec.label));
    const field = doc.createElement(spec.tag);
    field.className = 'ff-field';
    for (const [key, value] of Object.entries(spec.attrs ?? {})) field.setAttribute(key, value);
    if (spec.tag === 'select') {
      for (const text of spec.options ?? []) {
        const option = doc.createElement('option');
        option.textContent = text;
        // The first entry is the "nothing chosen" placeholder every real select has — it must
        // keep an empty value so the filler has something to correctly refuse to pick.
        option.value = text === spec.options?.[0] ? '' : text;
        field.append(option);
      }
    }
    row.append(field);
    form.append(row);
  }

  const consent = el('label', 'ff-row ff-row-check');
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.name = 'accept_terms';
  box.required = true;
  consent.append(box, el('span', 'ff-label', 'I accept the terms'));
  form.append(consent);

  return form;
}

// ── the descriptor ────────────────────────────────────────────────────────────────────────

const app = {
  id: appMeta.id,
  name: appMeta.name,
  accent: appMeta.accent,
  order: appMeta.order,
  description:
    'Fill every field on a page with believable fake data in one keypress, then undo it — so you can test a form without typing “test test test” forty times. The data is invented on your device; nothing is ever fetched.',
  tip: 'Turn on “Fill forms on websites” below, then press the shortcut on any page — or use the badge that appears when you click into a field. Undo puts every field back exactly as it was.',

  // Convention 5: declared, and DORMANT. No shipped on-device model can drive these, and no
  // user-facing copy says otherwise. They expose the generator, which is the part of this app
  // that works without a page in front of it.
  tools: [
    {
      name: 'list_field_types',
      description: 'List every kind of fake value FakeForm can generate.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: (): ToolResult => ok(VALUE_KINDS.join(', '), `${VALUE_KINDS.length} types`),
    },
    {
      name: 'generate_value',
      description:
        'Generate one fake value of a given type (email, full-name, street-address, credit-card, …). Use list_field_types for the vocabulary.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'One of the types from list_field_types.' },
          seed: { type: 'number', description: 'Optional seed, so the same call returns the same value.' },
        },
        required: ['type'],
      },
      run: (args: Record<string, unknown>): ToolResult => {
        const kind = str(args, 'type').toLowerCase() as FieldKind;
        if (!VALUE_KINDS.includes(kind)) return fail(`Unknown type "${kind}". Use list_field_types for the list.`);
        const seed = Number(args.seed);
        const ctx = createFillContext(Number.isFinite(seed) ? seed : undefined);
        const value = valueFor(kind, emptyFieldInfo(), ctx);
        return value === null ? fail(`"${kind}" takes its value from the page, not the generator.`) : ok(value, kind);
      },
    },
    {
      name: 'generate_person',
      description: 'Generate one coherent fake person — name, username, email, phone, employer and date of birth.',
      parameters: {
        type: 'object',
        properties: { seed: { type: 'number', description: 'Optional seed for a reproducible person.' } },
        required: [],
      },
      run: (args: Record<string, unknown>): ToolResult => {
        const seed = Number(args.seed);
        const p = makePerson(createRng(Number.isFinite(seed) ? seed : randomSeed()));
        return ok(
          [
            `name: ${p.full}`,
            `username: ${p.username}`,
            `email: ${p.email}`,
            `phone: ${p.phone}`,
            `job: ${p.jobTitle} at ${p.organization}`,
            `born: ${p.birthDate}`,
          ].join('\n'),
          p.full,
        );
      },
    },
    {
      name: 'detect_field_type',
      description:
        'Work out what kind of value a form field is asking for, from the words used to describe it — its name, id, placeholder or label.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          id: { type: 'string' },
          label: { type: 'string' },
          placeholder: { type: 'string' },
          type: { type: 'string', description: 'The input type attribute, e.g. email or tel.' },
        },
        required: [],
      },
      run: (args: Record<string, unknown>): ToolResult => {
        const info = emptyFieldInfo({
          name: str(args, 'name'),
          id: str(args, 'id'),
          label: str(args, 'label'),
          placeholder: str(args, 'placeholder'),
          type: str(args, 'type').toLowerCase() || 'text',
        });
        if (!info.name && !info.id && !info.label && !info.placeholder && info.type === 'text') {
          return fail('Describe the field first — give at least a name, id, label or placeholder.');
        }
        const kind = detectKind(info);
        return ok(kind, kind);
      },
    },
  ],

  render(body: HTMLElement): () => void {
    const doc = body.ownerDocument;
    const root = el('div', 'app-flow fakeform');
    body.replaceChildren(root);

    // --- turn it on ---------------------------------------------------------------------
    const enablePanel = el('section', 'ff-panel');
    const enableTitle = el('h3', 'ff-panel-title', 'Fill forms on websites');
    const enableNote = el(
      'p',
      'ff-panel-note',
      'FakeForm needs permission to run on the sites you test. Nothing is sent anywhere — the data is invented in your browser.',
    );
    const enableState = el('p', 'ff-state', 'Checking…');
    const enableBtn = el('button', 'button-primary', 'Allow on all sites');
    enableBtn.type = 'button';
    enableBtn.hidden = true;
    enablePanel.append(enableTitle, enableNote, enableState, enableBtn);

    let disposed = false;
    const paintPermission = (granted: boolean): void => {
      if (disposed) return;
      enableState.textContent = granted
        ? 'On. Press the shortcut on any page, or use the badge that appears when you click into a field.'
        : 'Off. FakeForm cannot reach the pages you are testing yet.';
      enableState.classList.toggle('is-on', granted);
      enableBtn.hidden = granted;
    };
    void hasAllSites().then(paintPermission);
    enableBtn.addEventListener('click', () => {
      // Must run inside the click: Chrome refuses a permission request that has awaited anything.
      void requestAllSites().then(paintPermission);
    });

    // --- shortcuts ----------------------------------------------------------------------
    const shortcuts = el('section', 'ff-panel');
    shortcuts.append(el('h3', 'ff-panel-title', 'Shortcuts'));
    const list = el('ul', 'ff-shortcuts');
    for (const [action, note] of [
      ['Fill this form', 'The form around whatever you last clicked into'],
      ['Fill this input', 'Only the field you are in'],
      ['Fill everything', 'Every field on the page, across forms'],
      ['Undo the last fill', 'Puts every field back as it was'],
    ] as const) {
      const item = el('li');
      item.append(el('strong', '', action), el('span', 'ff-hint', note));
      list.append(item);
    }
    const bindNote = el(
      'p',
      'ff-panel-note',
      'Assign or change the keys at chrome://extensions/shortcuts. Every action is also on the right-click menu, and on the badge that appears in a focused field.',
    );
    shortcuts.append(list, bindNote);

    // --- the demo form ------------------------------------------------------------------
    const demoPanel = el('section', 'ff-panel');
    demoPanel.append(
      el('h3', 'ff-panel-title', 'Try it'),
      el('p', 'ff-panel-note', 'The same generator that runs on a real page. Nothing here is saved.'),
    );
    const form = buildDemoForm(doc);
    const actions = el('div', 'app-actions');
    const fillBtn = el('button', 'button-primary', 'Fill this form');
    fillBtn.type = 'button';
    const undoBtn = el('button', 'button-secondary', 'Undo');
    undoBtn.type = 'button';
    undoBtn.disabled = true;
    const status = el('p', 'ff-state');
    actions.append(fillBtn, undoBtn);
    demoPanel.append(actions, status, form);

    let last: FillResult | null = null;
    fillBtn.addEventListener('click', () => {
      last = fillFields('form', { target: form.querySelector('.ff-field'), document: doc });
      undoBtn.disabled = last.filled === 0;
      status.textContent = last.filled
        ? `Filled ${last.filled} field${last.filled === 1 ? '' : 's'}${last.password ? ` · password ${last.password}` : ''} · seed ${last.seed}`
        : 'Nothing to fill.';
    });
    undoBtn.addEventListener('click', () => {
      const restored = last?.restore() ?? 0;
      last = null;
      undoBtn.disabled = true;
      status.textContent = restored ? `Restored ${restored} field${restored === 1 ? '' : 's'}.` : 'Nothing to undo.';
    });

    root.append(enablePanel, shortcuts, demoPanel);

    return () => {
      disposed = true;
    };
  },
};

export default app;
