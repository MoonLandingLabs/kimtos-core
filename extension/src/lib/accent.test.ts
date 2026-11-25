// The accent/ground contract — the thing two separate bugs were needed to arrive at.
//
//   #129  --on-accent was a fixed white. Measured, white failed WCAG AA on ALL nineteen
//         accents (Grammit 1.74:1, the brand blue 3.68:1).
//   #151  so the INK was derived from luminance instead — and 15 of the 19 accents are
//         light, so buttons and glyphs came out BLACK, in both themes. A luminance test
//         does not know what theme it is in.
//
// The answer was to move the other half of the pair: the ink is WHITE, always, and the
// GROUND is the accent darkened just enough to carry it. This asserts that contract holds
// for every accent we actually ship — scripts/check-contrast.mjs asserts the palette, but
// nothing asserted this function, and the same rule is implemented twice (once here in the
// browser, once in the Node checker), so the two can drift.
//
// The accents are read from the metas on disk, so a NEW APP IS COVERED with no edit here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ACCENT, solidFor, solidUiFor } from './accent.js';

const APPS = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps');

/** Every SHIPPED app's accent, straight from its meta.ts. */
function shippedAccents(): { id: string; accent: string }[] {
  return readdirSync(APPS)
    .filter((id) => existsSync(join(APPS, id, 'meta.ts')) && existsSync(join(APPS, id, 'index.ts')))
    .map((id) => {
      const src = readFileSync(join(APPS, id, 'meta.ts'), 'utf8');
      const m = src.match(/accent:\s*'(#[0-9a-fA-F]{3,8})'/);
      return m ? { id, accent: m[1] } : null;
    })
    .filter((x): x is { id: string; accent: string } => x !== null);
}

// WCAG relative luminance / contrast, independently of the implementation under test.
const lum = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const [r, g, b] = full.map((c) => {
    const s = parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onWhite = (hex: string): number => 1.05 / (lum(hex) + 0.05);

const accents = shippedAccents();

describe('the fixtures are real', () => {
  test('every shipped app has a parseable accent', () => {
    assert.ok(accents.length >= 15, `only found ${accents.length} accents — the meta parse is broken`);
  });
});

describe('solidFor — white TEXT on it must clear 4.5:1 (WCAG 1.4.3)', () => {
  for (const { id, accent } of accents) {
    test(`${id} (${accent})`, () => {
      const ratio = onWhite(solidFor(accent));
      assert.ok(ratio >= 4.5, `white text on solidFor('${accent}') is ${ratio.toFixed(2)}:1`);
    });
  }

  test('the brand accent too', () => {
    assert.ok(onWhite(solidFor(DEFAULT_ACCENT)) >= 4.5);
  });
});

describe('solidUiFor — a white GLYPH on it must clear 3:1 (WCAG 1.4.11)', () => {
  for (const { id, accent } of accents) {
    test(`${id} (${accent})`, () => {
      const ratio = onWhite(solidUiFor(accent));
      assert.ok(ratio >= 3, `white glyph on solidUiFor('${accent}') is ${ratio.toFixed(2)}:1`);
    });
  }
});

describe('the ground is DARKENED, never lightened — and never more than it must be', () => {
  test('the solid ground is at least as dark as the accent', () => {
    for (const { id, accent } of accents) {
      assert.ok(lum(solidFor(accent)) <= lum(accent) + 1e-9, `${id}: solidFor lightened the accent`);
    }
  });

  test('the UI ground (3:1) is never darker than the text ground (4.5:1) — a lower bar needs less darkening', () => {
    for (const { id, accent } of accents) {
      assert.ok(
        lum(solidUiFor(accent)) >= lum(solidFor(accent)) - 1e-9,
        `${id}: the 3:1 ground is darker than the 4.5:1 one`,
      );
    }
  });

  test('an accent that ALREADY clears the bar is returned untouched (do not darken for nothing)', () => {
    const dark = '#1e3a8a'; // white on it is already well past 4.5:1
    assert.equal(solidFor(dark), dark);
  });
});

describe('bad input is handed back, not guessed at', () => {
  test('an unparseable accent is returned untouched rather than painted black', () => {
    for (const bad of ['', 'red', 'var(--x)', '#12345', 'rgb(1,2,3)']) {
      assert.equal(solidFor(bad), bad, `solidFor(${JSON.stringify(bad)}) must not invent a colour`);
    }
  });

  test('#rgb shorthand is handled like #rrggbb', () => {
    assert.ok(onWhite(solidFor('#4ade80')) >= 4.5);
    assert.ok(onWhite(solidFor('#4d8')) >= 4.5, '#rgb shorthand must parse');
  });
});
