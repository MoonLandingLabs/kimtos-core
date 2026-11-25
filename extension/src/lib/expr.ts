// Safe arithmetic evaluator for the calculator tool — NO eval()/Function().
// Tokenize → shunting-yard (with unary minus) → evaluate RPN. Supports
// + - * / % ^, parentheses, decimals, and the calculator glyphs × ÷ −.
// Throws on anything malformed.

interface BinOp {
  p: number;
  a: 'L' | 'R';
  f: (a: number, b: number) => number;
}

const BIN: Record<string, BinOp> = {
  '+': { p: 2, a: 'L', f: (a, b) => a + b },
  '-': { p: 2, a: 'L', f: (a, b) => a - b },
  '*': { p: 3, a: 'L', f: (a, b) => a * b },
  '/': { p: 3, a: 'L', f: (a, b) => a / b },
  '%': { p: 3, a: 'L', f: (a, b) => a % b },
  '^': { p: 4, a: 'R', f: (a, b) => Math.pow(a, b) },
};
const NEG_P = 5; // unary minus binds tightest

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: string };

function tokenize(src: string): Token[] {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      if (!/^\d*\.?\d+$/.test(num)) throw new Error(`bad number "${num}"`);
      tokens.push({ type: 'num', value: parseFloat(num) });
      continue;
    }
    if (c in BIN) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', value: c });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  return tokens;
}

// RPN output items and operator-stack items (discriminated by their fields).
type OutItem = { type: 'num'; value: number } | { value: string } | { neg: true };
type StackItem = { value: string } | { neg: true; a: 'R' } | { paren: true };

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  if (!tokens.length) throw new Error('empty expression');

  const out: OutItem[] = [];
  const ops: StackItem[] = [];
  const precOf = (o: StackItem): number => ('neg' in o ? NEG_P : 'value' in o ? BIN[o.value].p : 0);
  let prev: Token | null = null;
  for (const t of tokens) {
    if (t.type === 'num') {
      out.push(t);
    } else if (t.type === 'op') {
      const atOperand = !prev || prev.type === 'op' || (prev.type === 'paren' && prev.value === '(');
      if (t.value === '+' && atOperand) {
        prev = t;
        continue; // unary plus is a no-op
      }
      if (t.value === '-' && atOperand) {
        ops.push({ neg: true, a: 'R' });
      } else {
        const o1 = BIN[t.value];
        while (ops.length) {
          const top = ops[ops.length - 1];
          if ('paren' in top) break;
          const p2 = precOf(top);
          if ((o1.a === 'L' && o1.p <= p2) || (o1.a === 'R' && o1.p < p2)) out.push(ops.pop() as OutItem);
          else break;
        }
        ops.push({ value: t.value });
      }
    } else if (t.value === '(') {
      ops.push({ paren: true });
    } else {
      while (ops.length && !('paren' in ops[ops.length - 1])) out.push(ops.pop() as OutItem);
      if (!ops.length) throw new Error('mismatched )');
      ops.pop();
    }
    prev = t;
  }
  while (ops.length) {
    const o = ops.pop() as StackItem;
    if ('paren' in o) throw new Error('mismatched (');
    out.push(o);
  }

  const st: number[] = [];
  for (const o of out) {
    if ('type' in o) {
      st.push(o.value);
    } else if ('neg' in o) {
      const a = st.pop();
      if (a === undefined) throw new Error('malformed expression');
      st.push(-a);
    } else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('malformed expression');
      st.push(BIN[o.value].f(a, b));
    }
  }
  if (st.length !== 1) throw new Error('malformed expression');
  const r = st[0];
  if (!Number.isFinite(r)) throw new Error('result is not a finite number');
  return r;
}
