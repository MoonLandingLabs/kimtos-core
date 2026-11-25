// Reading a CSS rule block out of a stylesheet AS TEXT.
//
// Several tests need this, and for the same reason: the thing being asserted is the SOURCE
// structure, not what a browser computes from it. `styles/paletteBlocks.test.ts` checks the
// palette blocks in base.css against each other; `lib/contentTheme.test.ts` checks that the
// palette a content script carries still matches the token it mirrors — a hand-written copy is
// only safe while something proves it is still a copy; `apps/pdflib/selectLayout.test.ts` checks
// that select mode declares no layout property; `styles/mdPreviewLists.test.ts` checks that a
// list still reserves room for its own numbers.
//
// It lives here rather than in any of them because two copies of a CSS parser that disagreed
// about what counts as a declaration would be worse than one, which is the same reason
// `check-theme-subscribers.mjs` shares its comment stripper with the other conventions guards.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `extension/src/styles/base.css`, as text. */
export const baseCss = (): string => readFileSync(join(HERE, '..', 'styles', 'base.css'), 'utf8');

/** `extension/src/styles/components.css`, as text. */
export const componentsCss = (): string => readFileSync(join(HERE, '..', 'styles', 'components.css'), 'utf8');

/** A stylesheet with its comments removed — exported so no caller writes a second stripper. */
export const withoutComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of a block, found by its opening selector and closed by brace depth.
 *
 * Throws rather than returning empty when the selector is gone: a block that was renamed must
 * fail loudly here, not silently assert nothing.
 */
export function blockBody(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`the stylesheet no longer contains the block \`${opener}\` — update the caller`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error(`unbalanced braces after \`${opener}\``);
}

/** Property names declared directly in a block body, ignoring comments and nested rules. */
export function declaredProps(body: string): string[] {
  return withoutComments(body)
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !d.includes('{') && !d.includes('}'))
    .map((d) => d.slice(0, d.indexOf(':')).trim())
    .filter(Boolean);
}

/** The value of one declaration in a block body, or null when it is not declared there. */
export const declaredValue = (body: string, prop: string): string | null =>
  new RegExp(`(?:^|;|\\*/)\\s*${prop}\\s*:\\s*([^;]+);`).exec(withoutComments(body))?.[1].trim() ?? null;
