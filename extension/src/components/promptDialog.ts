// Reusable input dialog. Two entry points over ONE implementation:
//
//   promptDialog() — a single line, resolving to the trimmed string (naming/renaming).
//   promptFields() — several values at once, resolving to a { key: value } record.
//
// Both resolve null on Cancel / Esc / backdrop click.
//
// Cross-field behaviour (e.g. "keep the aspect ratio") belongs to the CALLER, via
// `onInput` — the dialog owns the markup, focus and keyboard, and stays ignorant of
// what the fields mean.
//
// `owner` matters more than it looks: an app that is popped out into a floating
// window lives in ANOTHER document, so mounting on this module's `document.body`
// would put the dialog on the new-tab page, behind the window the user is looking at.
// Pass the app's root element and the dialog follows it. See #85.

import { el, overlayHost } from '../lib/dom.js';

export interface PromptDialogOptions {
  title?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  owner?: Element | null;
}

export interface PromptField {
  key: string;
  label: string;
  value?: string;
  placeholder?: string;
  type?: 'text' | 'number';
  min?: number;
}

export interface PromptFieldsOptions {
  title?: string;
  fields: PromptField[];
  /** A line of context under the inputs, e.g. the current size. */
  note?: string;
  /** An optional checkbox; its state comes back as 'on' / 'off'. */
  toggle?: { key: string; label: string; checked?: boolean };
  confirmLabel?: string;
  owner?: Element | null;
  /** Called when a field changes, so the caller can derive the others. */
  onInput?: (key: string, values: Record<string, string>, set: (key: string, value: string) => void) => void;
}

export function promptFields({
  title = '',
  fields,
  note = '',
  toggle,
  confirmLabel = 'Save',
  owner,
  onInput,
}: PromptFieldsOptions): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const host = overlayHost(owner);
    // The app's document, not necessarily this module's — see the note above.
    const doc = host.ownerDocument;

    const overlay = el('div', 'prompt-overlay');
    const card = el('div', 'prompt-card');
    if (title) card.append(el('h2', 'prompt-title', title));

    const inputs = new Map<string, HTMLInputElement>();
    const grid = el('div', 'prompt-fields');
    for (const f of fields) {
      const wrap = el('label', 'prompt-field');
      if (f.label) wrap.append(el('span', 'prompt-field-label', f.label));
      const input = el('input', 'prompt-input') as HTMLInputElement;
      input.type = f.type ?? 'text';
      input.value = f.value ?? '';
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.min !== undefined) input.min = String(f.min);
      wrap.append(input);
      grid.append(wrap);
      inputs.set(f.key, input);
    }
    card.append(grid);

    let toggleBox: HTMLInputElement | null = null;
    if (toggle) {
      const wrap = el('label', 'prompt-toggle');
      toggleBox = el('input') as HTMLInputElement;
      toggleBox.type = 'checkbox';
      toggleBox.checked = toggle.checked ?? false;
      wrap.append(toggleBox, el('span', '', toggle.label));
      card.append(wrap);
    }

    const noteEl = note ? el('p', 'prompt-note', note) : null;
    if (noteEl) card.append(noteEl);

    const values = (): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [key, input] of inputs) out[key] = input.value.trim();
      if (toggle && toggleBox) out[toggle.key] = toggleBox.checked ? 'on' : 'off';
      return out;
    };
    const set = (key: string, value: string): void => {
      const input = inputs.get(key);
      if (input) input.value = value;
    };

    const actions = el('div', 'prompt-actions');
    const cancel = el('button', 'button-secondary', 'Cancel');
    const ok = el('button', 'button-primary', confirmLabel);
    actions.append(cancel, ok);
    card.append(actions);
    overlay.append(card);
    host.append(overlay);

    const close = (val: Record<string, string> | null): void => {
      doc.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };

    for (const [key, input] of inputs) {
      input.addEventListener('input', () => onInput?.(key, values(), set));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          close(values());
        }
      });
    }
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(values()));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    doc.addEventListener('keydown', onKey, true);

    const first = inputs.values().next().value;
    requestAnimationFrame(() => {
      first?.focus();
      first?.select();
    });
  });
}

/** A single line of input — resolves the trimmed string, or null if dismissed. */
export function promptDialog({
  title = '',
  label = '',
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  owner,
}: PromptDialogOptions = {}): Promise<string | null> {
  return promptFields({
    title,
    fields: [{ key: 'value', label, value, placeholder }],
    confirmLabel,
    owner,
  }).then((res) => res?.value ?? null);
}
