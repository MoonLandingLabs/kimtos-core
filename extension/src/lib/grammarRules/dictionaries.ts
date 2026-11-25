// Data tables for the deterministic grammar/spelling rules. Pure data only — no
// logic — so the word lists and phrase maps can grow without touching rule code.

// Common misspellings → correction (all lowercase keys). Every entry here is rewritten
// ON SIGHT, with no look at the surrounding words, so nothing that is also a real word
// may live in this table — see CONTEXTUAL_MISSPELLINGS below for the ones that are.
// (Corrections containing an apostrophe are the contraction layer's: `cant`, `wont`,
// `lets` and `ill` are ordinary words, but the fix is punctuation, not a different word.)
export const MISSPELLINGS: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  taht: 'that',
  thsi: 'this',
  wich: 'which',
  recieve: 'receive',
  recieved: 'received',
  beleive: 'believe',
  beleived: 'believed',
  seperate: 'separate',
  seperated: 'separated',
  definately: 'definitely',
  occured: 'occurred',
  occuring: 'occurring',
  untill: 'until',
  wierd: 'weird',
  freind: 'friend',
  freinds: 'friends',
  thier: 'their',
  becuase: 'because',
  becasue: 'because',
  accross: 'across',
  alot: 'a lot',
  cant: "can't",
  arguement: 'argument',
  enviroment: 'environment',
  enviroments: 'environments',
  langauge: 'language',
  langauges: 'languages',
  accomodate: 'accommodate',
  accomodation: 'accommodation',
  goverment: 'government',
  neccessary: 'necessary',
  necesary: 'necessary',
  tommorow: 'tomorrow',
  tommorrow: 'tomorrow',
  truely: 'truly',
  publically: 'publicly',
  occassion: 'occasion',
  occassionally: 'occasionally',
  embarass: 'embarrass',
  embarassing: 'embarrassing',
  existance: 'existence',
  persistant: 'persistent',
  independant: 'independent',
  acheive: 'achieve',
  acheived: 'achieved',
  collegue: 'colleague',
  concious: 'conscious',
  curiousity: 'curiosity',
  dilemna: 'dilemma',
  dissapoint: 'disappoint',
  dissapointed: 'disappointed',
  foriegn: 'foreign',
  gaurd: 'guard',
  greatful: 'grateful',
  harrass: 'harass',
  heirarchy: 'hierarchy',
  immediatly: 'immediately',
  knowlege: 'knowledge',
  liason: 'liaison',
  maintainance: 'maintenance',
  maintenence: 'maintenance',
  millenium: 'millennium',
  miniscule: 'minuscule',
  mispell: 'misspell',
  noticable: 'noticeable',
  occurance: 'occurrence',
  occurence: 'occurrence',
  persue: 'pursue',
  posession: 'possession',
  prefered: 'preferred',
  priviledge: 'privilege',
  recomend: 'recommend',
  recommendaton: 'recommendation',
  refered: 'referred',
  relevent: 'relevant',
  religous: 'religious',
  rember: 'remember',
  remeber: 'remember',
  resturant: 'restaurant',
  rythm: 'rhythm',
  succesful: 'successful',
  successfull: 'successful',
  supercede: 'supersede',
  suprise: 'surprise',
  suprised: 'surprised',
  tendancy: 'tendency',
  threshhold: 'threshold',
  usefull: 'useful',
  vaccum: 'vacuum',
  whereever: 'wherever',
  yatch: 'yacht',
  alittle: 'a little',
  everytime: 'every time',
  infront: 'in front',
  inspite: 'in spite',
  ofcourse: 'of course',
  eachother: 'each other',
  aswell: 'as well',
  atleast: 'at least',
  // Irregular plurals (a "-s" that should be an irregular form).
  childs: 'children',
  womans: 'women',
  tooths: 'teeth',
  gooses: 'geese',
  wifes: 'wives',
  lifes: 'lives',
  halfs: 'halves',
  thiefs: 'thieves',
  shelfs: 'shelves',
  hte: 'the',
  wnat: 'want',
  wont: "won't",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  wouldnt: "wouldn't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  hasnt: "hasn't",
  havent: "haven't",
  hadnt: "hadn't",
  youre: "you're",
  theyre: "they're",
  weve: "we've",
  youve: "you've",
  theyve: "they've",
  whats: "what's",
  thats: "that's",
  lets: "let's",
  theres: "there's",
  heres: "here's",
  wheres: "where's",
  hes: "he's",
  shes: "she's",
  im: "I'm",
  ive: "I've",
  ill: "I'll",
  id: "I'd",
};

// Words that almost always need an apostrophe; kept apart from MISSPELLINGS only
// so they can carry a clearer label. (Some duplicate keys above — both resolve to
// the same suggestion, so order doesn't matter.)
export const CONTRACTIONS = new Set([
  'dont',
  'doesnt',
  'didnt',
  'cant',
  'couldnt',
  'shouldnt',
  'wouldnt',
  'wont',
  'isnt',
  'arent',
  'wasnt',
  'werent',
  'hasnt',
  'havent',
  'hadnt',
  'youre',
  'theyre',
  'weve',
  'youve',
  'theyve',
  'whats',
  'thats',
  'lets',
  'theres',
  'heres',
  'wheres',
  'hes',
  'shes',
  'im',
  'ive',
  'ill',
  'id',
]);

// --- Typos that are ALSO real words ------------------------------------------------
//
// Eleven keys used to sit in MISSPELLINGS, which rewrites on sight, and eleven ordinary
// sentences came back wrong: "he wolfs down his dinner" → "he wolves down", "the waiter
// foots the bill" → "feet", "she leafs through the magazine" → "leaves", and NAD the
// coenzyme → AND (#1031). Each is the third-person singular of a real verb, or a real
// noun, as well as a bad plural — and a flat table cannot tell the two apart, so it
// always picked the wrong reading. The shipped dictionary agreed they are words: SCOWL
// has all eleven, so the two layers of Grammit were contradicting each other.
//
// The survivors live here instead, gated the way homophoneRules already gates
// their/there: a fix fires only when a NEIGHBOURING word rules the legitimate reading
// out. The gate is an ALLOWLIST, never a suppression list — an unrecognised context
// means leave it alone. That makes a false positive impossible by construction and
// trades it for a silent miss, which is the failure this layer can afford (rules win
// over the speller and the model on overlap, so a wrong rule fix is the loudest kind).
//
// `calender` (a cloth-pressing machine), `nad` (the coenzyme NAD) and `alright` (which
// modern usage guides accept) are simply gone: no cheap neighbour test separates their
// two readings, and a silent miss beats a confident wrong correction.

/** A typo whose key is also a real English word, so the fix needs a context test. */
export interface ContextualTypo {
  /** The replacement, when the gate opens. */
  fix: string;
  /** Which neighbour the gate reads — the word immediately before, or immediately after. */
  gate: 'before' | 'after';
  /** That neighbour must be one of these, or the token is left alone. */
  context: Set<string>;
}

// Quantifiers that force a plural noun, so the third-person verb reading is impossible:
// "he wolfs down" survives, "two wolfs" does not. Deliberately EXCLUDES a/an/the/this/
// my/your — those also precede a missing-apostrophe possessive ("the wolfs den"), where
// the right fix is "wolf's", not "wolves".
const PLURAL_QUANTIFIERS = new Set([
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'many',
  'several',
  'few',
  'both',
  'these',
  'those',
  'multiple',
  'numerous',
  'various',
]);

// Verbs and prepositions that introduce the conjunction "whether" ("know whether",
// "depends on whether"). A wether is a castrated ram — a noun, which takes a determiner
// — so none of these can precede it.
const WHETHER_BEFORE = new Set([
  'know',
  'knows',
  'knew',
  'known',
  'knowing',
  'see',
  'sees',
  'saw',
  'seen',
  'ask',
  'asks',
  'asked',
  'asking',
  'wonder',
  'wonders',
  'wondered',
  'wondering',
  'decide',
  'decides',
  'decided',
  'deciding',
  'check',
  'checks',
  'checked',
  'checking',
  'tell',
  'tells',
  'told',
  'telling',
  'determine',
  'determines',
  'determined',
  'doubt',
  'doubts',
  'doubted',
  'confirm',
  'confirms',
  'confirmed',
  'consider',
  'considers',
  'considered',
  'considering',
  'discuss',
  'discussed',
  'discussing',
  'unsure',
  'sure',
  'regardless',
  'question',
  'questions',
  'of',
  'on',
  'about',
]);

// Words that follow "paid" in ordinary prose. "out" is deliberately ABSENT: "payed out"
// is the nautical sense (to pay out a rope), the one reading where `payed` is correct.
const PAID_AFTER = new Set([
  'for',
  'the',
  'a',
  'an',
  'me',
  'him',
  'her',
  'them',
  'us',
  'it',
  'my',
  'his',
  'their',
  'our',
  'your',
  'off',
  'in',
  'back',
  'up',
  'cash',
  'extra',
  'more',
  'twice',
  'attention',
  'everything',
  'all',
  'and',
  'that',
  'this',
  'too',
  'dearly',
  'full',
  'half',
  'rent',
  'tax',
  'taxes',
]);

export const CONTEXTUAL_MISSPELLINGS: Record<string, ContextualTypo> = {
  // Irregular plurals that are also third-person singular verbs ("to foot the bill",
  // "to knife open", "to leaf through", "to man the desk", "to mouse", "to wolf down").
  foots: { fix: 'feet', gate: 'before', context: PLURAL_QUANTIFIERS },
  knifes: { fix: 'knives', gate: 'before', context: PLURAL_QUANTIFIERS },
  leafs: { fix: 'leaves', gate: 'before', context: PLURAL_QUANTIFIERS },
  mans: { fix: 'men', gate: 'before', context: PLURAL_QUANTIFIERS },
  mouses: { fix: 'mice', gate: 'before', context: PLURAL_QUANTIFIERS },
  wolfs: { fix: 'wolves', gate: 'before', context: PLURAL_QUANTIFIERS },
  // Homographs of a different shape: a real noun, and a real past tense.
  wether: { fix: 'whether', gate: 'before', context: WHETHER_BEFORE },
  payed: { fix: 'paid', gate: 'after', context: PAID_AFTER },
};

// "a" → "an" exceptions: vowel-letter words that take "a" (consonant sound).
export const A_BEFORE_VOWEL = /^(uni|use|usu|ubi|euro|eul|once|one|ouija|ewe|ufo)/i;
// "an" → "a" exceptions: consonant-letter words that take "an" (silent h, etc.).
export const AN_BEFORE_CONSONANT = /^(hour|honest|honor|honour|heir)/i;

// Repeated word: a few words can legitimately double ("had had", "that that"), so
// those are skipped to avoid false positives.
export const OK_TO_REPEAT = new Set(['had', 'that', 'is', 'no', 'ha', 'so', 'blah']);

// Conjunctive adverbs that take a comma when they OPEN a sentence ("Therefore, we…").
// Deliberately conservative — every entry is UNAMBIGUOUSLY a connector here. "However" is
// excluded on purpose: it doubles as a manner adverb ("However you slice it, …") where a
// comma would be wrong. Keeping this list tight is what keeps the rule false-positive-free.
export const INTRO_ADVERBS = new Set([
  'also',
  'therefore',
  'moreover',
  'furthermore',
  'consequently',
  'nevertheless',
  'nonetheless',
  'additionally',
  'meanwhile',
]);

// Fixed multi-word fixes (subject–verb agreement, common ESL phrasings). Keys are
// lowercase; spaces match any run of whitespace. Every entry here is rewritten ON
// SIGHT, with no look at the surrounding words, so no key may have ANY valid English
// reading — see CONTEXTUAL_PHRASES below for the ones that do. The bar is enforced,
// not advisory: every key must be declared `never:` in data/phrase-readings.txt, and
// phrases.test.ts fails on an undeclared one, so a new entry cannot skip the review
// this table used to take on trust (#1051).
export const PHRASES: Record<string, string> = {
  // be / do agreement. Three families this table used to carry are deliberately gone:
  // - 'i were' / 'he were' / 'she were' / 'it were' — the subjunctive uses exactly
  //   these sequences, correctly and commonly ("If I were you", "I wish it were
  //   true", "as it were"), and no one-word neighbour test separates it from the
  //   indicative error ("I wish that I were" defeats any trigger-word list).
  // - 'he have' / 'she have' / 'it have' — every question and modal contains them
  //   validly ("Does he have a car?", "Should he have known?"); agreementRules
  //   already conjugates the real error with an aux guard, so the flat entries only
  //   ever added the false positives.
  // - 'people is' / 'people was' — free relatives ("What worries most people is
  //   inflation") and quantity subjects ("that many people is a crowd") are valid.
  'he are': 'he is',
  'she are': 'she is',
  'it are': 'it is',
  'they is': 'they are',
  'they was': 'they were',
  'we is': 'we are',
  'we was': 'we were',
  'you is': 'you are',
  'you was': 'you were',
  // negated third-person aux (the conjugator below handles plain base verbs)
  'he dont': "he doesn't",
  'she dont': "she doesn't",
  'it dont': "it doesn't",
  "he don't": "he doesn't",
  "she don't": "she doesn't",
  "it don't": "it doesn't",
  // redundant comparatives / superlatives (safe because phraseRules refuses to fire
  // into a hyphenated compound — "more higher-quality data" is valid English)
  'more better': 'better',
  'more easier': 'easier',
  'more faster': 'faster',
  'more taller': 'taller',
  'more smarter': 'smarter',
  'more bigger': 'bigger',
  'more older': 'older',
  'more younger': 'younger',
  'more higher': 'higher',
  'more longer': 'longer',
  'more stronger': 'stronger',
  'more happier': 'happier',
  'more worse': 'worse',
  'most best': 'best',
  'most worst': 'worst',
  'more better than': 'better than',
  // The quantifier entries ('much people', 'much things', 'much times', 'less
  // people', 'less things', 'less books') are gone: degree clauses ("how much people
  // care", "how much times have changed") and comparative correlatives ("the less
  // people know, the better") are ordinary English, and rewriting them changes the
  // meaning. less+plural is style, not error, anyway.
  // (homophones like your/you're, its/it's, their/there and "to/too", plus
  // "could of", are handled contextually by homophoneRules/modalRules below.)
  // Of the ESL verb/preposition phrasings, only the ones with no valid reading stay
  // flat; 'said me' and friends are gated below. 'married with' is gone (the issue's
  // own "married with two kids", and no pronoun gate survives "we got married with
  // them present"), 'discuss about' too ("a lot to discuss about the merger" is
  // valid, and the rewrite mangled it), and 'good in english' ("her grades are good
  // in English and maths").
};

// --- Phrases that are ALSO valid English --------------------------------------------
//
// The same defect shape as CONTEXTUAL_MISSPELLINGS above, one level up (#1051, the
// sibling of #1031): PHRASES rewrites on sight, and several of its keys had a
// legitimate reading, so textbook-correct sentences came back "fixed" — "If I were
// you" became "If I was you" (breaking the subjunctive), "He said her name" became
// "He told her name", "There is many a slip" became "There are many a slip".
//
// The survivors with a cheap one-word context test live here. Two gate modes:
//
// - 'allow': fire ONLY when the neighbouring word is in `words` — the allowlist shape
//   of CONTEXTUAL_MISSPELLINGS, for entries whose valid readings are open-ended
//   ("said them aloud", "said me being late was the problem"). An unrecognised
//   context leaves the text alone, so a false positive is impossible by construction.
// - 'block': fire UNLESS the neighbouring word is in `words`. ONLY permissible when
//   the legitimate readings form a CLOSED set — a fixed idiom ("there is many a
//   slip", "it depends of course on") — because anything outside the set is rewritten.
//   An entry must not use 'block' against an open class; that is what dropping is for.
//
// Either way, phrases.test.ts requires a fixture sentence per key whose valid reading
// stays clean, so the gate is proven, not asserted.

/** A phrase fix that needs a context test because the phrase can be valid English. */
export interface ContextualPhrase {
  /** The replacement, when the gate lets the fix through. */
  fix: string;
  /** Which neighbour the gate reads — the word immediately before or after the phrase. */
  gate: 'before' | 'after';
  /** 'allow': fire only when the neighbour is in `words`. 'block': fire unless it is. */
  mode: 'allow' | 'block';
  words: Set<string>;
  /** block-mode only: also hold fire when the raw neighbour is Capitalized — a proper
   *  noun or Roman-numeral head ("World War I is", "drugs on Schedule I are"). */
  blockCapitalized?: boolean;
}

// Complement openers after "said <object>" that force the report reading ("he said me
// that he was tired" → "told me that…"). Deliberately EXCLUDES 'to': "he repeated the
// words and said them to himself" is valid English. The open valid readings this
// allowlist protects: 'said her' + noun ("said her name"), 'said them' + adverb ("said
// them aloud"), and the accusative gerund ("he said me being late was the problem").
const SAID_REPORT_AFTER = new Set([
  'that',
  'about',
  'what',
  'why',
  'how',
  'where',
  'when',
  'if',
  'everything',
  'nothing',
  'something',
  'anything',
]);

// Words after "explain me" that force the dative-object error ("explain me the rules"
// → "explain to me the rules"). "explain me to your parents" — me as the thing being
// explained — is valid, which is why this is an allowlist and 'to' is not in it.
const EXPLAIN_TO_AFTER = new Set([
  'the',
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'its',
  'everything',
  'something',
]);

// Nouns whose mention turns a following "I" into the letter/pronoun-as-noun reading
// ("the letter I is the ninth", "the pronoun I is overused"). Shared with
// agreementRules, which has the same Roman-numeral blind spot ("Part I has three
// chapters" is not a conjugation error).
export const I_NOUN_BEFORE = new Set(['letter', 'word', 'pronoun', 'vowel', 'character']);

// What shuts the 'i is' / 'i are' gates: the named-letter nouns above, plus the
// coordinating conjunctions — a coordinated subject conjugates as a plural, so "my
// family and I are happy" is correct and "my family and I is" wants "are", not "am".
// Same reason AGREEMENT_BLOCKERS lists them for the conjugator.
const I_AM_BEFORE_BLOCK = new Set([...I_NOUN_BEFORE, 'and', 'or', 'nor']);

export const CONTEXTUAL_PHRASES: Record<string, ContextualPhrase> = {
  // "I is/are" is almost always the agreement error — EXCEPT when "I" is a Roman
  // numeral or a named letter, which a Capitalized head word signals ("World War I
  // is studied", "drugs on Schedule I are controlled"), and EXCEPT after a
  // coordinating conjunction, where "and I are" is correct and "and I is" wants
  // "are" — a fix this entry cannot offer, so it holds fire.
  'i is': { fix: 'I am', gate: 'before', mode: 'block', words: I_AM_BEFORE_BLOCK, blockCapitalized: true },
  'i are': { fix: 'I am', gate: 'before', mode: 'block', words: I_AM_BEFORE_BLOCK, blockCapitalized: true },
  // say/tell confusion, gated on the complement that follows the object.
  'said me': { fix: 'told me', gate: 'after', mode: 'allow', words: SAID_REPORT_AFTER },
  'said him': { fix: 'told him', gate: 'after', mode: 'allow', words: SAID_REPORT_AFTER },
  'said her': { fix: 'told her', gate: 'after', mode: 'allow', words: SAID_REPORT_AFTER },
  'said them': { fix: 'told them', gate: 'after', mode: 'allow', words: SAID_REPORT_AFTER },
  'explain me': { fix: 'explain to me', gate: 'after', mode: 'allow', words: EXPLAIN_TO_AFTER },
  // The one valid "there is/was many" is the fixed idiom "many a" — a closed set.
  'there is many': { fix: 'there are many', gate: 'after', mode: 'block', words: new Set(['a']) },
  'there was many': { fix: 'there were many', gate: 'after', mode: 'block', words: new Set(['a']) },
  // The one valid "depends of" is the interjected idiom "depends of course on".
  'depends of': { fix: 'depends on', gate: 'after', mode: 'block', words: new Set(['course']) },
  'depend of': { fix: 'depend on', gate: 'after', mode: 'block', words: new Set(['course']) },
};

// Common base-form verbs for subject–verb agreement. Deliberately EXCLUDES verbs
// whose past tense equals the base (set/put/cut/read/hit/let/cost/hurt/quit…) so
// "he set the table" (valid past) is never "corrected".
export const BASE_VERBS = new Set([
  'go',
  'do',
  'have',
  'say',
  'make',
  'take',
  'get',
  'know',
  'think',
  'see',
  'come',
  'want',
  'look',
  'use',
  'find',
  'give',
  'tell',
  'work',
  'call',
  'try',
  'ask',
  'need',
  'feel',
  'become',
  'leave',
  'mean',
  'keep',
  'begin',
  'help',
  'talk',
  'turn',
  'start',
  'show',
  'hear',
  'play',
  'move',
  'like',
  'live',
  'believe',
  'bring',
  'happen',
  'write',
  'provide',
  'lose',
  'pay',
  'meet',
  'include',
  'continue',
  'learn',
  'change',
  'lead',
  'watch',
  'follow',
  'stop',
  'create',
  'speak',
  'spend',
  'grow',
  'open',
  'walk',
  'win',
  'teach',
  'offer',
  'remember',
  'consider',
  'appear',
  'buy',
  'serve',
  'die',
  'send',
  'build',
  'stay',
  'fall',
  'reach',
  'remain',
  'eat',
  'drink',
  'drive',
  'wear',
  'choose',
  'carry',
  'wash',
  'push',
  'pull',
  'enjoy',
  'explain',
  'decide',
  'hope',
  'expect',
  'agree',
  'support',
  'study',
  'cover',
  'listen',
  'finish',
  'miss',
  'fail',
  'marry',
  'prepare',
  'worry',
  'repeat',
  'arrive',
  'contain',
  'belong',
  'attend',
  'complete',
  'describe',
  'discover',
  'prefer',
  'succeed',
  'travel',
  'cook',
  'clean',
  'cry',
  'fix',
  'kick',
  'jump',
  'sleep',
  'smile',
  'laugh',
  'dance',
  'sing',
  'draw',
  'paint',
  'climb',
  'catch',
  'throw',
  'fly',
  'swim',
  'ride',
  'sit',
  'stand',
  'run',
  'love',
  'hate',
  'wish',
  'seem',
  'matter',
  'mind',
]);

// Words that, before the subject, make a following base verb CORRECT — questions
// ("does he go"), modals ("would she like"), and subjunctive ("demand that he go").
export const AGREEMENT_BLOCKERS = new Set([
  'would',
  'will',
  'could',
  'should',
  'can',
  'may',
  'might',
  'must',
  'shall',
  'do',
  'does',
  'did',
  'to',
  'that',
  'lest',
  "don't",
  "doesn't",
  "didn't",
  'not',
  'and',
  'or',
  'nor',
]);

// Comparative words after which "then" should be "than".
export const COMPARATIVES = new Set([
  'more',
  'less',
  'better',
  'worse',
  'rather',
  'other',
  'greater',
  'fewer',
  'larger',
  'smaller',
  'bigger',
  'taller',
  'shorter',
  'older',
  'younger',
  'higher',
  'lower',
  'longer',
  'stronger',
  'weaker',
  'faster',
  'slower',
  'richer',
  'poorer',
  'happier',
  'easier',
  'harder',
  'cheaper',
  'closer',
  'deeper',
  'wider',
  'warmer',
  'colder',
  'hotter',
  'cooler',
  'darker',
  'lighter',
  'heavier',
  'earlier',
  'later',
  'sooner',
  'nicer',
  'smarter',
  'cleaner',
  'safer',
]);

// Second-negative words that resolve a double negative, and their "any" form.
export const INDEFINITE_TO_ANY: Record<string, string> = {
  nothing: 'anything',
  nobody: 'anybody',
  noone: 'anyone',
  nowhere: 'anywhere',
  none: 'any',
  neither: 'either',
  never: 'ever',
};

// Contextual homophones (their/there, your/you're, its/it's, to/too) — the
// signature of a pre-AI grammar checker. We only flip a word when the FOLLOWING
// word makes the possessive/infinitive reading impossible, so these stay safe:
// "your dog" is left alone, but "your dog is cute"… "your the best" → "you're".
export const YOURE_AFTER = new Set([
  'welcome',
  'gonna',
  'the',
  'a',
  'an',
  'not',
  'too',
  'very',
  'really',
  'always',
  'never',
  'just',
  'going',
  'getting',
  'being',
  'doing',
  'definitely',
  'probably',
  'so',
  'still',
]);
export const ITS_AFTER = new Set([
  'a',
  'an',
  'the',
  'not',
  'been',
  'going',
  'gonna',
  'too',
  'very',
  'really',
  'just',
  'always',
  'never',
  'ok',
  'okay',
  'raining',
  'snowing',
  'important',
  'possible',
  'clear',
  'true',
  'here',
  'there',
  'so',
  'still',
  'because',
  'getting',
]);
export const THERE_AFTER = new Set(['is', 'are', 'was', 'were', 'has', 'have', 'will', 'would']); // existential "there"
export const THEYRE_AFTER = new Set(['going', 'gonna', 'coming', 'not', 'always', 'just', 'still', 'here']);
export const TOO_AFTER = new Set([
  'much',
  'many',
  'late',
  'early',
  'big',
  'small',
  'hard',
  'easy',
  'fast',
  'slow',
  'far',
  'soon',
  'often',
  'tired',
  'busy',
  'expensive',
  'cheap',
  'hot',
  'cold',
  'long',
  'short',
  'high',
  'low',
  'old',
  'young',
  'heavy',
  'loud',
  'quiet',
  'little',
  'good',
  'bad',
  'close',
]);
