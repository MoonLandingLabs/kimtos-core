// Meaning check for Rewordit (#644) — a pure, verifiable guard over a rewrite.
//
// A small on-device model rewriting a sentence WILL sometimes change what the
// sentence says: "The meeting starts at 10:00 AM." came back as "After the
// meeting began at 9:05 AM, …", and "The package weighs 25 kg." as "It weighed
// about 27 kilograms." A stricter prompt reduces that; it does not remove it.
// So we check the result instead of trusting it — the same shape as
// `trustworthy()` in textDiff.ts, which stops a grammar model's "answer" being
// shown as a correction.
//
// Only drift we can PROVE is reported. Numbers, times and dates are copied
// verbatim in a faithful rewrite, so a dropped/added/changed one is hard
// evidence. Length blow-up or collapse means the model answered or truncated
// rather than reworded. A question that stops being a question changed intent.
// Everything softer (synonym drift, hedging, a flipped negation expressed
// without a negation word) is NOT checked — there is no reliable local test,
// and a guard with false positives would be worse than none.

/** Why a rewrite is suspect. */
export type RephraseProblemKind = 'facts' | 'length' | 'intent' | 'empty' | 'echo';

export interface RephraseProblem {
  kind: RephraseProblemKind;
  /** `drift` — the meaning changed, do not present the rewrite as good. `weak` — it is faithful but a poor rewrite. */
  severity: 'drift' | 'weak';
  /** One plain-English sentence, safe to show to the user. */
  message: string;
}

export interface RephraseCheck {
  /** True when nothing proves the meaning changed. */
  ok: boolean;
  problems: RephraseProblem[];
}

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };

const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const DIGITS = /\d+(?:[.,]\d+)*/g;
const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES)]);

// "25", "1,000", "3.50" → a canonical string, so 1,000 and 1000 are one fact and
// 3.50 and 3.5 are one fact. Anything unparseable keeps its literal form.
function canonicalNumber(raw: string): string {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : raw;
}

// "10:00" → "10", "09:05" → "9:05". A whole hour is the same fact however it is
// written, so "10:00 AM" and "10 AM" agree instead of looking like a change.
function canonicalClock(raw: string): string {
  const parts = raw.split(':');
  const hour = String(Number(parts[0]));
  const rest = parts.slice(1);
  return rest.every((p) => Number(p) === 0) ? hour : [hour, ...rest].join(':');
}

// Spelled-out number run → its value, or null when the run is not a number.
// "twenty-five" → 25, "one hundred and twenty" → 120, "the package" → null.
function wordsToNumber(run: string): number | null {
  const words = run
    .toLowerCase()
    .split(/[-\s]+/)
    .filter(Boolean);
  let total = 0;
  let current = 0;
  let saw = false;
  for (const w of words) {
    if (w === 'and') {
      if (!saw) return null; // a bare "and" is prose, not part of a number
      continue;
    }
    if (w in UNITS) {
      current += UNITS[w] as number;
    } else if (w in TENS) {
      current += TENS[w] as number;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
    } else if (w in SCALES) {
      total += (current || 1) * (SCALES[w] as number);
      current = 0;
    } else {
      return null;
    }
    saw = true;
  }
  return saw ? total + current : null;
}

// Maximal runs of spelled-out number words, as values: "one hundred and twenty
// crates" → [120]. Prose words end a run, so "one of the two boxes" → [1, 2].
function spelledNumbers(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const values: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length) {
      const value = wordsToNumber(run.join(' '));
      if (value !== null) values.push(String(value));
    }
    run = [];
  };
  for (const token of tokens) {
    if (NUMBER_WORDS.has(token) || (token === 'and' && run.length)) run.push(token);
    else flush();
  }
  flush();
  return values;
}

interface Numbers {
  /** What a faithful rewrite MUST keep. */
  facts: Set<string>;
  /** Every number mentioned, spelled-out ones included. */
  mentions: Set<string>;
}

// One pass over the text for both sets — the caller always wants both.
function scanNumbers(text: string): Numbers {
  const facts = new Set<string>();
  // Clock times first, and blanked out afterwards, so "10:00" is one fact
  // rather than the two numbers 10 and 0.
  const rest = text.replace(CLOCK, (m) => {
    facts.add(canonicalClock(m));
    return ' '.repeat(m.length);
  });
  for (const m of rest.matchAll(DIGITS)) facts.add(canonicalNumber(m[0]));
  const mentions = new Set(facts);
  for (const value of spelledNumbers(rest)) mentions.add(value);
  return { facts, mentions };
}

/**
 * The numeric facts a faithful rewrite MUST keep: clock times (`10:00` → `10`,
 * `09:05` → `9:05`) and digits canonicalized to their value (`1,000` → `1000`).
 *
 * Spelled-out numbers are deliberately NOT facts. "one" and "two" are ordinary
 * prose ("one of the boxes"), so requiring them back would flag correct
 * rewrites; they only ever corroborate — see `numericMentions`.
 */
export function numericFacts(text: string): Set<string> {
  return scanNumbers(text).facts;
}

/**
 * Every number the text mentions, spelled-out ones included. Used to accept a
 * rewrite that swaps notation in either direction: `25` → `twenty-five` still
 * carries the fact, and `twenty-five` → `25` invents nothing.
 */
export function numericMentions(text: string): Set<string> {
  return scanNumbers(text).mentions;
}

const countWords = (text: string): number => (text.trim().match(/\S+/g) ?? []).length;

// Lowercase, strip punctuation and collapse whitespace — for "did it actually
// reword anything?".
const flatten = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const list = (values: string[]): string => values.slice(0, 4).join(', ') + (values.length > 4 ? ', …' : '');

function factsProblem(original: string, rewrite: string): RephraseProblem | null {
  const before = scanNumbers(original);
  const after = scanNumbers(rewrite);
  const missing = [...before.facts].filter((f) => !after.mentions.has(f));
  const added = [...after.facts].filter((f) => !before.mentions.has(f));
  if (!missing.length && !added.length) return null;

  let message: string;
  if (missing.length === 1 && added.length === 1) {
    message = `A number or time changed: ${missing[0]} became ${added[0]}.`;
  } else if (missing.length && added.length) {
    message = `Numbers or times changed: ${list(missing)} became ${list(added)}.`;
  } else if (missing.length) {
    message = `The rewrite dropped ${missing.length === 1 ? 'a number or time' : 'numbers or times'}: ${list(missing)}.`;
  } else {
    message = `The rewrite invented ${added.length === 1 ? 'a number or time' : 'numbers or times'}: ${list(added)}.`;
  }
  return { kind: 'facts', severity: 'drift', message };
}

function lengthProblem(original: string, rewrite: string): RephraseProblem | null {
  const before = countWords(original);
  const after = countWords(rewrite);
  if (!before) return null;
  // The prompt asks for +/-20%; the guard is deliberately much wider, with a
  // few words of slack so a short sentence is not flagged for one extra word.
  const low = Math.max(1, Math.floor(before * 0.5) - 2);
  const high = Math.ceil(before * 1.8) + 3;
  if (after > high) {
    return {
      kind: 'length',
      severity: 'drift',
      message: `The rewrite is much longer than the original (${after} words against ${before}), so it added information.`,
    };
  }
  if (after < low) {
    return {
      kind: 'length',
      severity: 'drift',
      message: `The rewrite is much shorter than the original (${after} words against ${before}), so it dropped information.`,
    };
  }
  return null;
}

function intentProblem(original: string, rewrite: string): RephraseProblem | null {
  const wasQuestion = original.trim().endsWith('?');
  const isQuestion = rewrite.trim().endsWith('?');
  if (wasQuestion && !isQuestion) {
    return { kind: 'intent', severity: 'drift', message: 'The original asked a question; the rewrite does not.' };
  }
  if (!wasQuestion && isQuestion) {
    return { kind: 'intent', severity: 'drift', message: 'The original was not a question; the rewrite asks one.' };
  }
  return null;
}

/**
 * Compare a rewrite against its source. `ok` is false only when something
 * PROVES the meaning changed — a caller must not present such a rewrite as a
 * good one. `weak` problems are faithful but poor (an empty or unchanged
 * result) and leave `ok` true where the text is safe to show.
 */
export function checkRephrase(original: string, rewrite: string): RephraseCheck {
  const source = (original ?? '').trim();
  const result = (rewrite ?? '').trim();
  if (!result) {
    return {
      ok: false,
      problems: [{ kind: 'empty', severity: 'drift', message: 'The model returned nothing.' }],
    };
  }
  if (!source) return { ok: true, problems: [] };

  const problems: RephraseProblem[] = [];
  for (const problem of [factsProblem(source, result), lengthProblem(source, result), intentProblem(source, result)]) {
    if (problem) problems.push(problem);
  }
  if (flatten(source) === flatten(result)) {
    problems.push({
      kind: 'echo',
      severity: 'weak',
      message: 'The model returned the same sentence instead of rewording it.',
    });
  }
  return { ok: !problems.some((p) => p.severity === 'drift'), problems };
}

/** One line naming everything the check found, for a warning banner or a tool result. */
export function describeProblems(problems: RephraseProblem[]): string {
  return problems.map((p) => p.message).join(' ');
}
