// Fails the build when user-facing copy claims the AI assistant can act on the user's data.
//
// It cannot. CLAUDE.md app-convention 5 states it plainly:
//
//   > The agent does not run. No shipped model can enter the loop, so all tools across all
//   > apps are inert. [...] never write user-facing copy (README, marketing, booklets, app
//   > `desc`) saying KimtAI can drive the apps. It cannot.
//
// That rule lived only in prose, and eight booklets drifted straight past it (#170): the
// public docs told readers "the assistant can list, search, create, and DELETE clips on your
// behalf" and "the KimtAI agent can drive Tabs for you". A user who believes that and tries
// it gets silence -- and the measured behaviour of the model we ship is worse than silence:
// asked what tasks were due, it answered "You have no tasks today" without ever calling the
// tool. Copy that promises an agent which cannot act is the most expensive kind of wrong.
//
// The `tools` arrays in code are deliberately KEPT (convention 5 again) -- declaring them
// costs nothing at runtime and makes switching the feature on a runtime change rather than
// 79 rewrites. So this polices the COPY, not the code:
//
//   docs/extension/**   the public booklets (the docs site)
//   www/**              the marketing site
//   README.md           the front door
//
// Describing the tools as DECLARED but dormant is fine and is what the docs now do. What is
// banned is the present-tense capability claim: "the assistant can <verb>", "on your behalf",
// "can drive". A sentence that negates or defers it ("cannot", "does not run", "not active
// yet", "would retrieve") is exactly the honest phrasing we want, so it passes.
//
//   node scripts/check-agent-claims.mjs
//
// The judgement itself (`flags`) is exported and covered by check-agent-claims.test.mjs, so
// the checker is tested against its own false positives. A guard nobody tests is a guard
// that rots: this one shipped a rule that flagged the word "drive" in any sentence (#213).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Who the claim is ABOUT. One list, used by every subject-anchored pattern below — it was
// written out twice, and the copies were free to drift (#213).
//
// The subject is what makes a sentence a claim. A verb on its own is not: the old rule set
// carried a bare /\bcan drive\b/i, anchored to nothing, so it flagged "you can drive it
// entirely from the keyboard" and "a config file can drive the build" as if they promised an
// agent. An author whose correct sentence fails CI reaches for a reword, not a rethink — and
// that is exactly what happened (3909e66 bent a keyboard sentence around this bug). The rule
// is gone. "assistant ... can drive" is still caught, by the `can` pattern below.
//
// DO NOT add `AI` or `model` here, and do not re-add a subject-less verb rule. Both were
// tried and measured: `model` makes "the model runs in a Web Worker", "the model runs
// offline from then on" and "the speech-recognition model runs inside your browser" into
// violations — nine of them, all honest local-first copy, none claiming an agent does
// anything. The cost of catching a hypothetical "the AI can drive Tabs" is flagging the
// sentences this product is actually built on. Not worth it.
const SUBJECT = 'assistant|agent|kimtai|kimtai';

// The APP'S NAME is not an agent. `kimtai`/`kimtai` name the product; `assistant`/`agent` name
// the thing that would act. That distinction is the whole checker, and it is why the two rules
// below take DIFFERENT subjects.
//
// A capability claim is a claim whoever the subject is — "KimtAI can drive the apps" is exactly
// the copy #170 removed — so the `can` rule takes the full list.
//
// A bare verb is not. An app legitimately RUNS, CREATES and UPDATES things that are not tool
// calls, and a local-first product says so constantly: "KimtAI runs a small chat model on your
// own machine" is the central promise of the product, and it FAILED THE BUILD (#311). The verb
// rule therefore keeps the narrow subject it always had — until 250a5fe, which factored out a
// shared SUBJECT while fixing an unrelated false positive and silently widened this rule with it.
//
// This file's own tests already predicted it: widening the subject list turns honest local-first
// prose into violations, and the fix "is a rule anchored to the OBJECT of the claim, not a wider
// subject list". That warning was written about "the model"; it applies verbatim to the app name.
const ACTOR = 'assistant|agent';

// Present-tense claims that the assistant/agent ACTS.
export const CLAIMS = [
  new RegExp(`\\b(${SUBJECT})\\b[^.\\n]{0,40}\\bcan\\b`, 'i'),
  /\bon your behalf\b/i,
  new RegExp(`\\b(${ACTOR})\\s+(lists|searches|creates|deletes|updates|drives|runs)\\b`, 'i'),
];

// The honest phrasings. A line that carries one of these is not making the claim -- it is
// denying or deferring it, which is the whole point of the rewrite.
export const HONEST =
  /\b(cannot|can never|can't|does not|doesn't|do not|don't|not active|not yet|dormant|no shipped model|would|could|declares?|declared|inert)\b/i;

/** Does this sentence claim the assistant acts? The whole judgement, in one place, so the
 *  tests exercise what CI runs rather than a copy of it. */
export function flags(sentence) {
  return CLAIMS.some((r) => r.test(sentence)) && !HONEST.test(sentence);
}

const SCOPES = [/^docs\/extension\//, /^www\//, /^README\.md$/];
const TEXT = /\.(md|vue|ts|js|html)$/i;
const SKIP = /^www\/(node_modules|\.output|\.nuxt|dist)\//;

// THE UNIT OF JUDGEMENT IS A SENTENCE, NOT A LINE. Markdown hard-wraps at ~78 columns, so a
// claim and the words that negate it routinely land on different lines. Read line-by-line,
// this check flags KimtAI's own booklet -- "...are not yet / reliable enough to be trusted
// with actions on your behalf" -- which is precisely the honest paragraph we want people to
// write. A checker that punishes the correct phrasing gets deleted, and rightly so.
//
// So: rebuild sentences across the wrapping (paragraph -> join -> split on . ! ?) and judge
// those, reporting the line the sentence starts on.
export function sentences(text) {
  const out = [];
  const lines = text.split('\n');
  let buf = [];
  let start = 0;
  const flush = () => {
    if (!buf.length) return;
    const joined = buf.join(' ');
    let offset = 0;
    for (const s of joined.split(/(?<=[.!?])\s+/)) {
      // the line a sentence starts on: count how many wrapped lines precede its offset
      let consumed = 0;
      let line = start;
      for (let i = 0; i < buf.length; i++) {
        if (consumed + buf[i].length + 1 > offset) {
          line = start + i;
          break;
        }
        consumed += buf[i].length + 1;
      }
      out.push({ text: s, line: line + 1 });
      offset += s.length + 1;
    }
    buf = [];
  };
  lines.forEach((l, i) => {
    if (l.trim() === '') {
      flush();
    } else {
      if (!buf.length) start = i;
      buf.push(l.trim());
    }
  });
  flush();
  return out;
}

// Scan the repo. Only when run as a CLI — importing this file (the tests do) must not shell
// out to git or call process.exit.
function main() {
  const files = execSync('git ls-files', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => SCOPES.some((s) => s.test(f)) && TEXT.test(f) && !SKIP.test(f));

  const failures = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const s of sentences(text)) {
      if (!flags(s.text)) continue;
      failures.push({ file, line: s.line, text: s.text.trim().slice(0, 96) });
    }
  }

  if (failures.length) {
    console.error('check-agent-claims: user-facing copy says the assistant can act. It cannot.\n');
    for (const f of failures) console.error(`  ${f.file}:${f.line}\n    ${f.text}\n`);
    console.error('The agent does not run -- no shipped on-device model can call a tool, and the');
    console.error('one we ship answers "you have no tasks today" without ever looking. Describe the');
    console.error('tools as DECLARED and dormant ("Tabs declares agent tools ... they do not run');
    console.error('today"), never as a capability the reader can use. See CLAUDE.md, convention 5.');
    process.exit(1);
  }

  console.log(`check-agent-claims: ${files.length} user-facing files, no false agent claims.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
