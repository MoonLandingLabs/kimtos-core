// Grammit — a private, on-device writing assistant. You just type: a moment after
// you stop, it underlines spelling/grammar fixes (Grammarly-style). Click an
// underline to accept the suggestion. Nothing leaves the browser.
//
// Three layers, all on-device: deterministic rules, a 60k-word spell checker, and
// an optional AI "deep grammar" model. See the original notes for the backdrop
// underline technique (transparent <textarea> over a mirror).

import './grammit.css';
import { getAppConfig } from '../../lib/appConfig.js';
import { grammarIssues } from '../../lib/textDiff.js';
import { ruleIssues } from '../../lib/grammarRules/index.js';
import { mergeIssues } from '../../lib/writing.js';
import { el, escapeHtml } from '../../lib/dom.js';
import { applyDecision, initialCustomValue, isRemoval } from './apply.js';
import { execEdit } from '../../lib/editCommand.js';
import { COPY, CHECK } from '../../components/icons.js';
import type { SpellIssue } from '../../lib/spellcheck.js';
import appMeta from './meta.js';
import { loadAsJob } from '../../lib/modelJob.js';
import { currentModelId } from '../../lib/modelHosts.js';

interface Issue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  label?: string;
  suggestions?: string[];
}
interface Corrector {
  correct: (text: string) => Promise<string>;
  dispose?: () => void;
}
type CorrectorFactory = (o: {
  model?: string;
  onProgress?: (p: { phase?: string; ratio?: number | null }) => void;
}) => Promise<Corrector>;
interface ToolCtx {
  onProgress?: (p: unknown) => void;
  [key: string]: unknown;
}

const DEBOUNCE_MS = 800;

// Split text into sentences with their character offsets (newlines + .?! end one).
function sentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description:
    'A private writing assistant — catch grammar & spelling as you type, with inline underlines and one-click fixes. Runs 100% on your device, so unlike Grammarly nothing you write is ever uploaded. Also checks your writing in every text box across the web.',
  tip: 'Type or paste text — Grammit underlines spelling & grammar as you go and fixes them in one click, all on-device. It also checks your writing in text boxes across the web.',
  accent: appMeta.accent,
  order: appMeta.order,

  // KimtAI agent tool — grammar/spelling correction via the on-device model.
  tools: [
    {
      name: 'fix_grammar',
      description: 'Correct the grammar and spelling of a piece of text.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: async (args: Record<string, unknown>, ctx: ToolCtx) => {
        const text = String(args.text || '').trim();
        if (!text) return { ok: false, result: 'No text provided.', summary: 'no text' };
        const { createCorrector } = await import('../../lib/engines/grammar.js');
        const opts = { onProgress: ctx.onProgress };
        const corrector: Corrector = await (createCorrector as CorrectorFactory)(opts);
        try {
          const fixed = await corrector.correct(text);
          return { ok: true, result: fixed, summary: 'corrected' };
        } finally {
          corrector.dispose?.();
        }
      },
    },
  ],

  settings: [
    {
      key: 'spell',
      label: 'Spell check',
      hint: 'Flag misspelled words using a built-in 60k-word dictionary (on-device).',
      type: 'select',
      default: 'on',
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
    },
    {
      key: 'deep',
      label: 'AI deep grammar',
      hint: 'Adds an on-device AI model for deeper grammar (downloads when you turn it on, slower). The fast rule-based checks always run.',
      type: 'select',
      default: 'off',
      affectsDownload: true,
      options: [
        { value: 'off', label: 'Off — fast rule-based checks only' },
        { value: 'on', label: 'On — also run the AI model' },
      ],
    },
    {
      key: 'model',
      label: 'AI model',
      hint: 'Only used when “AI deep grammar” is on. Larger = more accurate, bigger download.',
      type: 'select',
      default: 'Xenova/flan-t5-base',
      affectsDownload: true,
      options: [
        { value: 'Xenova/flan-t5-base', label: 'Base (accurate, ~250 MB)' },
        { value: 'Xenova/flan-t5-small', label: 'Small (faster, weaker, ~80 MB)' },
      ],
    },
  ],

  render(body: HTMLElement) {
    let corrector: Corrector | null = null; // loaded grammar model (kept resident while open)
    let loadPromise: Promise<Corrector> | null = null; // in-flight model load, shared
    let inferenceLock: Promise<unknown> = Promise.resolve(); // serializes the one session
    let issues: Issue[] = []; // [{ start, end, original, suggestion }]
    const cache = new Map<string, string>(); // sentence text -> corrected text
    const dismissed = new Set<string>(); // `${original}|${suggestion}` the user waved off
    let runToken = 0; // bumps to invalidate in-flight checks when the user types more
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let syncFrame = 0;
    let popover: HTMLElement | null = null;

    // --- DOM ---
    const root = el('div', 'app-flow grammit');
    root.append(
      el(
        'p',
        'grammit-hint',
        'Type or paste below. Grammit checks your text on your device and underlines what to fix — nothing is uploaded.',
      ),
    );

    const wrap = el('div', 'grammit-wrap');
    const highlights = el('div', 'grammit-highlights');
    highlights.setAttribute('aria-hidden', 'true');
    const mirror = el('div', 'grammit-mirror'); // hidden, for measuring positions
    mirror.setAttribute('aria-hidden', 'true');
    const input = el('textarea', 'grammit-input');
    input.placeholder = 'Start writing…';
    input.spellcheck = false;
    wrap.append(highlights, mirror, input);

    // --- footer: status + actions (Fix all, Copy) ---
    const status = el('div', 'grammit-status');
    const actions = el('div', 'grammit-actions');
    const fixAllBtn = el('button', 'grammit-action');
    fixAllBtn.type = 'button';
    fixAllBtn.innerHTML = `${CHECK}<span>Fix all</span>`;
    fixAllBtn.title = 'Apply every suggestion';
    fixAllBtn.addEventListener('click', fixAll);
    const copyBtn = el('button', 'grammit-action');
    copyBtn.type = 'button';
    copyBtn.innerHTML = `${COPY}<span>Copy</span>`;
    copyBtn.title = 'Copy the text';
    copyBtn.addEventListener('click', copyText);
    actions.append(fixAllBtn, copyBtn);

    const footer = el('div', 'grammit-footer');
    footer.append(status, actions);
    root.append(wrap, footer);
    body.replaceChildren(root);

    const updateActions = (): void => {
      fixAllBtn.disabled = !issues.some((iss) => iss.suggestion !== undefined);
      copyBtn.disabled = !input.value.trim();
    };

    // --- layout: single scroll container, textarea auto-grows, backdrop aligned ---
    const autoGrow = (): void => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    const scheduleSync = (): void => {
      if (syncFrame) return;
      syncFrame = requestAnimationFrame(() => {
        syncFrame = 0;
        autoGrow();
      });
    };

    // --- status footer ---
    const setStatus = (kind: string, text: string): void => {
      status.className = `grammit-status is-${kind}`;
      status.replaceChildren();
      if (kind === 'checking' || kind === 'loading') {
        status.append(el('span', 'grammit-spinner'), el('span', 'grammit-status-text', text));
      } else if (text) {
        status.append(el('span', 'grammit-status-text', text));
      }
    };
    const showResultStatus = (): void => {
      setStatus(
        issues.length ? 'issues' : 'clear',
        issues.length ? `${issues.length} suggestion${issues.length === 1 ? '' : 's'}` : 'No issues found',
      );
      updateActions();
    };

    // --- backdrop underlines ---
    function renderHighlights(): void {
      const text = input.value;
      let html = '';
      let last = 0;
      for (const [i, iss] of issues.entries()) {
        if (iss.start < last) continue; // safety: skip any overlap
        html += escapeHtml(text.slice(last, iss.start));
        html += `<mark class="grammit-issue" data-i="${i}">${escapeHtml(text.slice(iss.start, iss.end))}</mark>`;
        last = iss.end;
      }
      html += escapeHtml(text.slice(last));
      highlights.innerHTML = `${html}\n`;
    }

    const issueKey = (iss: Issue): string => `${iss.original}|${iss.suggestion}`;
    const issueAt = (pos: number): Issue | null => issues.find((iss) => pos >= iss.start && pos <= iss.end) || null;

    // Load the model once, even if several checks race to start it.
    function ensureCorrector(model?: string): Promise<Corrector> {
      if (corrector) return Promise.resolve(corrector);
      if (!loadPromise) {
        setStatus('loading', 'Loading model…');
        // The deep-grammar model is about 250 MB, and this is reached from TYPING — an 800 ms
        // debounce after a keystroke. It used to run as a bare promise, so a quarter of a gigabyte
        // began downloading with nothing on screen to say so, nowhere to find it and no way to stop
        // it (#1307). Registering is what gives it a row; the status line under the editor stays,
        // because that is where the user is already looking.
        loadPromise = loadAsJob({ appId: appMeta.id, title: 'Downloading the grammar model' }, async (onProgress) => {
          const { createCorrector } = await import('../../lib/engines/grammar.js');
          const opts = {
            model,
            onProgress: (p: { phase?: string; ratio?: number | null }) => {
              onProgress(p);
              if (p.phase === 'download' && p.ratio != null) {
                setStatus('loading', `Downloading model — ${Math.round(p.ratio * 100)}%`);
              }
            },
          };
          return (createCorrector as CorrectorFactory)(opts);
        });
      }
      return loadPromise.then(
        (c) => {
          corrector = c;
          return c;
        },
        (err: unknown) => {
          // Drop the failed attempt, or every later check re-awaits the same rejected promise and
          // the deep layer stays off for the life of the window with no way back short of closing
          // Grammit. `loadAsJob` already drops its own in-flight entry on failure; this is the
          // cache in front of it doing the same.
          loadPromise = null;
          throw err;
        },
      );
    }

    // Load the on-device spell-check dictionary once (lazy). The word list is a packaged
    // asset fetched at runtime, not bundled — see lib/spellcheck.ts — so this pulls in the
    // checker, not 505 KB of data.
    let speller: ((text: string) => SpellIssue[]) | null = null;
    let spellPromise: Promise<(text: string) => SpellIssue[]> | null = null;
    function ensureSpeller(): Promise<(text: string) => SpellIssue[]> {
      if (speller) return Promise.resolve(speller);
      if (!spellPromise)
        spellPromise = import('../../lib/spellcheck.js').then((m) => m.loadSpeller()).then((fn) => (speller = fn));
      return spellPromise;
    }

    // Serialize every inference through the single session.
    function correct(text: string): Promise<string> {
      const run = inferenceLock.then(() => corrector!.correct(text));
      inferenceLock = run.catch(() => {});
      return run;
    }

    // --- the live check ---
    const scheduleCheck = (): void => {
      closePopover();
      if (debounce) clearTimeout(debounce);
      runToken += 1; // any queued/in-flight check is now stale
      if (issues.length) {
        issues = [];
        renderHighlights();
      }
      updateActions();
      if (!input.value.trim()) {
        setStatus('idle', '');
        return;
      }
      setStatus('idle', '');
      debounce = setTimeout(runCheck, DEBOUNCE_MS);
    };

    // Combine rule issues with model issues, keeping rules and adding only
    // non-overlapping model issues.
    async function runCheck(): Promise<void> {
      const text = input.value;
      const token = runToken;
      const cfg = getAppConfig(app);

      // 1) Instant, reliable rule-based checks (no model needed).
      let merged: Issue[] = ruleIssues(text);
      issues = merged.filter((iss) => !dismissed.has(issueKey(iss)));
      renderHighlights();
      showResultStatus();

      // 2) On-device spell check (local dictionary; fast after the one-time load).
      if (cfg.spell !== 'off') {
        try {
          await ensureSpeller();
          if (token !== runToken) return;
          merged = mergeIssues(merged, speller!(text)); // rules win over spelling on overlap
          issues = merged.filter((iss) => !dismissed.has(issueKey(iss)));
          renderHighlights();
          showResultStatus();
        } catch {
          /* dictionary failed to load — keep rule results */
        }
      }

      // 3) Optional AI "deep grammar" pass — only when the user enabled it.
      if (cfg.deep !== 'on') return;
      try {
        await ensureCorrector(typeof cfg.model === 'string' ? currentModelId(cfg.model) : undefined);
        if (token !== runToken) return; // user kept typing during the (one-time) load
        setStatus('checking', 'Checking…');
        const modelFound: Issue[] = [];
        for (const sent of sentences(text)) {
          if (token !== runToken) return;
          let corrected = cache.get(sent.text);
          if (corrected == null) {
            corrected = await correct(sent.text);
            if (token !== runToken) return; // stale — newer keystrokes superseded us
            cache.set(sent.text, corrected);
          }
          for (const iss of grammarIssues(sent.text, corrected)) {
            modelFound.push({ ...iss, start: sent.start + iss.start, end: sent.start + iss.end, label: 'Grammar' });
          }
        }
        if (token !== runToken) return;
        issues = mergeIssues(merged, modelFound).filter((iss) => !dismissed.has(issueKey(iss)));
        renderHighlights();
        showResultStatus();
      } catch (err) {
        if (token !== runToken) return;
        showResultStatus();
        status.title = `AI deep check unavailable: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // --- suggestion popover ---
    function closePopover(): void {
      popover?.remove();
      popover = null;
    }

    function openPopover(iss: Issue): void {
      closePopover();
      // Measure the underline's position with the hidden mirror (same metrics).
      mirror.innerHTML = `${escapeHtml(input.value.slice(0, iss.start))}<span class="grammit-anchor"></span>`;
      const anchor = mirror.querySelector('.grammit-anchor') as HTMLElement;
      const top = anchor.offsetTop;
      const left = anchor.offsetLeft;
      const lh = parseFloat(getComputedStyle(input).lineHeight) || 22;

      const pop = el('div', 'grammit-pop');
      pop.append(el('span', 'grammit-pop-label', iss.label || 'Suggestion'));
      // One button per candidate (spelling offers a few); click to accept that one.
      const candidates = iss.suggestions?.length ? [...new Set(iss.suggestions)] : [iss.suggestion];
      for (const cand of candidates) {
        const sug = el('button', 'grammit-pop-suggestion');
        sug.type = 'button';
        sug.textContent = cand ? cand : '✕ Remove';
        sug.title = 'Accept';
        sug.addEventListener('click', () => acceptIssue(iss, cand));
        pop.append(sug);
      }
      // Custom correction — accept the suggestion, or type your own replacement.
      //
      // The box starts on the SUGGESTION, not on `iss.original`. It used to hold the user's own
      // misspelling, so pressing Apply submitted the mistake, the guard called that "no change",
      // and the popover just closed: Apply did nothing at all (#255). The decision now lives in
      // apply.ts, where it is tested — including the empty value, which is a DELETION (a repeated
      // word, a stray "to") and used to be rejected as if it were an absent one.
      const custom = el('form', 'grammit-pop-custom');
      const field = el('input', 'grammit-pop-input');
      field.type = 'text';
      field.value = initialCustomValue(iss);
      field.placeholder = isRemoval(iss) ? 'Leave empty to remove…' : 'Type your own…';
      field.setAttribute('aria-label', 'Custom correction');
      const applyBtn = el('button', 'grammit-pop-apply', 'Apply');
      applyBtn.type = 'submit';
      custom.append(field, applyBtn);
      custom.addEventListener('submit', (e) => {
        e.preventDefault();
        const decision = applyDecision(field.value, iss);
        if (decision.action === 'apply') acceptIssue(iss, decision.text);
        else closePopover();
      });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closePopover();
          input.focus();
        }
        e.stopPropagation();
      });
      pop.append(custom);

      const dismiss = el('button', 'grammit-pop-dismiss', 'Dismiss');
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => dismissIssue(iss));
      pop.append(dismiss);

      wrap.append(pop);
      const x = Math.min(left, wrap.clientWidth - pop.offsetWidth - 8);
      pop.style.left = `${Math.max(8, x)}px`;
      pop.style.top = `${top + lh + 4 - wrap.scrollTop}px`;
      popover = pop;
    }

    // Apply an edit through execCommand so it joins the textarea's native undo.
    //
    // A DELETION IS NOT AN INSERT OF NOTHING. `insertText` with an empty string does not remove
    // the selection — it reports success and leaves the text alone — so every suggestion that
    // means "delete this" (a repeated word, a stray "to": rules.ts emits `suggestion: ''`, shown
    // as "Remove") silently did nothing. `delete` is the command that removes a selection, and it
    // joins the same native undo stack, which is the whole reason we go through execCommand at
    // all. `setRangeText` remains the fallback for both, for a browser that refuses either.
    function replaceRange(start: number, end: number, text: string): void {
      input.focus();
      input.setSelectionRange(start, end);
      // The command choice lives in lib/editCommand.ts, shared with the in-page checker: an
      // empty replacement is a DELETION, and insertText cannot express one. Getting that wrong
      // killed Remove in both surfaces (#255, #295); it is one rule now, not two copies.
      if (!execEdit(text)) input.setRangeText(text, start, end, 'end');
    }

    function acceptIssue(iss: Issue, suggestion: string = iss.suggestion): void {
      closePopover();
      issues = []; // drop stale underlines; runCheck repaints the rest
      renderHighlights();
      replaceRange(iss.start, iss.end, suggestion);
      autoGrow();
      if (debounce) clearTimeout(debounce);
      runToken += 1;
      runCheck(); // re-check immediately so offsets/underlines stay correct
    }

    function dismissIssue(iss: Issue): void {
      closePopover();
      dismissed.add(issueKey(iss));
      issues = issues.filter((x) => x !== iss);
      renderHighlights();
      showResultStatus();
    }

    // Apply every current suggestion at once, back-to-front, as one undoable edit.
    async function fixAll(): Promise<void> {
      closePopover();
      if (!issues.length) return;
      fixAllBtn.disabled = true;
      fixAllBtn.classList.add('is-loading');
      fixAllBtn.innerHTML = '<span class="grammit-spinner"></span><span>Fixing…</span>';
      const ordered = [...issues].sort((a, b) => b.start - a.start);
      let text = input.value;
      for (const iss of ordered) text = text.slice(0, iss.start) + iss.suggestion + text.slice(iss.end);
      input.focus();
      input.setSelectionRange(0, input.value.length);
      // execEdit for the same reason as replaceRange: if every remaining issue is a removal the
      // rebuilt text can be empty, and insertText cannot express that — it would report success
      // and leave the old text standing.
      if (!execEdit(text)) input.value = text;
      issues = [];
      renderHighlights();
      autoGrow();
      if (debounce) clearTimeout(debounce);
      runToken += 1;
      try {
        await runCheck(); // re-check the rewritten text
      } finally {
        fixAllBtn.classList.remove('is-loading');
        fixAllBtn.innerHTML = `${CHECK}<span>Fix all</span>`;
        updateActions();
      }
    }

    // Copy the current text to the clipboard, with a brief confirmation.
    async function copyText(): Promise<void> {
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.focus();
        input.select();
        document.execCommand('copy');
      }
      const label = copyBtn.querySelector('span');
      if (label) {
        const prev = label.textContent;
        label.textContent = 'Copied!';
        copyBtn.classList.add('is-done');
        setTimeout(() => {
          label.textContent = prev;
          copyBtn.classList.remove('is-done');
        }, 1400);
      }
    }

    // Clicking (or moving the caret) into an underlined span opens its suggestion.
    const onCaret = (): void => {
      if (input.selectionStart !== input.selectionEnd) {
        closePopover();
        return;
      }
      const iss = issueAt(input.selectionStart);
      if (iss) openPopover(iss);
      else closePopover();
    };
    input.addEventListener('click', onCaret);
    input.addEventListener('keyup', (e) => {
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') onCaret();
    });
    input.addEventListener('contextmenu', (e) => {
      const iss = issueAt(input.selectionStart);
      if (iss) {
        e.preventDefault();
        openPopover(iss);
      }
    });

    input.addEventListener('input', () => {
      scheduleSync();
      scheduleCheck();
    });
    wrap.addEventListener('scroll', () => {
      if (popover) closePopover();
    });
    // Close the popover on outside clicks / Escape.
    const onDocDown = (e: MouseEvent): void => {
      if (popover && !popover.contains(e.target as Node) && e.target !== input) closePopover();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    setStatus('idle', '');
    updateActions();
    requestAnimationFrame(() => {
      autoGrow();
      input.focus();
    });

    // Teardown: free the model + listeners when the window closes.
    return () => {
      if (debounce) clearTimeout(debounce);
      cancelAnimationFrame(syncFrame);
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      closePopover();
      if (corrector) corrector.dispose?.();
      else if (loadPromise) loadPromise.then((c) => c?.dispose?.()).catch(() => {});
    };
  },
};

export default app;
