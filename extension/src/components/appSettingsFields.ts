// The ONE renderer for an app's declarative settings schema.
//
// Two surfaces show an app's settings — Settings > Apps and the settings control in
// the app window's own title bar (views/appSettings.ts) — and they build their controls
// here, from the same merged schema (`appSettings()`), reading through `getAppConfig`
// and writing through `setAppConfig`. Kept in one place on purpose: two hand-rolled
// copies of "render a settings field" is exactly the drift this codebase keeps paying
// for, and a control that exists on only one of the two surfaces is invisible to
// whichever user opened the other one.
//
// Pure DOM builders: no dialog, no layout, no state of their own. The one side effect is the
// download a `affectsDownload` change starts — and saying that it started, which belongs beside
// the line that starts it rather than in whichever surface happens to be rendering the row.

import { el } from '../lib/dom.js';
import { appSettings, getAppConfig, setAppConfig } from '../lib/appConfig.js';
import { ensureModel } from '../lib/installManager.js';
import { appModel } from '../lib/appModels.js';
import { showSnackbar } from './snackbar.js';
import { isInstalled } from '../models/installed.js';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  default: unknown;
  hint?: string;
  /** `select` | `toggle` | `range` | `password` | `text` (the default). */
  type?: string;
  options?: SettingOption[];
  placeholder?: string;
  /** Pre-fetch the app's model when this changes, so use never downloads mid-task. */
  affectsDownload?: boolean;
  /** `range` only. */
  min?: number;
  max?: number;
  step?: number;
  /** `range` only — appended to the read-out, e.g. `×` or `px`. */
  suffix?: string;
}

/** The bits of an app descriptor this module needs. */
export interface SettingsSchemaApp {
  id: string;
  name: string;
  popout?: boolean;
  settings?: SettingField[];
  [key: string]: unknown;
}

/**
 * What to tell the user when a settings change has just started a download.
 *
 * Changing a model, an OCR language or the AI-grammar switch is the one action in Settings that
 * puts hundreds of megabytes on the wire, and it used to do it in silence. The only mention
 * anywhere was a snackbar if you happened to CLOSE Settings afterwards — which says a download
 * "continues" without ever having said one began. So a user who then opened the app and waited
 * behind that download had nothing to connect the wait to (#1306).
 *
 * The size is read from the model registry, which already derives it from the setting just
 * written (`ModelEntry.size` is a getter), rather than being typed out here where it would go
 * stale the first time a model changed.
 */
export function downloadStartedMessage(app: SettingsSchemaApp): string {
  const size = appModel(app.id)?.size;
  return `Downloading ${app.name}'s model${size ? ` (${size})` : ''}. It continues in the background.`;
}

/** A settings row: label + hint on the left, the control on the right. */
export function settingField(label: string, hint: string | undefined, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'field';

  const text = document.createElement('span');
  text.className = 'field-text';
  text.innerHTML =
    `<span class="field-label">${label}</span>` + (hint ? `<span class="field-hint">${hint}</span>` : '');

  row.append(text, control);
  return row;
}

export function selectControl(
  options: SettingOption[],
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'input select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function toggleControl(checked: boolean, onChange: (v: boolean) => void): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'switch-track';
  wrap.append(input, track);
  return wrap;
}

/** A slider with a live read-out. `format` renders the value (units, decimals). */
export function rangeControl(
  value: number,
  { min, max, step, format }: { min: number; max: number; step: number; format: (v: number) => string },
  onChange: (v: number) => void,
): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('span', 'slider-value', format(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  wrap.append(input, out);
  return wrap;
}

/** How a `range` field renders its read-out: one decimal for fractional steps. */
const rangeFormat =
  (field: SettingField) =>
  (v: number): string =>
    `${(field.step ?? 1) < 1 ? v.toFixed(1) : String(v)}${field.suffix ?? ''}`;

const asNumber = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Build the control for one schema field. `onChange` gets the TYPED value —
 *  a boolean for a toggle, a number for a range — not a stringified one. */
function schemaControl(fieldDef: SettingField, value: unknown, onChange: (v: unknown) => void): HTMLElement {
  if (fieldDef.type === 'select') {
    return selectControl(fieldDef.options || [], String(value ?? ''), onChange);
  }
  if (fieldDef.type === 'toggle') {
    return toggleControl(value === true, onChange);
  }
  if (fieldDef.type === 'range') {
    const min = fieldDef.min ?? 0;
    const max = fieldDef.max ?? 1;
    const step = fieldDef.step ?? 1;
    return rangeControl(
      asNumber(value, asNumber(fieldDef.default, min)),
      { min, max, step, format: rangeFormat(fieldDef) },
      onChange,
    );
  }
  const input = document.createElement('input');
  input.type = fieldDef.type === 'password' ? 'password' : 'text';
  input.className = 'input';
  input.value = String(value ?? '');
  input.placeholder = fieldDef.placeholder || '';
  input.autocomplete = 'off';
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

/**
 * Every settings row for one app, in schema order. Empty when the app declares none.
 *
 * The MERGED schema, not `app.settings` — a pop-out app declares no settings of its own
 * (Clipboard, Retouch), so testing the raw array skipped them entirely (#197).
 */
export function appSettingsFields(app: SettingsSchemaApp): HTMLElement[] {
  const cfg = getAppConfig(app);
  return appSettings(app).map((fieldDef) => {
    const onChange = async (v: unknown): Promise<void> => {
      await setAppConfig(app.id, fieldDef.key, v);
      // A setting that changes what the app must download (a bigger model, a new OCR
      // language, enabling AI grammar) pre-fetches now, so using the app never
      // downloads mid-task.
      if (!fieldDef.affectsDownload || !isInstalled(app.id)) return;
      // Only when this change really started one — see `ensureModel`.
      if (ensureModel(app.id)) showSnackbar(downloadStartedMessage(app), { duration: 6000 });
    };
    return settingField(fieldDef.label, fieldDef.hint, schemaControl(fieldDef, cfg[fieldDef.key], onChange));
  });
}

/** The app's settings as one card of rows — what the per-app settings dialog shows. */
export function appSettingsPanel(app: SettingsSchemaApp): HTMLElement {
  const card = el('div', 'settings-card');
  card.append(...appSettingsFields(app));
  return card;
}
