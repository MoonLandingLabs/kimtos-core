// Parsing for text pasted into the Calculator (#816). Kept pure and separate from the
// app so it can be unit-tested without pulling in the CSS/DOM.

// Turn pasted text into a finite number, or null if it is not a single plain number.
// Tolerates surrounding whitespace and thousands separators (commas / spaces) so a value
// copied from another app — "1,234.5", " -42 " — pastes cleanly. A comma is a thousands
// separator, not a decimal point (the en-US / spreadsheet-export convention); "1,5" is
// 15, not 1.5. Anything that is not exactly one number — an expression, letters, an empty
// string, Infinity — returns null and the caller ignores the paste.
export function parsePastedNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, ''); // strip grouping commas and all whitespace
  if (cleaned === '') return null;
  // One number and nothing else: optional sign, digits with an optional decimal part,
  // and optional scientific-notation exponent.
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
