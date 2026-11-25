// Kind -> value. The other half of the substance: `detect.ts` decides WHAT a field wants,
// this decides what to put in it.
//
// Two things make the output believable rather than random:
//
//   • ONE PERSON PER FILL. The context carries a single person and a single address, so the
//     first name, the last name, the full name, the e-mail and the username on a form all
//     agree. A form where "Nadia Vogel" lives next to "t.okafor@example.org" is noise, and
//     noise is exactly what the tester was trying to escape.
//   • THE FIELD'S OWN CONSTRAINTS ARE HONOURED. `maxlength`, `min`, `max` and `step` come from
//     the page, and a value that violates them fails the form's validation — which makes the
//     filler worse than useless, because now you are debugging the filler.
//
// Pure: no DOM, no storage, no network.

import {
  address as makeAddress,
  createRng,
  creditCardNumber,
  dateNear,
  hexColor,
  isoDate,
  numberIn,
  paragraph,
  password,
  person as makePerson,
  randomSeed,
  sentence,
  timeOfDay,
  url as makeUrl,
  uuidV4,
  words,
  type Address,
  type Person,
  type Rng,
} from '../fakeData.js';
import type { FieldInfo, FieldKind } from './detect.js';

export interface FillContext {
  /** The seed this fill was built from — reported so a fill can be reproduced exactly. */
  seed: number;
  rng: Rng;
  person: Person;
  address: Address;
  /** "Today", injected so date logic is testable rather than clock-dependent. */
  now: Date;
}

export function createFillContext(seed: number = randomSeed(), now: Date = new Date()): FillContext {
  const rng = createRng(seed);
  return { seed, rng, person: makePerson(rng), address: makeAddress(rng), now };
}

/** Kinds whose value comes from the page's own options, not from a generator. */
const FROM_PAGE: ReadonlySet<FieldKind> = new Set(['select', 'checkbox', 'radio', 'skip']);

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A finite number from an attribute, or the fallback when it is absent or nonsense. */
const num = (raw: string, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The value for one field. Returns `null` when the kind takes its value from the page
 * (`select`/`checkbox`/`radio`) or when the field must not be touched at all.
 */
export function valueFor(kind: FieldKind, f: FieldInfo, ctx: FillContext): string | null {
  if (FROM_PAGE.has(kind)) return null;
  return applyMaxLength(rawValue(kind, f, ctx), f.maxLength);
}

/**
 * Truncate to `maxlength`.
 *
 * A browser silently truncates a typed value, but a script-set one is NOT truncated — it is
 * simply invalid, and the form rejects it on submit with a message the tester then has to
 * chase. Cutting it here is the difference between a filler that works on a real app's form
 * and one that works on a demo.
 */
function applyMaxLength(value: string, maxLength: number): string {
  return maxLength > 0 && value.length > maxLength ? value.slice(0, maxLength) : value;
}

function rawValue(kind: FieldKind, f: FieldInfo, ctx: FillContext): string {
  const { rng, person, address, now } = ctx;
  switch (kind) {
    case 'email':
      return person.email;
    case 'password':
      // Long enough for the usual policy, but never longer than the field allows.
      return password(rng, f.maxLength > 0 ? Math.min(14, f.maxLength) : 14);
    case 'tel':
      return person.phone;
    case 'url':
      return makeUrl(rng);
    case 'search':
      return words(rng, rng.int(1, 3));
    case 'first-name':
      return person.first;
    case 'last-name':
      return person.last;
    case 'full-name':
      return person.full;
    case 'username':
      return person.username;
    case 'organization':
      return person.organization;
    case 'job-title':
      return person.jobTitle;
    case 'street-address':
      return address.line1;
    case 'address-line2':
      return address.line2 || `Apt ${rng.int(1, 40)}`;
    case 'city':
      return address.city;
    case 'region':
      return address.region;
    case 'postal-code':
      return address.postalCode;
    case 'country':
      return address.country;
    case 'birth-date':
      return person.birthDate;
    case 'date':
      return isoDate(clampDate(dateNear(rng, now, -365, 365), f));
    case 'datetime':
      return `${isoDate(clampDate(dateNear(rng, now, -30, 90), f))}T${timeOfDay(rng)}`;
    case 'time':
      return timeOfDay(rng);
    case 'month':
      return `${now.getFullYear()}-${pad2(rng.int(1, 12))}`;
    case 'week':
      return `${now.getFullYear()}-W${pad2(rng.int(1, 52))}`;
    case 'number':
      return numberIn(rng, num(f.min, 1), num(f.max, 100), decimalsOf(f.step));
    case 'range':
      return numberIn(rng, num(f.min, 0), num(f.max, 100), decimalsOf(f.step));
    case 'age':
      return numberIn(rng, num(f.min, 18), num(f.max, 80));
    case 'currency':
      return numberIn(rng, num(f.min, 5), num(f.max, 5000), 2);
    case 'color':
      return hexColor(rng);
    case 'credit-card':
      return creditCardNumber(rng);
    case 'card-cvc':
      return String(rng.int(100, 999));
    case 'card-expiry':
      // MM/YY — what a text expiry box expects. A real `month` input is caught by its type.
      return `${pad2(rng.int(1, 12))}/${pad2((now.getFullYear() + rng.int(1, 5)) % 100)}`;
    case 'uuid':
      return uuidV4();
    case 'ip-address':
      // 198.51.100.0/24 is reserved for documentation (RFC 5737) — a real address here could
      // send a tester's traffic somewhere that exists.
      return `198.51.100.${rng.int(1, 254)}`;
    case 'paragraph':
      return paragraph(rng, rng.int(2, 4));
    default:
      // `text` and anything new that has not earned its own generator: a short phrase, which
      // reads as filler in a review rather than as a value somebody meant.
      return sentence(rng, 2, 5).replace(/\.$/, '');
  }
}

/** How many decimals a `step` implies — `0.01` means two, `1` and an absent step mean none. */
function decimalsOf(step: string): number {
  const dot = step.indexOf('.');
  return dot < 0 ? 0 : step.length - dot - 1;
}

/** Keep a generated date inside the field's own `min`/`max`, when it declares them. */
function clampDate(d: Date, f: FieldInfo): Date {
  const min = Date.parse(f.min);
  const max = Date.parse(f.max);
  let t = d.getTime();
  if (Number.isFinite(min) && t < min) t = min;
  if (Number.isFinite(max) && t > max) t = max;
  return new Date(t);
}
