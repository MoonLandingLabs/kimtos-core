// The checker that holds the privacy page to what the extension actually does, checked against
// the violations it exists to catch and the honest declarations it must not reject.
//
// It had no tests at all, which is the worst place in this repo for that to be true: it is the
// only thing standing between an undisclosed outbound path and a green build, and it had already
// let one through. `html.duckduckgo.com` sat in the declared list as `told: 'NOT TOLD'` — KimtAI's
// web_search tool posting chat-derived queries to a third party while the store listing promised
// the user's data never leaves their browser — and the checker printed a friendly note about it
// and exited 0 for months (#885, #886).
//
// So the first test below is that exact entry. If a change to the judgement stops flagging it,
// the guard has stopped doing the one job it was written for.
//
//   node --test scripts/*.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentToolIssues,
  balanced,
  declaresAgentTools,
  disclosureIssues,
  endOfString,
  literalValue,
  settingsSchema,
  stripComments,
  subprocessorNames,
} from './check-network-hosts.mjs';
import { NETWORK_HOSTS } from './network-hosts.mjs';

// A stand-in for the real surfaces. Small enough to read, and every phrase the fixtures claim
// is either here or deliberately absent.
const PRIVACY = `
  <li><strong>Your account</strong> — when you sign in.</li>
  <li>Every model is served from our own <strong>models.example.test</strong>.</li>
  <li>The weather and trending-article cards fetch from Open-Meteo.</li>
`;
const SUBPROCESSORS = ['Acme Hosting', 'Resend', 'ipapi.co'];

// An app whose settings schema holds one real off-by-default switch.
const SETTINGS = {
  kimtai: [
    { key: 'systemPrompt', default: 'You are KimtAI' },
    { key: 'webSearch', default: 'off' },
    { key: 'alreadyOn', default: 'on' },
  ],
};
const settingsFor = (app) => SETTINGS[app] ?? null;
const surfaces = { privacy: PRIVACY, subprocessors: SUBPROCESSORS, settingsFor };

const check = (entry) => disclosureIssues([entry], surfaces);
const ok = (entry) => assert.deepEqual(check(entry), [], `expected no findings for ${entry.host}`);
const fails = (entry, match) => {
  const issues = check(entry);
  assert.ok(issues.length > 0, `expected a finding for ${entry.host}, got none`);
  assert.match(issues.join('\n'), match);
};

// An honest declaration, as a base to mutate one field at a time.
const DISCLOSED = {
  host: 'models.example.test',
  kind: 'fetch',
  why: 'Every on-device AI model',
  sends: 'metadata',
  told: 'privacy.vue',
  saidAs: 'models.example.test',
};

describe('the disclosure contract (#886)', () => {
  test('THE regression: an entry that admits it is undisclosed fails the build', () => {
    // Verbatim the shape that shipped, and that this whole change exists to make impossible.
    fails(
      {
        host: 'html.duckduckgo.com',
        kind: 'fetch',
        why: "KimtAI's web_search tool",
        sends: 'user-content',
        told: 'NOT TOLD - not in the privacy page or the README',
      },
      /NOT TOLD/,
    );
  });

  test('an honest declaration passes', () => ok(DISCLOSED));

  test('claiming the privacy page without saying which words is not a disclosure', () => {
    fails({ ...DISCLOSED, saidAs: undefined }, /no saidAs/);
  });

  test('a saidAs the privacy page does not contain fails — the disclosure must be real', () => {
    fails({ ...DISCLOSED, saidAs: 'served from our own potato' }, /is not on www\/pages\/privacy\.vue/);
  });

  test('saidAs still matches after prettier re-wraps the page across lines', () => {
    // The page's markup wraps; the phrase does not care, and must not.
    const privacy = 'served from our own\n        <strong>models.example.test</strong>.';
    assert.deepEqual(disclosureIssues([DISCLOSED], { ...surfaces, privacy }), []);
  });

  test('a bare "n/a" is not a reason — waving a host off has to say why', () => {
    fails({ ...DISCLOSED, sends: 'nothing', told: 'n/a', saidAs: undefined }, /'n\/a \(<reason>\)'/);
    ok({ ...DISCLOSED, sends: 'nothing', told: 'n/a (a placeholder; never fetched)', saidAs: undefined });
  });

  test('anything the request carries has to be on the privacy page', () => {
    fails(
      { ...DISCLOSED, sends: 'metadata', told: 'n/a (we would rather not say)', saidAs: undefined },
      /not disclosed/,
    );
  });

  test('sends must be one of the three levels — a typo is not a level', () => {
    fails({ ...DISCLOSED, sends: 'meta' }, /sends must be one of/);
    fails({ ...DISCLOSED, sends: undefined }, /sends must be one of/);
  });
});

describe('user content needs an opt-in and a named recipient', () => {
  // The shape a future web search would take. Everything about it is what #886 requires.
  const SEARCH = {
    host: 'search.example.com',
    kind: 'fetch',
    why: "KimtAI's web_search tool",
    sends: 'user-content',
    told: 'privacy.vue',
    saidAs: 'Your account',
    optIn: { app: 'kimtai', key: 'webSearch', off: 'off' },
    subprocessor: 'Resend',
  };

  test('the contract is satisfiable — a complete declaration passes', () => ok(SEARCH));

  test('no opt-in at all', () => fails({ ...SEARCH, optIn: undefined }, /no optIn/));

  test('an opt-in for a switch that does not exist', () => {
    fails({ ...SEARCH, optIn: { app: 'kimtai', key: 'notASetting', off: 'off' } }, /The switch does not exist/);
  });

  test('an opt-in that is already on is not an opt-in', () => {
    fails({ ...SEARCH, optIn: { app: 'kimtai', key: 'alreadyOn', off: 'off' } }, /already on is not an opt-in/);
  });

  test('an opt-in naming an app that has no descriptor', () => {
    fails({ ...SEARCH, optIn: { app: 'nosuchapp', key: 'webSearch', off: 'off' } }, /has no descriptor/);
  });

  test('an incomplete opt-in', () => {
    fails({ ...SEARCH, optIn: { app: 'kimtai' } }, /optIn must be \{ app, key, off \}/);
  });

  test('the third party that reads what the user typed must be named as a subprocessor', () => {
    fails({ ...SEARCH, subprocessor: undefined }, /must be named/);
    fails({ ...SEARCH, subprocessor: 'Some Search Co' }, /is not in www\/data\/legal\.ts/);
  });

  test('an opt-in is checked even when the entry claims to send nothing', () => {
    // A declaration cannot dodge the schema cross-check by understating what it sends.
    fails({ ...DISCLOSED, optIn: { app: 'kimtai', key: 'alreadyOn', off: 'off' } }, /already on is not an opt-in/);
  });
});

describe('a tool that reaches the network needs the switch (the #886 rule)', () => {
  const hosts = [
    { host: 'search.example.com', kind: 'fetch', sends: 'user-content' },
    {
      host: 'gated.example.com',
      kind: 'fetch',
      sends: 'user-content',
      optIn: { app: 'kimtai', key: 'webSearch', off: 'off' },
    },
    { host: 'json.org', kind: 'text', sends: 'nothing' },
  ];

  test('a tool file reaching an ungated host fails', () => {
    const issues = agentToolIssues([{ file: 'lib/agentTools.ts', hosts: ['search.example.com'] }], hosts);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /declares assistant tools and reaches search\.example\.com/);
  });

  test('a tool file reaching a gated host passes', () => {
    assert.deepEqual(agentToolIssues([{ file: 'lib/agentTools.ts', hosts: ['gated.example.com'] }], hosts), []);
  });

  test('a placeholder string is not a request — kind text is exempt', () => {
    // devtools/index.ts declares tools AND names json.org in a URL-encoder placeholder. Flagging
    // that is how a guard gets a reputation for crying wolf, and then gets switched off.
    assert.deepEqual(agentToolIssues([{ file: 'apps/devtools/index.ts', hosts: ['json.org'] }], hosts), []);
  });

  test('a file that declares no tools is not this rule’s business', () => {
    assert.deepEqual(agentToolIssues([], hosts), []);
  });

  test('known gap: a navigation host is not flagged, and that is on purpose', () => {
    // The unit is the FILE, not the individual tool, and an app descriptor holds much more than
    // its tools — a Documentation or "Learn more" link among them. A navigation host is the
    // browser opening a page on a user gesture; demanding an off-by-default switch for a help
    // link is the false positive that gets a guard switched off. `web_search` fetched, and so
    // would its successor. If this gap ever bites, the fix is to narrow the unit to the tool's
    // own `run` body, not to widen the kinds.
    const nav = [{ host: 'docs.example.test', kind: 'navigation', sends: 'nothing' }];
    assert.deepEqual(agentToolIssues([{ file: 'apps/kimtai/index.ts', hosts: ['docs.example.test'] }], nav), []);
  });
});

describe('reading an app’s settings schema out of its source', () => {
  const APP = `
    export default {
      id: 'kimtai',
      settings: [
        {
          key: 'systemPrompt',
          hint: 'Persona for new chats (each chat can override it [via the tune button])',
          default: DEFAULT_SYSTEM,
        },
        { key: 'webSearch', label: 'Search the web', type: 'select', default: 'off' },
        { key: 'flag', default: false },
      ],
      render() {},
    };
  `;

  test('parses every field, key and declared default', () => {
    assert.deepEqual(settingsSchema(APP), [
      { key: 'systemPrompt', default: 'DEFAULT_SYSTEM' },
      { key: 'webSearch', default: 'off' },
      { key: 'flag', default: false },
    ]);
  });

  test('a bracket inside a hint does not truncate the schema', () => {
    // The reason the scanner is string-aware: a naive depth counter closes the array early on
    // that "[via the tune button]" and silently reads half the settings — so a real opt-in
    // declared after it would look missing, and the guard would fail an honest change.
    assert.equal(settingsSchema(APP).length, 3);
  });

  test('an app with no settings is an empty schema, not a crash', () => {
    assert.deepEqual(settingsSchema('export default { id: "calculator" };'), []);
  });

  test('a commented-out settings block is not a schema', () => {
    assert.deepEqual(settingsSchema('// settings: [{ key: "webSearch", default: "off" }]'), []);
  });

  test('an identifier default is not a literal, so it can never satisfy an off value', () => {
    assert.equal(literalValue("'off'"), 'off');
    assert.equal(literalValue('false'), false);
    assert.equal(literalValue('DEFAULT_SYSTEM'), 'DEFAULT_SYSTEM');
    assert.equal(literalValue(undefined), undefined);
  });

  test('a quote only opens a string if it closes on its own line', () => {
    // The rule the whole scanner rests on. JS requires it of ' and ", so nothing real is lost,
    // and it is what stops a stray apostrophe from swallowing everything after it.
    assert.equal(endOfString("'off', next", 0), 4);
    assert.equal(endOfString("'no closer here\nand a new line'", 0), -1);
    assert.equal(endOfString("'escaped \\' quote'", 0), 17);
    // A template literal is the one form allowed to span lines, so it may look past the newline.
    assert.equal(endOfString('`line one\nline two`', 0), 18);
  });

  test('balanced() spans nesting and stops at the right delimiter', () => {
    assert.equal(balanced('[{ a: [1, 2] }] tail', 0), '[{ a: [1, 2] }]');
    assert.equal(balanced('[ "]" ] tail', 0), '[ "]" ]');
    assert.equal(balanced('[ unterminated', 0), null);
  });
});

describe('reading the subprocessor names out of legal.ts', () => {
  const LEGAL = `
    export const SUBPROCESSORS: { name: string; purpose: string }[] = [
      { name: 'Acme Hosting', purpose: 'Payments' },
      { name: 'Resend', purpose: 'Transactional email' },
    ];
    export const CLIENT_STORAGE: ClientStorageItem[] = [
      { name: 'kimtos_theme', kind: 'localStorage' },
    ];
  `;

  test('reads the subprocessors', () => {
    assert.deepEqual(subprocessorNames(LEGAL), ['Acme Hosting', 'Resend']);
  });

  test('a cookie name is not a subprocessor', () => {
    // legal.ts also lists every cookie the sites set, and those rows have a `name` too. Matching
    // the whole file would let "the third party who sees what the user typed" be satisfied by a
    // localStorage key — a cross-check that proves nothing.
    assert.equal(subprocessorNames(LEGAL).includes('kimtos_theme'), false);
  });

  test('the type annotation’s own brackets are not the array', () => {
    // `SUBPROCESSORS: { … }[] = [` — the nearest bracket to the name is the empty one in the
    // type, and reading that finds no names at all. The checker has a tripwire for exactly this.
    assert.ok(subprocessorNames(LEGAL).length > 0);
  });
});

describe('spotting the files that declare tools', () => {
  test('an app descriptor’s tools array', () => {
    assert.equal(
      declaresAgentTools('export default {\n  id: "tasks",\n  tools: [\n    { name: "list_tasks" },\n  ],\n};'),
      true,
    );
  });

  test('a typed AgentTool[] constant — where web_search actually lived', () => {
    assert.equal(declaresAgentTools('export const systemTools: AgentTool[] = [openAppStoreTool];'), true);
  });

  test('prose about tools is not a declaration', () => {
    assert.equal(declaresAgentTools('// tools: [ ... ] used to hold web_search'), false);
    assert.equal(declaresAgentTools('const toolNames = tools.map((t) => t.name);'), false);
  });
});

// Comment stripping decides what the checker can SEE, so a bug here is not cosmetic — it is the
// difference between a guard and a green light. Both directions are pinned: what it must hide,
// and what it must never hide.
describe('what the checker can see', () => {
  test('a URL in a comment is documentation, not a network call', () => {
    // The false-positive direction. voicePhonemize.ts cites a Wiktionary page for a pronunciation.
    const src = '  // https://en.wiktionary.org/wiki/kokoro#English\n  const x = 1;';
    assert.equal(stripComments(src).includes('wiktionary'), false);
  });

  test('a URL in code survives — its own slashes are not a comment', () => {
    const src = "const r = await fetch('https://html.duckduckgo.com/html/?q=' + q);";
    assert.match(stripComments(src), /html\.duckduckgo\.com/);
  });

  test('THE blindness: a block-comment opener inside a line comment must not eat the file', () => {
    // Verbatim the shape in lib/agentTools.ts — a line comment quoting the all-https match
    // pattern, whose asterisks read as a block-comment opener to a strip-blocks-first regex.
    // Everything from there to the next closer went invisible: 191 lines, `systemTools` among
    // them, which is the array `web_search` was declared in. The guard could not see the one
    // place the thing it guards against would be added.
    const src = [
      '// #637 made the `https://*/*` host permission optional, so the fetch would fail.',
      "const url = 'https://html.duckduckgo.com/html/';",
      '/** A doc comment, which is where the phantom block used to end. */',
    ].join('\n');
    assert.match(stripComments(src), /html\.duckduckgo\.com/);
  });

  test('an apostrophe in a regex literal does not derail the rest of the file', () => {
    // The other thing tried: a scanner that treats every quote as a string start. This line is
    // from lib/engines/voicePhonemize.ts, and it made every following comment read as code.
    const src = ["  .replace(/(?<=X')S\\b/g, 's');", '  // https://en.wiktionary.org/wiki/kokoro'].join('\n');
    assert.equal(stripComments(src).includes('wiktionary'), false);
  });

  test('the MIRROR of the same bug: a comment opener inside a STRING must not eat the file', () => {
    // Both of these are real constructs in extension/src, and both hid the host on the next line
    // when the pass ignored quotes: lib/hostPermission.ts holds the all-https match pattern as a
    // value, and apps/index.ts globs every app's index. An opener is ordinary inside a string.
    const src = [
      "const ALL_SITES = { origins: ['https://*/*'] };",
      "const feed = 'https://dev.to/api/articles';",
      "import.meta.glob('./apps/*/index.ts');",
      "const other = 'https://lobste.rs/hottest.json';",
    ].join('\n');
    const out = stripComments(src);
    assert.match(out, /dev\.to/, 'a host after an all-https pattern went invisible');
    assert.match(out, /lobste\.rs/, 'a host after a glob went invisible');
  });

  test('a real block comment is still stripped', () => {
    assert.equal(stripComments('/* see https://example.com */ const x = 1;').includes('example.com'), false);
  });

  test('an unterminated block comment ends at the end of file rather than hanging', () => {
    assert.equal(stripComments('const x = 1;\n/* https://example.com').includes('example.com'), false);
  });
});

describe('the shipped list itself', () => {
  test('is non-empty — every assertion above is "for each", so an empty list passes vacuously', () => {
    assert.ok(NETWORK_HOSTS.length > 0, 'no hosts are declared in scripts/network-hosts.mjs');
  });

  test('declares no undisclosed host, and never will again silently', () => {
    const undisclosed = NETWORK_HOSTS.filter((h) => /^NOT TOLD/i.test(h.told ?? ''));
    assert.deepEqual(undisclosed, [], 'a declared host is marked as not disclosed to the user');
  });

  test('every entry states what it sends', () => {
    const missing = NETWORK_HOSTS.filter((h) => !['nothing', 'metadata', 'user-content'].includes(h.sends));
    assert.deepEqual(
      missing.map((h) => h.host),
      [],
      'these declared hosts do not say what of the user’s they carry',
    );
  });
});
