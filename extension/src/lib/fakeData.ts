// Believable fake data, invented on the device.
//
// One home for every "make something up" primitive in the suite. DevTools' Lorem ipsum and
// UUID tools were the first two and used to live in `apps/devtools/lib.ts`; FakeForm needs
// those plus names, addresses, phone numbers and the rest, so they moved here rather than
// being copied (#222). DevTools re-exports them, so its own API is unchanged.
//
// Two properties this module is built around:
//
//   • SEEDED. Every generator takes an `Rng` created from a number, so the same seed always
//     produces the same person. That is what makes a form filler testable at all — otherwise
//     the only assertion you can write is "it is a string".
//   • HARMLESS. The values look real but cannot reach anyone real: e-mail hosts are the
//     RFC 2606 reserved `example.*` domains, and phone numbers use the 555-01xx range
//     reserved for fiction. A developer testing a signup form must not be able to mail or
//     ring a stranger by accident.
//
// Nothing here touches the network, the DOM or storage — it is pure, so it bundles into a
// content script and runs in a unit test unchanged.

import { clamp } from './num.js';

// ── the seeded generator ──────────────────────────────────────────────────────────────────

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** One item from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p` (default 0.5). */
  chance(p?: number): boolean;
}

/** A fresh unpredictable seed. `crypto` is available in every context this runs in. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Deliberately NOT `Math.random()`: the values here are not security-sensitive, and being
 * able to replay a fill from its seed is worth far more than unpredictability. `randomSeed()`
 * is what makes an unseeded call unpredictable.
 */
export function createRng(seed: number = randomSeed()): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
    chance: (p = 0.5): boolean => next() < p,
  };
}

// ── datasets ──────────────────────────────────────────────────────────────────────────────
//
// Compact on purpose. These bundle into a content script, so the whole set is a few kB —
// there is no `faker` dependency and there never will be one (megabytes, in a single IIFE).

const FIRST_NAMES = [
  'Ada',
  'Amara',
  'Aiden',
  'Amelia',
  'Arjun',
  'Beatrix',
  'Callum',
  'Camila',
  'Chen',
  'Clara',
  'Damian',
  'Dalia',
  'Elena',
  'Elias',
  'Esther',
  'Farid',
  'Freya',
  'Gabriel',
  'Greta',
  'Hana',
  'Harold',
  'Ibrahim',
  'Imani',
  'Isla',
  'Jonas',
  'Josephine',
  'Kai',
  'Karim',
  'Lars',
  'Leila',
  'Lucia',
  'Mahmoud',
  'Marcus',
  'Mira',
  'Nadia',
  'Nikolai',
  'Nour',
  'Olive',
  'Omar',
  'Priya',
  'Rafael',
  'Rania',
  'Rosa',
  'Samuel',
  'Sanne',
  'Selim',
  'Sofia',
  'Tariq',
  'Theo',
  'Tomas',
  'Ursula',
  'Vera',
  'Viktor',
  'Wesley',
  'Yara',
  'Yusuf',
  'Zainab',
  'Zoe',
] as const;

const LAST_NAMES = [
  'Abbott',
  'Almeida',
  'Andersen',
  'Bakker',
  'Bellamy',
  'Cardoso',
  'Castillo',
  'Chowdhury',
  'Dalgaard',
  'Devereux',
  'Eriksen',
  'Fairbanks',
  'Farouk',
  'Gallagher',
  'Ghosh',
  'Halvorsen',
  'Hassanein',
  'Ibarra',
  'Ivanova',
  'Jansen',
  'Kaur',
  'Kowalski',
  'Larsen',
  'Lindqvist',
  'Marchetti',
  'Mbeki',
  'Nakamura',
  'Novotny',
  'Okafor',
  'Oliveira',
  'Pereira',
  'Quinlan',
  'Rahman',
  'Ramirez',
  'Sorensen',
  'Steadman',
  'Takahashi',
  'Thorne',
  'Ueda',
  'Vasquez',
  'Vogel',
  'Whitfield',
  'Yilmaz',
  'Zielinski',
] as const;

const STREET_NAMES = [
  'Alder',
  'Birchwood',
  'Bramble',
  'Cedar',
  'Chapel',
  'Clover',
  'Dovecote',
  'Elmfield',
  'Foxglove',
  'Granary',
  'Hazel',
  'Ironbridge',
  'Juniper',
  'Kestrel',
  'Larkspur',
  'Maple',
  'Meridian',
  'Nightingale',
  'Orchard',
  'Pembroke',
  'Quarry',
  'Redwood',
  'Saffron',
  'Sycamore',
  'Thistle',
  'Tanner',
  'Vintners',
  'Willowbank',
  'Yarrow',
] as const;

const STREET_TYPES = ['Street', 'Avenue', 'Road', 'Lane', 'Terrace', 'Close', 'Drive', 'Way', 'Court'] as const;

const CITIES = [
  'Ashford',
  'Bellhaven',
  'Brackenridge',
  'Cranfield',
  'Dunmore',
  'Eastgate',
  'Fairwater',
  'Glenhaven',
  'Harrowgate',
  'Innisfree',
  'Kirkstall',
  'Lakemont',
  'Marlowe',
  'Northbrook',
  'Oakhurst',
  'Pinecrest',
  'Ravenswood',
  'Southport',
  'Thornbury',
  'Westmere',
] as const;

const REGIONS = [
  'Avonshire',
  'Belmont',
  'Cascadia',
  'Dunhill',
  'Eastmarch',
  'Fernvale',
  'Greendale',
  'Highmoor',
  'Kingsmere',
  'Lakeshire',
  'Middlefield',
  'Norwood',
  'Redhill',
  'Silverdale',
  'Westland',
] as const;

const COUNTRIES = [
  'Australia',
  'Belgium',
  'Brazil',
  'Canada',
  'Denmark',
  'Egypt',
  'Finland',
  'France',
  'Germany',
  'Ireland',
  'Italy',
  'Japan',
  'Kenya',
  'Mexico',
  'Netherlands',
  'New Zealand',
  'Norway',
  'Poland',
  'Portugal',
  'Singapore',
  'South Africa',
  'Spain',
  'Sweden',
  'Switzerland',
  'United Kingdom',
  'United States',
] as const;

const COMPANY_HEADS = [
  'Alderway',
  'Beacon',
  'Cobalt',
  'Driftwood',
  'Everline',
  'Foundry',
  'Granite',
  'Halcyon',
  'Ironvale',
  'Juniper',
  'Kestrel',
  'Lantern',
  'Meridian',
  'Northwind',
  'Overtone',
  'Pinegrove',
  'Quarry',
  'Rivet',
  'Summit',
  'Tidewater',
  'Umbra',
  'Vantage',
  'Westbourne',
] as const;

const COMPANY_TAILS = ['Labs', 'Systems', 'Works', 'Group', 'Studio', 'Collective', 'Partners', 'Industries'] as const;

const JOB_TITLES = [
  'Product Designer',
  'Software Engineer',
  'Data Analyst',
  'Operations Lead',
  'Support Specialist',
  'Technical Writer',
  'QA Engineer',
  'Account Manager',
  'Research Scientist',
  'Site Reliability Engineer',
  'Marketing Manager',
] as const;

/**
 * RFC 2606 reserves these for documentation and testing: they resolve nowhere and can never be
 * delivered to. A form filler must not be able to send mail to a real address by accident, so
 * this list stays reserved-only — do not add a real host to it.
 */
const EMAIL_HOSTS = ['example.com', 'example.org', 'example.net'] as const;

const LOREM_WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

// ── people ────────────────────────────────────────────────────────────────────────────────

export interface Person {
  first: string;
  last: string;
  full: string;
  username: string;
  email: string;
  phone: string;
  jobTitle: string;
  organization: string;
  /** ISO `YYYY-MM-DD`, an adult between 21 and 65. */
  birthDate: string;
}

/** Strip accents/punctuation and lowercase — for deriving a username or a mailbox from a name. */
const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * One coherent person. The e-mail and username are DERIVED from the name, which is the whole
 * difference between believable data and random noise: a form filled with "Nadia Vogel" and
 * "qx7f@example.com" reads as junk, and a reviewer looking at the filled form learns nothing.
 */
export function person(rng: Rng): Person {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const username = `${slug(first)}.${slug(last)}`;
  return {
    first,
    last,
    full: `${first} ${last}`,
    username,
    email: `${username}@${rng.pick(EMAIL_HOSTS)}`,
    phone: phoneNumber(rng),
    jobTitle: rng.pick(JOB_TITLES),
    organization: `${rng.pick(COMPANY_HEADS)} ${rng.pick(COMPANY_TAILS)}`,
    birthDate: isoDate(shiftYears(new Date(), -rng.int(21, 65), rng)),
  };
}

/**
 * A North American number in the **555-01xx** block, which the NANP reserves for fiction
 * precisely so it can be printed and dialled without reaching anybody. Same reasoning as the
 * `example.*` e-mail hosts: the data has to be safe to actually submit.
 */
export function phoneNumber(rng: Rng): string {
  return `+1 (${rng.int(201, 989)}) 555-01${String(rng.int(0, 99)).padStart(2, '0')}`;
}

// ── places ────────────────────────────────────────────────────────────────────────────────

export interface Address {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export function address(rng: Rng): Address {
  return {
    line1: `${rng.int(1, 4820)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_TYPES)}`,
    line2: rng.chance(0.35) ? `Apt ${rng.int(1, 40)}${rng.pick(['A', 'B', 'C', ''])}`.trim() : '',
    city: rng.pick(CITIES),
    region: rng.pick(REGIONS),
    postalCode: String(rng.int(10000, 99999)),
    country: rng.pick(COUNTRIES),
  };
}

// ── text ──────────────────────────────────────────────────────────────────────────────────

/** `n` lorem words, seeded. */
export function words(rng: Rng, n: number): string {
  const count = clamp(Math.round(n) || 1, 1, 200);
  return Array.from({ length: count }, () => rng.pick(LOREM_WORDS)).join(' ');
}

const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One lorem sentence, capitalised and full-stopped. */
export function sentence(rng: Rng, minWords = 6, maxWords = 14): string {
  return `${sentenceCase(words(rng, rng.int(minWords, maxWords)))}.`;
}

/** A short lorem paragraph — what a `<textarea>` gets. */
export function paragraph(rng: Rng, sentences = 3): string {
  return Array.from({ length: clamp(sentences, 1, 12) }, () => sentence(rng)).join(' ');
}

/**
 * Lorem ipsum paragraphs — DevTools' generator, unchanged and deliberately deterministic
 * (index-driven, no RNG): the tool exists to produce the same familiar block of filler every
 * time, not a different one per click.
 */
export function lorem(paragraphs: number): string {
  const n = clamp(Math.round(paragraphs) || 1, 1, 20);
  const out: string[] = [];
  for (let p = 0; p < n; p += 1) {
    const len = 40 + ((p * 17) % 30);
    const w: string[] = [];
    for (let i = 0; i < len; i += 1) w.push(LOREM_WORDS[(p * 7 + i * 3) % LOREM_WORDS.length] as string);
    let text = w.join(' ');
    text = text.replace(/(^|\. )([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());
    out.push(text + '.');
  }
  return out.join('\n\n');
}

export const uuidV4 = (): string => crypto.randomUUID();

// ── identifiers, numbers, dates ───────────────────────────────────────────────────────────

const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — a tester has to be able to read it back
const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_DIGIT = '23456789';
const PASSWORD_SYMBOL = '!@#$%&*?-_';

/**
 * A password that satisfies the usual "upper + lower + digit + symbol, 12 chars" policy, so the
 * form under test actually accepts it. Ambiguous glyphs (0/O, 1/l/I) are left out because the
 * whole point is that the tester can read it off the screen and log back in.
 */
export function password(rng: Rng, length = 14): string {
  const len = clamp(length, 8, 64);
  const required = [
    rng.pick([...PASSWORD_UPPER]),
    rng.pick([...PASSWORD_LOWER]),
    rng.pick([...PASSWORD_DIGIT]),
    rng.pick([...PASSWORD_SYMBOL]),
  ];
  const pool = [...PASSWORD_UPPER, ...PASSWORD_LOWER, ...PASSWORD_DIGIT, ...PASSWORD_SYMBOL];
  const rest = Array.from({ length: len - required.length }, () => rng.pick(pool));
  const chars = [...required, ...rest];
  // Fisher-Yates, so the required characters are not always the first four.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

/** A believable https URL on a reserved documentation domain. */
export function url(rng: Rng): string {
  return `https://www.${rng.pick(EMAIL_HOSTS)}/${slug(rng.pick(COMPANY_HEADS))}`;
}

/** `#rrggbb`, which is the only form `<input type="color">` accepts. */
export function hexColor(rng: Rng): string {
  return `#${rng.int(0, 0xffffff).toString(16).padStart(6, '0')}`;
}

/** An integer in range, or a decimal when `decimals > 0`. */
export function numberIn(rng: Rng, min: number, max: number, decimals = 0): string {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const value = lo + rng.next() * (hi - lo);
  return decimals > 0 ? value.toFixed(clamp(decimals, 0, 6)) : String(Math.round(value));
}

/** The Luhn check digit for a partial card number. */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true; // the check digit will be appended, so the last given digit is doubled
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    double = !double;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * A Luhn-valid 16-digit card number on the `4` (Visa) prefix. It has to pass the form's own
 * validation or the field is useless — but it is not a live card and no issuer will accept it.
 */
export function creditCardNumber(rng: Rng): string {
  let body = '4';
  while (body.length < 15) body += String(rng.int(0, 9));
  return body + String(luhnCheckDigit(body));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local terms — never `toISOString()`, which shifts the day across a timezone. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Move a date by whole years, landing on a random month/day so birthdays are not all in January. */
function shiftYears(from: Date, years: number, rng: Rng): Date {
  return new Date(from.getFullYear() + years, rng.int(0, 11), rng.int(1, 28));
}

/** A date `minDays`–`maxDays` away from `from` (negative for the past). */
export function dateNear(rng: Rng, from: Date, minDays: number, maxDays: number): Date {
  const day = 86400000;
  return new Date(from.getTime() + rng.int(minDays, maxDays) * day);
}

/** `HH:MM`, on a five-minute boundary, inside working hours. */
export function timeOfDay(rng: Rng): string {
  return `${pad2(rng.int(8, 19))}:${pad2(rng.int(0, 11) * 5)}`;
}
