// What the popover's Apply button should DO — the decision, separated from the DOM.
//
// It is here because it was wrong, and wrong in a way that made the app's primary interaction
// dead: clicking Apply did nothing at all (#255).
//
// The Apply button belongs to the CUSTOM CORRECTION box, not to a suggestion. That box used to
// be pre-filled with `iss.original` — the user's own misspelled word — and the submit handler
// read:
//
//   if (value !== '' && value !== iss.original) acceptIssue(iss, value);
//   else closePopover();
//
// So a user who clicked Apply without editing the box submitted the ORIGINAL text, the guard
// called that "no change", and the popover simply closed. The box is pre-filled with the
// SUGGESTION now, so Apply does the obvious thing — and typing your own still applies yours.
//
// The other half is the empty string. `rules.ts` genuinely suggests DELETION (a repeated word,
// a stray "to"), which the popover shows as "Remove". The old guard's `value !== ''` made an
// empty replacement unexpressible: you could not delete a word by clearing the box, and the
// Remove suggestion had no way through either. An empty replacement is a real edit here, not an
// absence of one.

export interface ApplyIssue {
  original: string;
  suggestion: string;
}

/** Apply the text, or close because there is nothing to do. */
export type ApplyDecision = { action: 'apply'; text: string } | { action: 'close' };

/**
 * Decide what the custom box's Apply should do.
 *
 * The one rule: apply whatever the user is looking at unless it is what they already have.
 * "Nothing to change" is the ONLY reason to do nothing — and an empty value is not that, it is
 * a deletion.
 */
export function applyDecision(value: string, iss: ApplyIssue): ApplyDecision {
  // No trim(). The user's replacement is theirs: leading/trailing spaces can be exactly the
  // point (splitting a run-on word into two). We only compare, we never rewrite.
  if (value === iss.original) return { action: 'close' }; // nothing would change
  return { action: 'apply', text: value };
}

/** Is this issue a removal — i.e. does accepting it delete the text rather than replace it? */
export const isRemoval = (iss: ApplyIssue): boolean => iss.suggestion === '';

/**
 * What the custom box starts with: the SUGGESTION, so Apply accepts it with one click.
 *
 * For a removal the suggestion is empty, which is correct — the box shows nothing, its
 * placeholder invites a replacement, and Apply on the empty box deletes, which is what the
 * "Remove" label promises.
 */
export const initialCustomValue = (iss: ApplyIssue): string => iss.suggestion;
