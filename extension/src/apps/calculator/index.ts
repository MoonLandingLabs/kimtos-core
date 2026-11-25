// Calculator — a standard four-function calculator with keyboard support. Pure
// UI, no persistence: the running total lives in a small state machine below.
// Keyboard: digits, + - * /, Enter or = to evaluate, Backspace, Esc/c to clear.
// Paste (Ctrl/Cmd+V) drops a copied number into the display (#816).

import './calculator.css';
import { el } from '../../lib/dom.js';
import { evaluate } from '../../lib/expr.js';
import { parsePastedNumber } from './paste.js';
import appMeta from './meta.js';
const ACCENT = appMeta.accent;

const SYMBOL: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function compute(a: number, op: string, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? NaN : a / b;
    default:
      return b;
  }
}

// Trim floating-point noise to something a calculator would show, without
// dropping precision the user actually entered. NaN/Infinity → "Error".
function format(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Number(n.toPrecision(12));
  return String(rounded);
}

interface KeyDef {
  label: string;
  act: string;
  kind?: string;
  op?: string;
  d?: string;
  span?: boolean;
}

// Button layout. `key` matches what we accept from the keyboard; `kind` styles
// the tile (operator / function / equals / digit). `span` widens the zero key.
const KEYS: KeyDef[] = [
  { label: 'AC', act: 'clear', kind: 'fn' },
  { label: '±', act: 'negate', kind: 'fn' },
  { label: '%', act: 'percent', kind: 'fn' },
  { label: '÷', act: 'op', op: '/', kind: 'op' },
  { label: '7', act: 'digit', d: '7' },
  { label: '8', act: 'digit', d: '8' },
  { label: '9', act: 'digit', d: '9' },
  { label: '×', act: 'op', op: '*', kind: 'op' },
  { label: '4', act: 'digit', d: '4' },
  { label: '5', act: 'digit', d: '5' },
  { label: '6', act: 'digit', d: '6' },
  { label: '−', act: 'op', op: '-', kind: 'op' },
  { label: '1', act: 'digit', d: '1' },
  { label: '2', act: 'digit', d: '2' },
  { label: '3', act: 'digit', d: '3' },
  { label: '+', act: 'op', op: '+', kind: 'op' },
  { label: '0', act: 'digit', d: '0', span: true },
  { label: '.', act: 'dot' },
  { label: '=', act: 'equals', kind: 'equals' },
];

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'A quick four-function calculator',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tool.
  tools: [
    {
      name: 'calculate',
      description: 'Evaluate an arithmetic expression (+ - * / % ^ and parentheses).',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'e.g. "(12 + 3) * 4 / 2"' } },
        required: ['expression'],
      },
      run: (args: Record<string, unknown>) => {
        const value = evaluate(String(args.expression ?? ''));
        return { ok: true, result: String(value), summary: `${String(args.expression)} = ${value}` };
      },
    },
  ],

  render(body: HTMLElement) {
    // --- state machine -----------------------------------------------------
    let acc: number | null = null; // running total (number) or null
    let op: string | null = null; // pending operator
    let cur = '0'; // the number being typed (string)
    let fresh = true; // next digit replaces `cur` rather than appending
    let last: { op: string; b: number } | null = null; // { op, b } for repeat-equals
    let expr = ''; // the secondary "history" line

    const root = el('div', 'calc');
    root.tabIndex = 0; // so it can receive keyboard input

    const exprLine = el('div', 'calc-expr');
    const display = el('div', 'calc-display');
    const pad = el('div', 'calc-pad');

    const draw = (): void => {
      exprLine.textContent = expr;
      display.textContent = cur;
    };

    const clearAll = (): void => {
      acc = null;
      op = null;
      cur = '0';
      fresh = true;
      last = null;
      expr = '';
    };

    const inputDigit = (d: string): void => {
      if (cur === 'Error') clearAll();
      if (fresh) {
        cur = d;
        fresh = false;
      } else cur = cur === '0' ? d : cur + d;
    };

    const inputDot = (): void => {
      if (cur === 'Error') clearAll();
      if (fresh) {
        cur = '0.';
        fresh = false;
      } else if (!cur.includes('.')) cur += '.';
    };

    const negate = (): void => {
      if (cur === '0' || cur === 'Error') return;
      cur = cur.startsWith('-') ? cur.slice(1) : `-${cur}`;
    };

    const percent = (): void => {
      if (cur === 'Error') return;
      cur = format(parseFloat(cur) / 100);
      fresh = true;
    };

    const backspace = (): void => {
      if (fresh || cur === 'Error') return;
      cur = cur.length > 1 && !(cur.length === 2 && cur.startsWith('-')) ? cur.slice(0, -1) : '0';
      if (cur === '0') fresh = true;
    };

    const chooseOp = (next: string): void => {
      if (cur === 'Error') return;
      if (op !== null && !fresh) {
        acc = compute(acc ?? 0, op, parseFloat(cur));
        cur = format(acc);
      } else if (acc === null) {
        acc = parseFloat(cur);
      }
      op = next;
      last = null;
      fresh = true;
      expr = `${format(acc ?? 0)} ${SYMBOL[op]}`;
    };

    const equals = (): void => {
      if (cur === 'Error') return;
      if (op !== null) {
        const b = parseFloat(cur);
        const a = acc ?? 0;
        const result = compute(a, op, b);
        expr = `${format(a)} ${SYMBOL[op]} ${format(b)} =`;
        cur = format(result);
        last = { op, b };
        acc = null;
        op = null;
        fresh = true;
      } else if (last) {
        // Pressing = again repeats the last operation.
        const a = parseFloat(cur);
        const result = compute(a, last.op, last.b);
        expr = `${format(a)} ${SYMBOL[last.op]} ${format(last.b)} =`;
        cur = format(result);
        fresh = true;
      }
    };

    const handle = (item: KeyDef): void => {
      switch (item.act) {
        case 'digit':
          inputDigit(item.d ?? '');
          break;
        case 'dot':
          inputDot();
          break;
        case 'op':
          chooseOp(item.op ?? '');
          break;
        case 'equals':
          equals();
          break;
        case 'clear':
          clearAll();
          break;
        case 'negate':
          negate();
          break;
        case 'percent':
          percent();
          break;
      }
      draw();
    };

    for (const item of KEYS) {
      const btn = el(
        'button',
        `calc-key${item.kind ? ` is-${item.kind}` : ''}${item.span ? ' is-wide' : ''}`,
        item.label,
      );
      btn.type = 'button';
      btn.addEventListener('click', () => {
        handle(item);
        root.focus();
      });
      pad.append(btn);
    }

    // Keyboard support — scoped to this window (listener lives on the focused
    // root, so it never interferes with other open app windows).
    root.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k >= '0' && k <= '9') handle({ act: 'digit', d: k, label: k });
      else if (k === '.' || k === ',') handle({ act: 'dot', label: '.' });
      else if (k === '+' || k === '-' || k === '*' || k === '/') handle({ act: 'op', op: k, label: k });
      else if (k === 'Enter' || k === '=') {
        e.preventDefault();
        handle({ act: 'equals', label: '=' });
      } else if (k === 'Backspace') {
        backspace();
        draw();
      } else if (k === 'Escape' || k === 'c' || k === 'C') handle({ act: 'clear', label: 'AC' });
      else if (k === '%') handle({ act: 'percent', label: '%' });
      else return;
      e.stopPropagation();
    });

    // Paste (Ctrl/Cmd+V) a copied number straight into the display, as if typed (#816).
    // Reading clipboardData inside the paste event needs no `clipboardRead` permission.
    // A non-number (an expression, letters, empty) leaves the state untouched.
    root.addEventListener('paste', (e) => {
      const n = parsePastedNumber(e.clipboardData?.getData('text/plain') ?? '');
      if (n === null) return;
      e.preventDefault();
      if (cur === 'Error') clearAll();
      cur = format(n);
      fresh = false; // a following digit appends, matching typed input
      draw();
    });

    root.append(exprLine, display, pad);
    body.replaceChildren(root);
    draw();
    requestAnimationFrame(() => root.focus());
  },
};

export default app;
