// Applying a text edit to a field the user is typing in — the one rule, for both surfaces.
//
// A DELETION IS NOT AN INSERT OF NOTHING.
//
// `document.execCommand('insertText', false, '')` does not remove the selection. It reports
// SUCCESS and leaves the text exactly as it was. So every suggestion whose replacement is an
// empty string silently did nothing — and those are real suggestions: `grammarRules/rules.ts`
// emits `suggestion: ''` for a repeated word and for a stray "to", and the UI shows them as
// "Remove". The command that removes a selection is `delete`.
//
// This shipped twice, in two surfaces, from the same misunderstanding:
//
//   apps/grammit/index.ts   the in-app editor          the popover's Remove did nothing (#255)
//   content/writer.ts       Grammit Anywhere, in-page  Remove does nothing on contentEditable —
//                           i.e. Gmail, Slack, Notion, most rich editors on the web (#295)
//
// Fixing it inline a second time would leave two copies of one rule. It lives here instead.
//
// Both surfaces still keep their OWN fallback, because a textarea and a contentEditable fail
// differently: one can be rewritten with setRangeText, the other needs its Range edited and a
// synthetic `input` event so React/ProseMirror learn the DOM changed. Only the CHOICE of command
// is shared — that is the part that was wrong.

/** Which browser command actually performs this edit. `''` is a deletion, not an empty insert. */
export const editCommandFor = (text: string): 'delete' | 'insertText' => (text === '' ? 'delete' : 'insertText');

/**
 * Apply `text` over the current selection through execCommand, so the edit joins the field's
 * native undo stack and the page's own input handling sees it.
 *
 * Returns whether the browser honoured it. It can refuse (an unsupported field, a policy), and a
 * caller that ignores the answer is a caller that silently does nothing — which is the whole bug
 * this module is named after. Every caller must have a fallback.
 */
export function execEdit(text: string, doc: Document = document): boolean {
  try {
    return editCommandFor(text) === 'delete' ? doc.execCommand('delete') : doc.execCommand('insertText', false, text);
  } catch {
    return false; // a document that has no execCommand at all (a test DOM, a hardened page)
  }
}

/**
 * The fallback when the browser refuses execCommand: edit the Range directly.
 *
 * It must exist, and it must fire `input`. A refused command that nobody catches is a silent
 * no-op — the exact failure this module is named after — and a page whose editor is
 * React/ProseMirror would never learn the DOM changed, so its own model would resurrect the old
 * text on the next keystroke.
 *
 * It does NOT join the field's native undo stack; nothing but execCommand can. That is why this
 * is the fallback and not the path.
 */
export function applyToRange(range: Range, text: string, field: HTMLElement): void {
  range.deleteContents(); // an empty `text` is a deletion, and this is what performs it
  if (text !== '') range.insertNode(field.ownerDocument.createTextNode(text));
  field.dispatchEvent(
    new (field.ownerDocument.defaultView?.InputEvent ?? InputEvent)('input', {
      bubbles: true,
      inputType: text === '' ? 'deleteContentBackward' : 'insertText',
      data: text === '' ? null : text,
    }),
  );
}
