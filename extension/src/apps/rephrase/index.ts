// Rephrase — rewrite a sentence in different words without losing its
// meaning, using the on-device KimtAI chat model. The strict prompt lives in
// @kimtos/prompts (rephrase.md); this app renders it, streams the model reply,
// and cleans it with stripPreamble. Nothing is uploaded.
//
// A small on-device model sometimes rewrites the FACTS as well as the wording
// (#644: "10:00 AM" came back as "9:05 AM"). The prompt cannot prevent that, so
// every result is checked against the input by `lib/rephraseCheck.ts`: on drift
// we retry once at the most conservative temperature, and if that also drifts
// we say so rather than presenting a wrong rewrite as a good one.
import { el } from '../../lib/dom.js';
import { createChat, downloadedModels, recommendedModelId, byId } from '../../lib/engines/kimtai.js';
import { getAppValue } from '../../lib/appConfig.js';
import { createCopyButton } from '../../components/copyButton.js';
import { checkRephrase, describeProblems } from '../../lib/rephraseCheck.js';
import { renderPrompt, stripPreamble } from '@kimtos/prompts';
import appMeta from './meta.js';

const ACCENT = appMeta.accent;
type Chat = ReturnType<typeof createChat>;
interface Ctx {
  openApp?: (id: string) => void;
}

// How far the model may stray from the original wording (prompt keeps meaning fixed).
const CREATIVITY: { label: string; temp: number }[] = [
  { label: 'Precise', temp: 0.3 },
  { label: 'Balanced', temp: 0.5 },
  { label: 'Creative', temp: 0.75 },
];

// The temperature the automatic second attempt runs at when the first drifted —
// as conservative as the model gets, which is where it strays least.
const RETRY_TEMP = 0.2;

const STYLE = `
.rephrase{display:flex;flex-direction:column;gap:14px;height:100%;padding:4px 2px;}
.rephrase-lead{margin:0;font-size:13px;color:var(--text-secondary);}
.rephrase-input{width:100%;min-height:96px;resize:vertical;padding:12px 14px;font:inherit;font-size:14px;
  line-height:1.5;color:var(--text);background:rgba(0,0,0,0.18);border:1px solid var(--hairline);
  border-radius:var(--radius-md);box-sizing:border-box;}
.rephrase-input:focus{outline:none;border-color:var(--accent);}
.rephrase-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rephrase-seg{display:flex;gap:3px;padding:3px;background:rgba(0,0,0,0.22);border-radius:var(--radius-sm);}
.rephrase-seg button{padding:5px 12px;font:inherit;font-size:12.5px;font-weight:500;color:var(--text-secondary);
  background:none;border:none;border-radius:6px;cursor:pointer;}
.rephrase-seg button.is-active{color:var(--text);background:var(--material-hover);}
.rephrase-spacer{flex:1;}
.rephrase-out{min-height:72px;padding:14px;font-size:14px;line-height:1.6;color:var(--text);
  background:rgba(255,255,255,0.04);border:1px solid var(--hairline);border-radius:var(--radius-md);
  white-space:pre-wrap;word-break:break-word;}
.rephrase-out.is-empty{color:var(--text-secondary);}
.rephrase-out.is-error{color:var(--danger);}
.rephrase-out.is-suspect{border-color:var(--warning);}
.rephrase-warn{display:flex;flex-direction:column;gap:4px;padding:10px 12px;font-size:12.5px;line-height:1.5;
  color:var(--text);background:var(--material-hover);border:1px solid var(--warning);
  border-radius:var(--radius-md);}
.rephrase-warn:empty{display:none;}
.rephrase-warn strong{font-weight:600;color:var(--warning);}
.rephrase-out-actions{display:flex;gap:8px;justify-content:flex-end;}
.rephrase-out-actions:empty{display:none;}
.rephrase-hint{margin:0;font-size:12px;color:var(--text-secondary);min-height:14px;}
.rephrase-locked{display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:22px;
  background:rgba(255,255,255,0.04);border:1px solid var(--hairline);border-radius:var(--radius-md);}
.rephrase-locked h3{margin:0;font-size:15px;color:var(--text);}
.rephrase-locked p{margin:0;font-size:13px;line-height:1.5;color:var(--text-secondary);}
`;

function injectStyles(): void {
  if (document.getElementById('rephrase-styles')) return;
  const s = document.createElement('style');
  s.id = 'rephrase-styles';
  s.textContent = STYLE;
  document.head.append(s);
}

// The model to run on: the user's active KimtAI model if downloaded, else the
// recommended small one if present, else the first downloaded. null = none yet.
async function pickModel(): Promise<string | null> {
  const dl = await downloadedModels();
  if (!dl.length) return null;
  const active = getAppValue('kimtai', 'activeModel');
  if (typeof active === 'string' && dl.includes(active)) return active;
  const rec = recommendedModelId();
  return dl.includes(rec) ? rec : dl[0];
}

// Headless one-shot rephrase used by the agent tool: load a downloaded model, run
// the rephrase prompt to completion, and return the cleaned result. Throws
// 'NO_MODEL' when nothing is downloaded yet.
async function rephraseOnce(text: string, temperature: number): Promise<string> {
  const model = await pickModel();
  if (!model) throw new Error('NO_MODEL');
  const { messages, defaults } = renderPrompt('rephrase', { input: text });
  const maxTokens = typeof defaults.maxTokens === 'number' ? defaults.maxTokens : 256;
  const chat = createChat({ model });
  await chat.ready;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      chat.send(
        messages as Parameters<typeof chat.send>[0],
        { onToken: () => {}, onDone: (t: string) => resolve(t), onError: (e: Error) => reject(e) },
        { temperature, maxTokens },
      );
    });
    return stripPreamble(raw || '') || '';
  } finally {
    chat.dispose();
  }
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Rewrite a sentence in different words without losing its meaning — on-device',
  tip: 'Type or paste a sentence; Rephrase rewrites it in different words while keeping the meaning. It runs on the on-device KimtAI model — nothing is uploaded. Small models sometimes drift, so each rewrite is checked against your text and flagged when a number, time or question changed.',
  accent: ACCENT,
  order: appMeta.order,

  // Agent tool: rewrite text in different words (uses the on-device model).
  tools: [
    {
      name: 'rephrase_text',
      description:
        'Rewrite a sentence or short passage in different words while keeping its exact meaning, using the on-device model. Needs a downloaded KimtAI model.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to rewrite' },
          style: {
            type: 'string',
            enum: ['precise', 'balanced', 'creative'],
            description: 'How far to stray from the original wording (default balanced)',
          },
        },
        required: ['text'],
      },
      run: async (args: { text?: string; style?: string }) => {
        const text = String(args.text || '').trim();
        if (!text) return { ok: false, result: 'Provide text to rephrase.', summary: 'no text' };
        const temp = args.style === 'precise' ? 0.3 : args.style === 'creative' ? 0.75 : 0.5;
        try {
          let out = await rephraseOnce(text, temp);
          let check = checkRephrase(text, out);
          if (!check.ok) {
            // One conservative retry, exactly as the UI does.
            out = await rephraseOnce(text, RETRY_TEMP);
            check = checkRephrase(text, out);
          }
          if (!out) return { ok: false, result: 'The model returned nothing — try again.', summary: 'empty' };
          // Never hand back a rewrite that provably says something else: a wrong
          // answer reported as a good one is worse than no answer at all.
          if (!check.ok) {
            return {
              ok: false,
              result: `The on-device model changed the meaning, so the rewrite was discarded. ${describeProblems(check.problems)}`,
              summary: 'meaning changed',
            };
          }
          return { ok: true, result: out, summary: 'rephrased' };
        } catch (e) {
          if (e instanceof Error && e.message === 'NO_MODEL')
            return {
              ok: false,
              result: 'No on-device model yet. Open KimtAI to download one, then try again.',
              summary: 'no model',
            };
          return {
            ok: false,
            result: `Rephrase failed: ${e instanceof Error ? e.message : 'error'}`,
            summary: 'error',
          };
        }
      },
    },
  ],

  render(body: HTMLElement, ctx: Ctx = {}) {
    injectStyles();
    const root = el('div', 'rephrase');
    body.replaceChildren(root);

    let chat: Chat | null = null;
    let chatModel: string | null = null;
    let busy = false;
    let temp = 0.5;

    const ensureChat = async (model: string): Promise<Chat> => {
      if (chat && chatModel === model) return chat;
      chat?.dispose();
      chatModel = model;
      chat = createChat({ model });
      await chat.ready;
      return chat;
    };

    // --- UI (built once) ---
    root.append(
      el(
        'p',
        'rephrase-lead',
        'Rewrite a sentence in different words, keeping the meaning. Every rewrite is checked against your text, and flagged if a number, time or question changed.',
      ),
    );

    const input = el('textarea', 'rephrase-input');
    input.placeholder = 'Type or paste a sentence to rephrase…  (⌘/Ctrl+Enter)';
    input.rows = 3;
    input.spellcheck = false;
    root.append(input);

    const bar = el('div', 'rephrase-bar');
    const seg = el('div', 'rephrase-seg');
    const segButtons: HTMLButtonElement[] = [];
    CREATIVITY.forEach((c) => {
      const b = el('button');
      b.type = 'button';
      b.textContent = c.label;
      b.title = `Creativity: ${c.label}`;
      b.classList.toggle('is-active', c.temp === temp);
      b.addEventListener('click', () => {
        temp = c.temp;
        segButtons.forEach((x, i) => x.classList.toggle('is-active', CREATIVITY[i].temp === temp));
      });
      seg.append(b);
      segButtons.push(b);
    });
    bar.append(seg, el('span', 'rephrase-spacer'));
    const goBtn = el('button', 'button-primary');
    goBtn.type = 'button';
    goBtn.textContent = 'Rephrase';
    goBtn.addEventListener('click', () => void run());
    bar.append(goBtn);
    root.append(bar);

    const out = el('div', 'rephrase-out is-empty', 'The rephrased sentence will appear here.');
    root.append(out);

    // Warning banner: what the meaning check found, when it found something.
    const warn = el('div', 'rephrase-warn');
    root.append(warn);

    const actions = el('div', 'rephrase-out-actions');
    root.append(actions);

    const hint = el('p', 'rephrase-hint');
    root.append(hint);

    input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void run();
      }
    });

    function setBusy(on: boolean): void {
      busy = on;
      goBtn.disabled = on;
      input.disabled = on;
      goBtn.textContent = on ? 'Rephrasing…' : 'Rephrase';
    }
    function showError(msg: string): void {
      out.className = 'rephrase-out is-error';
      out.textContent = msg;
      warn.replaceChildren();
      actions.replaceChildren();
      setBusy(false);
    }
    function againButton(): HTMLButtonElement {
      const again = el('button', 'button-secondary');
      again.type = 'button';
      again.textContent = 'Rephrase again';
      again.addEventListener('click', () => void run());
      return again;
    }

    // Say plainly that the rewrite is not trustworthy, and why. The text stays
    // on screen — the user may still want it — but it is never presented as a
    // faithful rewrite.
    function showWarning(headline: string, detail: string, suspect: boolean): void {
      out.classList.toggle('is-suspect', suspect);
      warn.replaceChildren(el('strong', undefined, headline), el('span', undefined, detail));
    }

    // `retry` is the automatic second attempt after the meaning check failed. It
    // runs INSIDE the same busy window — the input stays disabled and no click
    // can start a competing send while it is in flight.
    async function run(retry = false): Promise<void> {
      const text = input.value.trim();
      if (!text || (busy && !retry)) return;

      const model = await pickModel();
      if (!model) {
        out.className = 'rephrase-out is-empty';
        out.textContent = 'No on-device model yet — download one in KimtAI, then come back.';
        warn.replaceChildren();
        hint.textContent = '';
        const open = el('button', 'button-secondary');
        open.type = 'button';
        open.textContent = 'Open KimtAI';
        open.addEventListener('click', () => ctx.openApp?.('kimtai'));
        actions.replaceChildren(open);
        return;
      }

      setBusy(true);
      const label = byId(model)?.label;
      hint.textContent = label ? `On-device · ${label}` : 'On-device';
      out.className = 'rephrase-out';
      out.textContent = retry ? 'Checking the meaning — rewriting once more…' : 'Thinking…';
      warn.replaceChildren();
      actions.replaceChildren();

      const { messages, defaults } = renderPrompt('rephrase', { input: text });
      const maxTokens = typeof defaults.maxTokens === 'number' ? defaults.maxTokens : 256;

      try {
        const session = await ensureChat(model);
        session.send(
          messages as Parameters<typeof session.send>[0],
          {
            onToken: (_t: string, acc: string) => {
              out.textContent = acc;
            },
            onDone: (t: string) => {
              const result = stripPreamble(t || out.textContent || '');
              const check = checkRephrase(text, result);
              // Drift on the first pass: try once more, as conservatively as
              // the model goes, before showing the user anything suspect.
              if (!check.ok && !retry) {
                void run(true);
                return;
              }
              out.textContent = result || '(no output)';
              setBusy(false);
              if (!check.ok) {
                showWarning(
                  'This rewrite changed the meaning.',
                  `${describeProblems(check.problems)} It comes from a small on-device model, which sometimes drifts — try Precise, or shorten the text and rephrase again.`,
                  true,
                );
              } else if (check.problems.length) {
                showWarning(
                  'The meaning is intact, but the wording barely changed.',
                  describeProblems(check.problems),
                  false,
                );
              }
              actions.replaceChildren(
                createCopyButton(() => out.textContent || '', 'Copy'),
                againButton(),
              );
            },
            onError: (e: Error) => showError(e.message || 'Something went wrong.'),
          },
          { temperature: retry ? RETRY_TEMP : temp, maxTokens },
        );
      } catch (e) {
        showError(e instanceof Error ? e.message : 'The model failed to load.');
      }
    }

    return () => {
      chat?.dispose();
      chat = null;
    };
  },
};

export default app;
