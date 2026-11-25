// DevTools — the everyday encode/decode/format/generate utilities, all
// on-device. The privacy angle is the point: decode a JWT, hash a secret, or
// pretty-print internal JSON without pasting it into some random website. Pure
// browser APIs, no network, nothing stored. A left rail lists the tools; each
// renders into the panel on the right. The transforms live in ./lib.ts and are
// shared with the agent tools below.

import './devtools.css';
import { el } from '../../lib/dom.js';
import { COPY, CHECK } from '../../components/icons.js';
import { dataStore } from '../../lib/dataStore.js';
import { fuzzyBest } from '../../lib/fuzzy.js';
import * as T from './lib.js';
import appMeta from './meta.js';

const ACCENT = appMeta.accent;

// Prefixed with the app id, per the storage convention — so AnubisDB attributes it
// to DevTools rather than filing it under "Unmapped data".
const LAST_TOOL_KEY = 'devtools:lastTool';

// ---- small shared UI bits -------------------------------------------------
function copyButton(getText: () => string): HTMLButtonElement {
  const btn = el('button', 'dk-copy');
  btn.type = 'button';
  btn.title = 'Copy to clipboard';
  btn.innerHTML = `${COPY}`;
  btn.addEventListener('click', async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    btn.innerHTML = `${CHECK}`;
    btn.classList.add('is-done');
    setTimeout(() => {
      btn.innerHTML = `${COPY}`;
      btn.classList.remove('is-done');
    }, 1100);
  });
  return btn;
}

function textArea(placeholder: string, readOnly = false): HTMLTextAreaElement {
  const ta = el('textarea', 'dk-textarea');
  ta.placeholder = placeholder;
  ta.spellcheck = false;
  ta.readOnly = readOnly;
  return ta;
}
function field(label: string, control: HTMLElement, extra?: HTMLElement): HTMLElement {
  const head = el('div', 'dk-fieldhead');
  head.append(el('span', 'dk-label', label));
  if (extra) head.append(extra);
  const f = el('div', 'dk-field');
  f.append(head, control);
  return f;
}
function intro(text: string): HTMLElement {
  return el('p', 'dk-intro', text);
}
function row(label: string, value: string): HTMLElement {
  const r = el('div', 'dk-row');
  r.append(el('span', 'dk-row-label', label));
  const val = el('input', 'dk-row-value');
  val.type = 'text';
  val.readOnly = true;
  val.value = value;
  r.append(
    val,
    copyButton(() => val.value),
  );
  return r;
}

// Input → Output panel with one or more transform buttons.
interface IoButton {
  label: string;
  run: (input: string) => string | Promise<string>;
}
function ioTool(host: HTMLElement, cfg: { blurb: string; placeholder: string; buttons: IoButton[] }): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro(cfg.blurb));
  const input = textArea(cfg.placeholder);
  const output = textArea('Result appears here…', true);
  const actions = el('div', 'dk-actions');
  for (const b of cfg.buttons) {
    const btn = el('button', 'dk-btn');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.addEventListener('click', async () => {
      try {
        output.classList.remove('is-error');
        output.value = String(await b.run(input.value));
      } catch (e) {
        output.classList.add('is-error');
        output.value = (e as Error).message || 'Something went wrong.';
      }
    });
    actions.append(btn);
  }
  const grid = el('div', 'dk-grid');
  grid.append(
    field('Input', input),
    field(
      'Output',
      output,
      copyButton(() => output.value),
    ),
  );
  wrap.append(actions, grid);
  host.replaceChildren(wrap);
  requestAnimationFrame(() => input.focus());
}

// ---- custom tools ---------------------------------------------------------
function hashTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('SHA hashes of your text, computed locally with the Web Crypto API.'));
  const input = textArea('Text to hash…');
  const out = el('div', 'dk-rows');
  const algos: T.HashAlgo[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
  let token = 0;
  const compute = async () => {
    const mine = ++token;
    if (!input.value) {
      out.replaceChildren();
      return;
    }
    const results = await Promise.all(algos.map((a) => T.hashText(input.value, a)));
    if (mine !== token) return;
    out.replaceChildren(...algos.map((a, i) => row(a, results[i] ?? '')));
  };
  input.addEventListener('input', () => void compute());
  wrap.append(field('Input', input), out);
  host.replaceChildren(wrap);
  requestAnimationFrame(() => input.focus());
}

function uuidTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Generate random RFC-4122 v4 UUIDs.'));
  const count = el('input', 'dk-num');
  count.type = 'number';
  count.min = '1';
  count.max = '100';
  count.value = '5';
  const out = textArea('', true);
  const gen = () => {
    const n = Math.min(100, Math.max(1, Number(count.value) || 1));
    out.value = Array.from({ length: n }, () => T.uuidV4()).join('\n');
  };
  const btn = el('button', 'dk-btn');
  btn.type = 'button';
  btn.textContent = 'Generate';
  btn.addEventListener('click', gen);
  const actions = el('div', 'dk-actions');
  actions.append(
    btn,
    field('Count', count),
    copyButton(() => out.value),
  );
  wrap.append(actions, field('UUIDs', out));
  host.replaceChildren(wrap);
  gen();
}

const CASES: { kind: T.CaseKind; label: string }[] = [
  { kind: 'camel', label: 'camelCase' },
  { kind: 'pascal', label: 'PascalCase' },
  { kind: 'snake', label: 'snake_case' },
  { kind: 'kebab', label: 'kebab-case' },
  { kind: 'constant', label: 'CONSTANT_CASE' },
  { kind: 'title', label: 'Title Case' },
  { kind: 'sentence', label: 'Sentence case' },
  { kind: 'dot', label: 'dot.case' },
];
function caseTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Convert an identifier or phrase between naming conventions.'));
  const input = textArea('helloWorld example, or "my variable name"…');
  const out = el('div', 'dk-rows');
  const update = () => out.replaceChildren(...CASES.map((c) => row(c.label, T.toCase(input.value, c.kind))));
  input.addEventListener('input', update);
  wrap.append(field('Input', input), out);
  host.replaceChildren(wrap);
  update();
  requestAnimationFrame(() => input.focus());
}

function colorTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Convert a color between HEX, RGB, and HSL.'));
  const input = el('input', 'dk-text');
  input.type = 'text';
  input.placeholder = '#8b5cf6, rgb(139, 92, 246), or hsl(258, 90%, 66%)';
  input.value = ACCENT;
  const picker = el('input', 'dk-swatch');
  picker.type = 'color';
  picker.value = ACCENT;
  const out = el('div', 'dk-rows');
  const update = (color: T.Color) => {
    out.replaceChildren(row('HEX', color.hex), row('RGB', color.rgb), row('HSL', color.hsl));
    picker.value = color.hex;
  };
  const fromText = () => {
    try {
      input.classList.remove('is-error');
      update(T.parseColor(input.value));
    } catch {
      input.classList.add('is-error');
      out.replaceChildren();
    }
  };
  input.addEventListener('input', fromText);
  picker.addEventListener('input', () => {
    input.value = picker.value;
    fromText();
  });
  const head = el('div', 'dk-color-head');
  head.append(picker, input);
  wrap.append(field('Color', head), out);
  host.replaceChildren(wrap);
  fromText();
}

function timeTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Convert between Unix timestamps and human dates (seconds or milliseconds).'));

  const tsIn = el('input', 'dk-text');
  tsIn.type = 'text';
  tsIn.placeholder = 'e.g. 1751846400';
  const tsOut = textArea('', true);
  tsOut.classList.add('dk-mono');
  const nowBtn = el('button', 'dk-btn dk-btn-sm');
  nowBtn.type = 'button';
  nowBtn.textContent = 'Now';
  const runTs = () => {
    try {
      tsOut.classList.remove('is-error');
      tsOut.value = tsIn.value.trim() ? T.epochToDate(tsIn.value) : '';
    } catch (e) {
      tsOut.classList.add('is-error');
      tsOut.value = (e as Error).message;
    }
  };
  nowBtn.addEventListener('click', () => {
    tsIn.value = String(Math.floor(Date.now() / 1000));
    runTs();
  });
  tsIn.addEventListener('input', runTs);

  const dIn = el('input', 'dk-text');
  dIn.type = 'text';
  dIn.placeholder = 'e.g. 2026-07-07 or an ISO string';
  const dOut = textArea('', true);
  dOut.classList.add('dk-mono');
  const runDate = () => {
    try {
      dOut.classList.remove('is-error');
      dOut.value = dIn.value.trim() ? T.dateToEpoch(dIn.value) : '';
    } catch (e) {
      dOut.classList.add('is-error');
      dOut.value = (e as Error).message;
    }
  };
  dIn.addEventListener('input', runDate);

  const grid = el('div', 'dk-grid');
  const tsHead = el('div', 'dk-color-head');
  tsHead.append(tsIn, nowBtn);
  grid.append(
    field(
      'Timestamp → date',
      tsHead,
      copyButton(() => tsOut.value),
    ),
    field(
      'Date → timestamp',
      dIn,
      copyButton(() => dOut.value),
    ),
  );
  const grid2 = el('div', 'dk-grid');
  grid2.append(tsOut, dOut);
  wrap.append(grid, grid2);
  host.replaceChildren(wrap);
  requestAnimationFrame(() => tsIn.focus());
}

function baseTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Convert an integer between decimal, hexadecimal, binary, and octal.'));
  const defs: { key: keyof T.Bases; label: string; base: 2 | 8 | 10 | 16 }[] = [
    { key: 'dec', label: 'Decimal', base: 10 },
    { key: 'hex', label: 'Hex', base: 16 },
    { key: 'bin', label: 'Binary', base: 2 },
    { key: 'oct', label: 'Octal', base: 8 },
  ];
  // Only characters valid for each base may be typed — anything else is dropped.
  const disallowed: Record<2 | 8 | 10 | 16, RegExp> = {
    10: /[^0-9]/g,
    16: /[^0-9a-fA-F]/g,
    2: /[^01]/g,
    8: /[^0-7]/g,
  };
  const inputs = new Map<keyof T.Bases, HTMLInputElement>();
  const rows = el('div', 'dk-rows');
  for (const d of defs) {
    const inp = el('input', 'dk-row-value');
    inp.type = 'text';
    inp.spellcheck = false;
    inp.autocomplete = 'off';
    inp.inputMode = d.base === 10 || d.base === 2 || d.base === 8 ? 'numeric' : 'text';
    inputs.set(d.key, inp);
    inp.addEventListener('input', () => {
      // Reject invalid characters, keeping the caret at the right spot.
      const cleaned = inp.value.replace(disallowed[d.base], '');
      if (cleaned !== inp.value) {
        const caret = inp.value.slice(0, inp.selectionStart ?? inp.value.length).replace(disallowed[d.base], '').length;
        inp.value = cleaned;
        inp.setSelectionRange(caret, caret);
      }
      for (const other of defs) {
        if (other.key === d.key) continue;
        const target = inputs.get(other.key) as HTMLInputElement;
        try {
          target.value = cleaned ? T.convertBase(cleaned, d.base)[other.key] : '';
        } catch {
          target.value = '';
        }
      }
    });
    const r = el('div', 'dk-row');
    r.append(
      el('span', 'dk-row-label', d.label),
      inp,
      copyButton(() => inp.value),
    );
    rows.append(r);
  }
  wrap.append(rows);
  host.replaceChildren(wrap);
  const dec = inputs.get('dec') as HTMLInputElement;
  dec.value = '255';
  dec.dispatchEvent(new Event('input'));
  requestAnimationFrame(() => dec.focus());
}

function regexTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Test a regular expression against sample text — matches are highlighted.'));
  const pat = el('input', 'dk-text dk-mono');
  pat.type = 'text';
  pat.placeholder = 'pattern, e.g. \\b\\w+@\\w+\\.\\w+\\b';
  const flags = el('input', 'dk-flags dk-mono');
  flags.type = 'text';
  flags.placeholder = 'flags';
  flags.value = 'g';
  const sample = textArea('Text to match against…');
  const preview = el('div', 'dk-preview');
  const status = el('div', 'dk-status');
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  const update = () => {
    if (!pat.value) {
      preview.textContent = sample.value;
      status.textContent = '';
      status.classList.remove('is-error');
      return;
    }
    let re: RegExp;
    try {
      re = new RegExp(pat.value, flags.value.includes('g') ? flags.value : flags.value + 'g');
      status.classList.remove('is-error');
    } catch (e) {
      status.classList.add('is-error');
      status.textContent = (e as Error).message;
      return;
    }
    const text = sample.value;
    let html = '';
    let last = 0;
    let count = 0;
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      html += esc(text.slice(last, i)) + `<mark class="dk-hl">${esc(m[0])}</mark>`;
      last = i + m[0].length;
      count += 1;
      if (m[0] === '') re.lastIndex += 1; // avoid zero-width infinite loop
    }
    html += esc(text.slice(last));
    preview.innerHTML = html || '<span class="dk-muted">(no text)</span>';
    status.textContent = `${count} match${count === 1 ? '' : 'es'}`;
  };
  [pat, flags].forEach((e) => e.addEventListener('input', update));
  sample.addEventListener('input', update);
  const head = el('div', 'dk-regex-head');
  head.append(pat, flags);
  wrap.append(field('Expression', head), field('Test text', sample), field('Matches', preview, status));
  host.replaceChildren(wrap);
  sample.value = 'Contact us at hello@example.test or support@example.com.';
  update();
  requestAnimationFrame(() => pat.focus());
}

function diffTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Compare two blocks of text line by line.'));
  const a = textArea('Original…');
  const b = textArea('Changed…');
  const out = el('div', 'dk-diff');
  const update = () => {
    const A = a.value.split('\n');
    const B = b.value.split('\n');
    // Longest common subsequence over lines, then walk to a diff.
    const n = A.length,
      m = B.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    const lines: { sign: string; text: string }[] = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        lines.push({ sign: ' ', text: A[i]! });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        lines.push({ sign: '-', text: A[i]! });
        i++;
      } else {
        lines.push({ sign: '+', text: B[j]! });
        j++;
      }
    }
    while (i < n) lines.push({ sign: '-', text: A[i++]! });
    while (j < m) lines.push({ sign: '+', text: B[j++]! });
    out.replaceChildren(
      ...lines.map((l) => {
        const div = el('div', `dk-diff-line ${l.sign === '+' ? 'is-add' : l.sign === '-' ? 'is-del' : ''}`);
        div.textContent = `${l.sign} ${l.text}`;
        return div;
      }),
    );
  };
  [a, b].forEach((e) => e.addEventListener('input', update));
  const grid = el('div', 'dk-grid');
  grid.append(field('Original', a), field('Changed', b));
  wrap.append(grid, field('Diff', out));
  host.replaceChildren(wrap);
  update();
}

function loremTool(host: HTMLElement): void {
  const wrap = el('div', 'dk-tool');
  wrap.append(intro('Generate placeholder paragraphs.'));
  const count = el('input', 'dk-num');
  count.type = 'number';
  count.min = '1';
  count.max = '20';
  count.value = '3';
  const out = textArea('', true);
  const gen = () => {
    out.value = T.lorem(Number(count.value) || 1);
  };
  const btn = el('button', 'dk-btn');
  btn.type = 'button';
  btn.textContent = 'Generate';
  btn.addEventListener('click', gen);
  const actions = el('div', 'dk-actions');
  actions.append(
    btn,
    field('Paragraphs', count),
    copyButton(() => out.value),
  );
  wrap.append(actions, field('Text', out));
  host.replaceChildren(wrap);
  gen();
}

// ---- tool registry --------------------------------------------------------
interface Tool {
  id: string;
  name: string;
  cat: string;
  /** Words a user might reach for that are NOT in the name. Searching only names is
   *  too thin: "guid" would never find UUID, "epoch" never find Timestamp, "hex"
   *  never find Color. The search is only as good as this list — keep it fed. */
  keywords?: string[];
  render: (host: HTMLElement) => void;
}
const TOOLS: Tool[] = [
  {
    id: 'json',
    keywords: ['pretty', 'prettify', 'minify', 'format', 'validate', 'parse'],
    name: 'JSON',
    cat: 'Format',
    render: (h) =>
      ioTool(h, {
        blurb: 'Pretty-print, minify, or validate JSON.',
        placeholder: '{"hello":"world","nested":[1,2,3]}',
        buttons: [
          { label: 'Format', run: (s) => T.formatJson(s) },
          { label: 'Minify', run: (s) => T.minifyJson(s) },
        ],
      }),
  },
  {
    id: 'base64',
    keywords: ['b64', 'atob', 'btoa', 'encode', 'decode'],
    name: 'Base64',
    cat: 'Encode / Decode',
    render: (h) =>
      ioTool(h, {
        blurb: 'Encode text to Base64 or decode it back (Unicode-safe).',
        placeholder: 'Text or Base64…',
        buttons: [
          { label: 'Encode', run: (s) => T.encodeBase64(s) },
          { label: 'Decode', run: (s) => T.decodeBase64(s) },
        ],
      }),
  },
  {
    id: 'url',
    keywords: ['uri', 'percent', 'escape', 'query', 'encode', 'decode'],
    name: 'URL',
    cat: 'Encode / Decode',
    render: (h) =>
      ioTool(h, {
        blurb:
          '“Encode URL” keeps a full link’s structure (: / ? & = #) and only escapes spaces and unicode. “Encode component” escapes everything — for a single query value.',
        placeholder: 'https://json.org/example.html?q=search about me',
        buttons: [
          { label: 'Encode URL', run: (s) => T.encodeUri(s) },
          { label: 'Encode component', run: (s) => T.encodeUrl(s) },
          { label: 'Decode', run: (s) => T.decodeUrl(s) },
        ],
      }),
  },
  {
    id: 'html',
    keywords: ['escape', 'unescape', 'entity', 'entities', 'xss', 'amp'],
    name: 'HTML entities',
    cat: 'Encode / Decode',
    render: (h) =>
      ioTool(h, {
        blurb: 'Escape text for HTML, or unescape entities back to characters.',
        placeholder: '<div class="x">a & b</div>',
        buttons: [
          { label: 'Encode', run: (s) => T.encodeHtml(s) },
          { label: 'Decode', run: (s) => T.decodeHtml(s) },
        ],
      }),
  },
  {
    id: 'jwt',
    keywords: ['token', 'bearer', 'claims', 'auth', 'decode'],
    name: 'JWT decoder',
    cat: 'Encode / Decode',
    render: (h) =>
      ioTool(h, {
        blurb: 'Decode a JSON Web Token’s header and payload (no signature check).',
        placeholder: 'eyJhbGciOi…',
        buttons: [{ label: 'Decode', run: (s) => T.decodeJwt(s) }],
      }),
  },
  {
    id: 'hash',
    name: 'Hash (SHA)',
    cat: 'Generate',
    keywords: ['sha1', 'sha256', 'sha512', 'digest', 'checksum', 'md5'],
    render: hashTool,
  },
  { id: 'uuid', name: 'UUID', cat: 'Generate', keywords: ['guid', 'id', 'random'], render: uuidTool },
  {
    id: 'lorem',
    name: 'Lorem ipsum',
    cat: 'Generate',
    keywords: ['placeholder', 'dummy', 'filler', 'text'],
    render: loremTool,
  },
  {
    id: 'case',
    name: 'Case convert',
    cat: 'Convert',
    keywords: ['camel', 'snake', 'kebab', 'pascal', 'slug', 'upper', 'lower', 'title'],
    render: caseTool,
  },
  {
    id: 'color',
    name: 'Color',
    cat: 'Convert',
    keywords: ['colour', 'hex', 'rgb', 'hsl', 'palette'],
    render: colorTool,
  },
  {
    id: 'time',
    name: 'Timestamp',
    cat: 'Convert',
    keywords: ['epoch', 'unix', 'date', 'time', 'iso', 'utc'],
    render: timeTool,
  },
  {
    id: 'base',
    name: 'Number base',
    cat: 'Convert',
    keywords: ['binary', 'hex', 'hexadecimal', 'octal', 'decimal', 'radix'],
    render: baseTool,
  },
  {
    id: 'regex',
    name: 'Regex tester',
    cat: 'Inspect',
    keywords: ['regexp', 'pattern', 'match', 'test'],
    render: regexTool,
  },
  {
    id: 'diff',
    name: 'Text diff',
    cat: 'Inspect',
    keywords: ['compare', 'difference', 'changes'],
    render: diffTool,
  },
];

// ---- agent tools (pure transforms → strings for the model) ---------------
const ok = (result: string, summary: string) => ({ ok: true as const, result, summary });
const fail = (result: string) => ({ ok: false as const, result, summary: 'error' });
function guard(fn: () => string): { ok: boolean; result: string; summary: string } {
  try {
    return ok(fn(), 'done');
  } catch (e) {
    return fail((e as Error).message);
  }
}
const str = (a: Record<string, unknown>, k: string) => String(a[k] ?? '');

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'On-device dev utilities: JSON, JWT, Base64, hashes, UUID, regex, color and more',
  tip: 'Every tool runs entirely on your device — decode a JWT, hash a secret, or pretty-print JSON without pasting sensitive data into a website. Pick a tool from the left.',
  accent: ACCENT,
  order: appMeta.order,

  tools: [
    {
      name: 'format_json',
      description: 'Pretty-print (validate) a JSON string.',
      parameters: { type: 'object', properties: { json: { type: 'string' } }, required: ['json'] },
      run: (a: Record<string, unknown>) => guard(() => T.formatJson(str(a, 'json'))),
    },
    {
      name: 'decode_jwt',
      description: 'Decode a JSON Web Token’s header and payload (no signature verification).',
      parameters: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
      run: (a: Record<string, unknown>) => guard(() => T.decodeJwt(str(a, 'token'))),
    },
    {
      name: 'base64_encode',
      description: 'Encode text as Base64.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: (a: Record<string, unknown>) => guard(() => T.encodeBase64(str(a, 'text'))),
    },
    {
      name: 'base64_decode',
      description: 'Decode a Base64 string to text.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: (a: Record<string, unknown>) => guard(() => T.decodeBase64(str(a, 'text'))),
    },
    {
      name: 'hash_text',
      description: 'Hash text with SHA-1, SHA-256, SHA-384, or SHA-512.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          algorithm: { type: 'string', description: 'SHA-1 | SHA-256 | SHA-384 | SHA-512' },
        },
        required: ['text'],
      },
      run: async (a: Record<string, unknown>) => {
        const algo = (str(a, 'algorithm') || 'SHA-256').toUpperCase() as T.HashAlgo;
        if (!['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].includes(algo)) return fail(`Unknown algorithm "${algo}".`);
        return ok(await T.hashText(str(a, 'text'), algo), `${algo} hash`);
      },
    },
    {
      name: 'uuid',
      description: 'Generate one or more random v4 UUIDs.',
      parameters: { type: 'object', properties: { count: { type: 'number' } }, required: [] },
      run: (a: Record<string, unknown>) => {
        const n = Math.min(100, Math.max(1, Number(a.count) || 1));
        return ok(Array.from({ length: n }, () => T.uuidV4()).join('\n'), `${n} UUID(s)`);
      },
    },
    {
      name: 'convert_case',
      description: 'Convert text to a naming case: camel, pascal, snake, kebab, constant, title, sentence, or dot.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, case: { type: 'string' } },
        required: ['text', 'case'],
      },
      run: (a: Record<string, unknown>) => {
        const kind = str(a, 'case').toLowerCase() as T.CaseKind;
        const valid = ['camel', 'pascal', 'snake', 'kebab', 'constant', 'title', 'sentence', 'dot'];
        if (!valid.includes(kind)) return fail(`Unknown case "${kind}". Use one of: ${valid.join(', ')}.`);
        return ok(T.toCase(str(a, 'text'), kind), `${kind} case`);
      },
    },
    {
      name: 'convert_color',
      description: 'Convert a color (hex, rgb, or hsl) to all three formats.',
      parameters: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] },
      run: (a: Record<string, unknown>) =>
        guard(() => {
          const c = T.parseColor(str(a, 'color'));
          return `${c.hex}\n${c.rgb}\n${c.hsl}`;
        }),
    },
  ],

  render(body: HTMLElement) {
    const root = el('div', 'devtools');
    const shell = el('div', 'dk-shell'); // the row/column the narrow-window query reflows (a container cannot restyle itself)
    const side = el('div', 'dk-sidebar');
    const host = el('div', 'dk-host');
    shell.append(side, host);
    root.append(shell);
    body.replaceChildren(root);

    // With 14 tools across 5 groups, the rail was the only way in and you had to
    // scan it. Type instead. Match against the name, the category AND the keywords —
    // "guid" has to find UUID, "epoch" has to find Timestamp — but score each field
    // SEPARATELY (see fuzzyBest): joined into one string, a subsequence spans words,
    // and "hex" matched "HTML entities … xss" ahead of Color.
    const fields = (t: Tool): string[] => [t.name, t.cat, ...(t.keywords ?? [])];

    const search = el('input', 'dk-search');
    search.type = 'search';
    search.placeholder = 'Search tools…';
    search.setAttribute('aria-label', 'Search tools');

    const nav = el('nav', 'dk-nav');
    nav.setAttribute('aria-label', 'Tools');
    side.append(search, nav);

    let currentId = TOOLS[0]!.id;

    function open(tool: Tool): void {
      currentId = tool.id;
      for (const b of nav.querySelectorAll<HTMLElement>('.dk-tool-btn')) {
        const active = b.dataset.id === tool.id;
        b.classList.toggle('is-active', active);
        // Not colour alone: the active tool is announced, not just tinted.
        if (active) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      }
      tool.render(host);
      // Remember it, so reopening DevTools lands where you left off instead of
      // always resetting to JSON. Prefixed by app id, per the storage convention.
      void dataStore.kv.set(LAST_TOOL_KEY, tool.id);
    }

    /** The tools matching the query, best first; everything when the box is empty. */
    function matches(): Tool[] {
      const q = search.value.trim();
      if (!q) return TOOLS;
      return TOOLS.map((t) => ({ t, s: fuzzyBest(q, fields(t)) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.t);
    }

    function renderNav(): void {
      const list = matches();
      nav.replaceChildren();

      if (!list.length) {
        nav.append(el('p', 'dk-empty', `No tool matches “${search.value.trim()}”.`));
        return;
      }

      // Grouped by category when browsing; a flat, ranked list when searching —
      // headings over a ranked result set would fight the ranking.
      const searching = Boolean(search.value.trim());
      if (searching) {
        for (const tool of list) nav.append(toolButton(tool));
        return;
      }
      for (const cat of [...new Set(list.map((t) => t.cat))]) {
        nav.append(el('div', 'dk-cat', cat));
        for (const tool of list.filter((t) => t.cat === cat)) nav.append(toolButton(tool));
      }
    }

    function toolButton(tool: Tool): HTMLButtonElement {
      const btn = el('button', 'dk-tool-btn' + (tool.id === currentId ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.id = tool.id;
      btn.textContent = tool.name;
      if (tool.id === currentId) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => open(tool));
      return btn;
    }

    search.addEventListener('input', renderNav);

    // Up/down through the results, Enter to open, Esc to clear — so the whole app
    // is reachable without the mouse leaving the search box.
    search.addEventListener('keydown', (e) => {
      const list = matches();
      if (e.key === 'Escape') {
        if (search.value) {
          search.value = '';
          renderNav();
        }
        return;
      }
      if (e.key === 'Enter') {
        const first = list[0];
        if (first) {
          open(first);
          renderNav();
        }
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (!list.length) return;
      const at = list.findIndex((t) => t.id === currentId);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      open(list[next]!);
      renderNav();
    });

    renderNav();

    // Reopen on the tool you were last using. Async, so paint the default first —
    // an empty panel while IndexedDB answers would be worse than a brief JSON.
    TOOLS[0]!.render(host);
    void dataStore.kv.get<string>(LAST_TOOL_KEY).then((id) => {
      const last = TOOLS.find((t) => t.id === id);
      if (last && last.id !== currentId) {
        open(last);
        renderNav();
      }
    });
  },
};

export default app;
