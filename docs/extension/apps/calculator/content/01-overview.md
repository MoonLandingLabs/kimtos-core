# Overview

**Calculator** is a standard four-function calculator with full keyboard
support. Add, subtract, multiply, and divide, with the running expression shown
on a small history line above the main display. It is part of the kimtos
new-tab app suite.

The window opens at a compact size — a calculator gains nothing from going
full-width, so the maximize control stays disabled.

## Highlights

- **Four functions** — addition, subtraction, multiplication, and division.
- **History line** — a secondary line shows the expression so far (for example
  `12 × 3 =`) above the current number.
- **Sign and percent** — flip the sign with `±`, or convert the current number
  to a percentage with `%`.
- **Repeat equals** — press `=` again to apply the last operation once more.
- **Clean results** — answers are trimmed to remove floating-point noise;
  dividing by zero (or any non-finite result) shows `Error`.
- **Keyboard and mouse** — type on the keypad or click the tiles. Keyboard input
  is scoped to the calculator window, so it never disturbs other open apps.

## Privacy model

Calculator keeps **no data at all**. It has no storage, no history beyond the
current calculation, no account, and no network. The running total lives only in
memory while the window is open and is gone when you close it — nothing is ever
written to disk or uploaded.
