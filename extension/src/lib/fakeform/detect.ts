// What KIND of thing is this field asking for?
//
// This is the substance of FakeForm. Everything else is plumbing: if the detector calls a
// postcode box a paragraph, the app is useless however nicely it writes the value.
//
// Deliberately PURE — it takes a plain `FieldInfo` describing a field, never an element. That
// is what makes it testable without a DOM and reusable from the agent tools, and it keeps the
// DOM reading (labels, ARIA, visibility) in one adapter (`fill.ts`) instead of smeared through
// forty rules.
//
// The order of evidence, strongest first:
//
//   1. The `type` attribute WINS. An `<input type="tel">` is a telephone number no matter what
//      it is called — that is the one rule the reference implementation (Fake Filler) states
//      outright, and it is right: the page author has already told us the answer.
//   2. `autocomplete`. A spec-defined vocabulary the author opted into; far better evidence
//      than a guess at a class name.
//   3. The words around the field — `name`, `id`, `class`, `placeholder`, `aria-label` and the
//      `<label>` text. Punctuation is stripped before matching, so `user_name`, `user-name`
//      and `userName` all match `username`.
//   4. Failing all that, plain text.
//
// Rule 3 is FIRST-MATCH-WINS over an ordered table, most specific first, exactly like the
// custom-field lists the reference exposes to users. `firstName` must be caught by the
// first-name rule before the generic name rule ever sees it.

/** Every kind of value FakeForm knows how to invent. `skip` means "do not touch this field". */
export type FieldKind =
  | 'email'
  | 'password'
  | 'tel'
  | 'url'
  | 'search'
  | 'first-name'
  | 'last-name'
  | 'full-name'
  | 'username'
  | 'organization'
  | 'job-title'
  | 'street-address'
  | 'address-line2'
  | 'city'
  | 'region'
  | 'postal-code'
  | 'country'
  | 'date'
  | 'birth-date'
  | 'time'
  | 'month'
  | 'week'
  | 'datetime'
  | 'number'
  | 'age'
  | 'currency'
  | 'color'
  | 'range'
  | 'credit-card'
  | 'card-cvc'
  | 'card-expiry'
  | 'uuid'
  | 'ip-address'
  | 'paragraph'
  | 'text'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'skip';

/** A field, described without a DOM. `fill.ts` builds one of these from an element. */
export interface FieldInfo {
  /** Lowercased tag name: `input`, `textarea`, `select`, or anything else (contentEditable). */
  tag: string;
  /** Lowercased `type` for an `<input>`; empty for everything else. */
  type: string;
  name: string;
  id: string;
  className: string;
  placeholder: string;
  ariaLabel: string;
  /** The resolved `<label>` / `aria-labelledby` text. */
  label: string;
  autocomplete: string;
  /** `maxlength`, or -1 when unset. */
  maxLength: number;
  min: string;
  max: string;
  step: string;
  pattern: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  /** True for a `contenteditable` host (a rich text editor). */
  editable: boolean;
}

/** A blank `FieldInfo`, so callers (and tests) only state the parts they care about. */
export const emptyFieldInfo = (over: Partial<FieldInfo> = {}): FieldInfo => ({
  tag: 'input',
  type: 'text',
  name: '',
  id: '',
  className: '',
  placeholder: '',
  ariaLabel: '',
  label: '',
  autocomplete: '',
  maxLength: -1,
  min: '',
  max: '',
  step: '',
  pattern: '',
  required: false,
  disabled: false,
  readOnly: false,
  editable: false,
  ...over,
});

// ── the text haystack ─────────────────────────────────────────────────────────────────────

/** Everything except letters and digits, gone: `user_name` / `user-name` / `userName` → `username`. */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Split a source into individual words, breaking on punctuation AND on camelCase, so
 * `dateOfBirth` yields `date`, `of`, `birth`. Used by the rules whose token is a short,
 * ambiguous word — `age` must not match `homepage`, `zip` must not match `zipline`.
 */
const wordsOf = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The text signals worth trusting: what the author NAMED the field and what they SHOWED the
 * user next to it.
 *
 * `class` is deliberately not in here. It is the one source that is mostly not about this
 * field at all — `form-control ng-pristine ng-untouched is-invalid` — so letting it compete
 * on equal terms with a real label means framework noise decides the answer. It is still
 * consulted, but only as a fallback once nothing else matched (see `matchRules`), which keeps
 * its upside (auto-generated `name`/`id` hashes, where the class is the only human word left)
 * without its downside.
 */
const strongSources = (f: FieldInfo): string[] => [f.name, f.id, f.placeholder, f.ariaLabel, f.label];

interface Haystack {
  /** Each source squashed, joined by a separator so two sources cannot merge into a phrase. */
  squashed: string;
  /** Every individual word across every source. */
  words: Set<string>;
}

function haystackOf(sources: readonly string[]): Haystack {
  return {
    squashed: sources.map(squash).join('|'),
    words: new Set(sources.flatMap(wordsOf)),
  };
}

// ── the rule table ────────────────────────────────────────────────────────────────────────

interface Rule {
  kind: FieldKind;
  /** Matched as a SUBSTRING of the squashed text. For distinctive phrases only. */
  contains?: readonly string[];
  /** Matched as a WHOLE WORD. For short, ambiguous tokens that would false-positive. */
  word?: readonly string[];
}

/**
 * First match wins, so specific rules sit above generic ones — `firstname` before `name`,
 * `address2` before `address`. Adding a rule means deciding where it belongs, not appending.
 */
const RULES: readonly Rule[] = [
  { kind: 'email', contains: ['emailaddress', 'email'], word: ['email', 'mail'] },
  { kind: 'password', contains: ['password', 'passphrase'], word: ['passwd', 'pwd', 'pass'] },
  { kind: 'credit-card', contains: ['creditcard', 'cardnumber', 'ccnumber', 'cardnum', 'debitcard'] },
  { kind: 'card-cvc', contains: ['securitycode', 'cardcode'], word: ['cvv', 'cvc', 'csc'] },
  { kind: 'card-expiry', contains: ['expirationdate', 'expirydate', 'ccexp', 'cardexpiry', 'expdate'] },
  { kind: 'first-name', contains: ['firstname', 'givenname', 'forename', 'namefirst'], word: ['fname'] },
  { kind: 'last-name', contains: ['lastname', 'surname', 'familyname', 'namelast'], word: ['lname'] },
  {
    kind: 'username',
    contains: ['username', 'screenname', 'accountname', 'loginname'],
    word: ['userid', 'login', 'handle', 'nickname', 'nick'],
  },
  { kind: 'full-name', contains: ['fullname', 'contactname', 'displayname', 'realname', 'yourname'], word: ['name'] },
  {
    kind: 'organization',
    contains: ['companyname', 'organisation', 'organization', 'businessname'],
    word: ['company', 'employer', 'org'],
  },
  { kind: 'job-title', contains: ['jobtitle', 'occupation'], word: ['position', 'profession', 'role'] },
  // NB "unit" as a bare word is intentionally NOT here: it collides with "unit price", "unit
  // cost", "unit of measure". An apartment unit still matches via `unitnumber`/`apartment`/`apt`.
  {
    kind: 'address-line2',
    contains: ['addressline2', 'addresstwo', 'address2', 'apartment', 'unitnumber'],
    word: ['apt', 'suite'],
  },
  {
    kind: 'street-address',
    contains: [
      'streetaddress',
      'addressline1',
      'addressline',
      'address1',
      'mailingaddress',
      'shippingaddress',
      'billingaddress',
      'street',
    ],
    word: ['address'],
  },
  { kind: 'city', contains: ['addresslevel2'], word: ['city', 'town', 'locality', 'suburb'] },
  { kind: 'region', contains: ['addresslevel1', 'stateprovince'], word: ['state', 'province', 'region', 'county'] },
  { kind: 'postal-code', contains: ['postalcode', 'postcode', 'zipcode'], word: ['zip', 'postal'] },
  { kind: 'country', word: ['country', 'nation'] },
  {
    kind: 'tel',
    contains: ['telephone', 'phonenumber', 'mobilenumber'],
    word: ['phone', 'tel', 'mobile', 'cell', 'fax'],
  },
  { kind: 'birth-date', contains: ['dateofbirth', 'birthdate', 'birthday'], word: ['dob', 'bday', 'birthdate'] },
  { kind: 'age', word: ['age'] },
  { kind: 'currency', contains: ['unitprice'], word: ['price', 'amount', 'salary', 'cost', 'total', 'budget'] },
  { kind: 'ip-address', contains: ['ipaddress'], word: ['ip'] },
  { kind: 'uuid', word: ['uuid', 'guid'] },
  { kind: 'url', contains: ['website', 'homepage'], word: ['url', 'link', 'site', 'domain'] },
  {
    kind: 'paragraph',
    contains: ['description'],
    word: ['message', 'comment', 'comments', 'bio', 'about', 'notes', 'note', 'feedback', 'summary'],
  },
  { kind: 'number', contains: ['quantity'], word: ['number', 'num', 'qty', 'count'] },
];

/** The words that mean "this is a CAPTCHA" — never fill one; it is the one field a human must do. */
const CAPTCHA = ['captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'friendlycaptcha', 'humanverification'];

/** Input types that hold no user-authored value, or that a script is not allowed to set. */
const UNFILLABLE_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

/** Does the text around this field mark it as a CAPTCHA? `class` counts here — a CAPTCHA
 *  widget is usually identified by nothing else. */
export function isCaptcha(f: FieldInfo): boolean {
  const { squashed } = haystackOf([...strongSources(f), f.className]);
  return CAPTCHA.some((token) => squashed.includes(token));
}

/**
 * Fields FakeForm must not touch, decided from the field alone.
 *
 * Disabled and read-only are the author saying "not yours to change"; hidden fields carry
 * CSRF tokens and state that filling would corrupt; a file input cannot be set by script at
 * all; and a CAPTCHA is the single field whose entire purpose is that a program does not
 * answer it. `fill.ts` adds the one test that needs a layout — whether the field is visible.
 */
export function isFillable(f: FieldInfo): boolean {
  if (f.disabled || f.readOnly) return false;
  if (f.tag === 'input' && UNFILLABLE_TYPES.has(f.type)) return false;
  if (f.tag !== 'input' && f.tag !== 'textarea' && f.tag !== 'select' && !f.editable) return false;
  return !isCaptcha(f);
}

// ── type and autocomplete ─────────────────────────────────────────────────────────────────

/** `<input type=…>` values that decide the kind outright. */
const BY_TYPE: Record<string, FieldKind> = {
  email: 'email',
  password: 'password',
  tel: 'tel',
  url: 'url',
  search: 'search',
  number: 'number',
  date: 'date',
  time: 'time',
  month: 'month',
  week: 'week',
  'datetime-local': 'datetime',
  color: 'color',
  range: 'range',
  checkbox: 'checkbox',
  radio: 'radio',
};

/** The WHATWG autofill vocabulary, mapped onto our kinds. */
const BY_AUTOCOMPLETE: Record<string, FieldKind> = {
  'given-name': 'first-name',
  'additional-name': 'first-name',
  'family-name': 'last-name',
  name: 'full-name',
  nickname: 'username',
  username: 'username',
  email: 'email',
  'new-password': 'password',
  'current-password': 'password',
  organization: 'organization',
  'organization-title': 'job-title',
  'street-address': 'street-address',
  'address-line1': 'street-address',
  'address-line2': 'address-line2',
  'address-line3': 'address-line2',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postal-code',
  country: 'country',
  'country-name': 'country',
  bday: 'birth-date',
  tel: 'tel',
  'tel-national': 'tel',
  url: 'url',
  'cc-number': 'credit-card',
  'cc-csc': 'card-cvc',
  'cc-exp': 'card-expiry',
  'cc-name': 'full-name',
};

/** The meaningful token of an `autocomplete` value, ignoring `shipping`/`billing`/`section-*`. */
function autocompleteKind(value: string): FieldKind | null {
  for (const token of value.toLowerCase().split(/\s+/).filter(Boolean)) {
    const kind = BY_AUTOCOMPLETE[token];
    if (kind) return kind;
  }
  return null;
}

// ── the detector ──────────────────────────────────────────────────────────────────────────

/**
 * What should go in this field?
 *
 * Returns `skip` for anything `isFillable` rejects, so a caller can ask one question.
 */
export function detectKind(f: FieldInfo): FieldKind {
  const tag = f.tag;
  if (!isFillable(f)) return 'skip';

  const byText = matchRules(f);

  // 1. The type attribute wins. `checkbox`/`radio`/`select` take their value from the page's
  //    own options, so the text hints cannot change what we do with them either.
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const byType = BY_TYPE[f.type];
    // A `date` named "birthday" is still a birth date, and a `number` named "age" is still an
    // age: the text REFINES the type, it never overrides it. Both still produce a value the
    // type accepts, which is what "the type wins" is protecting.
    if (byType === 'date') return byText === 'birth-date' ? 'birth-date' : 'date';
    if (byType === 'number') return byText === 'age' || byText === 'currency' ? byText : 'number';
    if (byType) return byType;
  }

  // 2. An explicit autocomplete token beats any guess at a name or a class.
  const byAuto = autocompleteKind(f.autocomplete);
  if (byAuto) return byAuto;

  // 3. The words around the field.
  if (byText) return byText;

  // 4. A textarea (or a rich editor) with no other signal wants prose, not a word.
  if (tag === 'textarea' || f.editable) return 'paragraph';
  return 'text';
}

/**
 * First-match-wins over the ordered rule table.
 *
 * Run twice: once over the sources that describe THIS field, and — only if that found nothing —
 * once over `class` alone. A class list is mostly framework noise, so it must never outrank a
 * real label; but on a form whose `name` and `id` are generated hashes it is the only human
 * word left, and it is better than nothing.
 */
function matchRules(f: FieldInfo): FieldKind | null {
  return firstMatch(haystackOf(strongSources(f))) ?? firstMatch(haystackOf([f.className]));
}

function firstMatch({ squashed, words }: Haystack): FieldKind | null {
  for (const rule of RULES) {
    if (rule.word?.some((w) => words.has(w))) return rule.kind;
    if (rule.contains?.some((c) => squashed.includes(c))) return rule.kind;
  }
  return null;
}
