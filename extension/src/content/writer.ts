// Grammit Anywhere — the on-device writing checker injected into every site.
//
// Grammarly-style: inline underlines on the focused field, a shared bottom-right chip, and
// a click-through suggestions panel with one-click Accept. Two underline techniques,
// picked by field type:
//   • <textarea>/<input>  — a mirror overlay (transparent, exactly-aligned copy of
//     the field's text whose issue spans carry the underline). The value lives off-DOM.
//   • contentEditable      — the text IS real DOM, so we address it with Ranges and
//     paint via the CSS Custom Highlight API (browser keeps it aligned through scroll/
//     reflow). Works in Gmail, Slack, Twitter/X, Reddit… (Google Docs renders to a
//     <canvas> — no text nodes — so nothing can underline there; badge/panel only.)
// All our own UI lives in one shadow root; the page's CSS can't touch it and vice
// versa. Rules only for now (spell dictionary + enable gate come next). Never
// touches password fields, and nothing ever leaves the device.

import { ruleIssues } from '../lib/grammarRules/index.js';
import { execEdit, applyToRange } from '../lib/editCommand.js';
import { floatPlacement } from '../lib/floatPlacement.js';
import { mergeIssues } from '../lib/writing.js';
import { appInstalled, STORE_NS, workspaceIdOf } from '../lib/installedApps.js';
import { watchGate } from '../lib/storageWatch.js';
import { createFieldChip, type FieldChip } from '../lib/fieldChip.js';
import { CONTENT_THEME_CSS, themeShadowHost } from '../lib/contentTheme.js';

/** This app's id — its id in apps/grammit/meta.ts. */
const GRAMMIT_APP_ID = 'grammit';

interface Issue {
  start: number;
  end: number;
  original: string;
  suggestion: string;
  label?: string;
  suggestions?: string[];
}
interface Seg {
  node: Text;
  base: number;
}

// Textareas and rich editors only — single-line <input> fields are too small for
// the badge/underlines to sit cleanly, so we skip them.
const EDITABLE_SEL = 'textarea, [contenteditable="true"], [contenteditable=""]';
const DEBOUNCE_MS = 500;

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const isTextField = (el: Element): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
const isSpell = (iss: Issue): boolean => iss.label === 'Spelling';

// kimtos brand — "Roof & dock" (mirrors @kimtos/icons; inlined so the content
// bundle stays self-contained). The roof + three dock tiles in currentColor…
const ROOF_DOCK =
  '<path d="M18 48 L50 23 L82 48" fill="none" stroke="currentColor" stroke-width="8.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<g fill="currentColor"><rect x="26" y="58" width="14" height="15" rx="4.2"/><rect x="43" y="58" width="14" height="15" rx="4.2"/><rect x="60" y="58" width="14" height="15" rx="4.2"/></g>';
const glyph = (px: number): string =>
  `<svg viewBox="0 0 100 100" width="${px}" height="${px}" style="display:block">${ROOF_DOCK}</svg>`;
// …and the full mark: gradient squircle (indigo→teal) with the white glyph.
const BRAND_MARK =
  '<svg viewBox="0 0 100 100" width="15" height="15" style="display:block"><defs>' +
  '<linearGradient id="gm-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa2ff"/>' +
  '<stop offset=".46" stop-color="#5b6cff"/><stop offset="1" stop-color="#18b6a4"/></linearGradient></defs>' +
  `<rect width="100" height="100" rx="23" fill="url(#gm-brand)"/><g style="color:#fff">${ROOF_DOCK}</g></svg>`;

// --- CSS Custom Highlight API (contentEditable underlines) ----------------------
const HL_GRAMMAR = 'grammit-grammar';
const HL_SPELL = 'grammit-spell';

// The two underline colours, defined ONCE because they are painted twice by two different
// techniques on the same feature: the mirror overlay draws them inside our shadow root, and
// contentEditable draws them through a stylesheet injected into the PAGE. That page stylesheet
// is outside any shadow root, so it cannot read a `--kt-*` var — which is why these are literals
// here rather than palette tokens, and why they are shared rather than written out twice (they
// were, and a change to one would have silently split the feature in half). Brand indigo for
// grammar, brand red for spelling; both read on a light and a dark page.
const UNDERLINE_GRAMMAR = '#5b6cff';
const UNDERLINE_SPELL = '#e5484d';
type HighlightLike = object;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => HighlightLike }).Highlight;
const hlRegistry = (
  CSS as unknown as { highlights?: { set(k: string, v: HighlightLike): void; delete(k: string): void } }
).highlights;
const supportsHighlights = (): boolean => !!HighlightCtor && !!hlRegistry;

function ensurePageHighlightStyle(): void {
  if (document.getElementById('grammit-hl-style')) return;
  const s = document.createElement('style');
  s.id = 'grammit-hl-style';
  // Injected into the PAGE (styles page text, not our shadow), so it shares the overlay's
  // underline colours rather than restating them.
  s.textContent =
    `::highlight(${HL_GRAMMAR}){text-decoration:underline wavy ${UNDERLINE_GRAMMAR};text-decoration-skip-ink:none}` +
    `::highlight(${HL_SPELL}){text-decoration:underline wavy ${UNDERLINE_SPELL};text-decoration-skip-ink:none}`;
  (document.head ?? document.documentElement).append(s);
}
function setHighlight(name: string, ranges: Range[]): void {
  if (!hlRegistry || !HighlightCtor) return;
  if (ranges.length) hlRegistry.set(name, new HighlightCtor(...ranges));
  else hlRegistry.delete(name);
}
function clearHighlights(): void {
  hlRegistry?.delete(HL_GRAMMAR);
  hlRegistry?.delete(HL_SPELL);
}

// Nearest block-level ancestor — used to insert a "\n" between blocks so words don't
// merge across lines (Gmail/Slack wrap each line in its own <div>).
function blockOf(node: Node, root: Element): Element {
  let el = node.parentElement;
  while (el && el !== root) {
    const d = getComputedStyle(el).display;
    if (d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d.startsWith('table')) return el;
    el = el.parentElement;
  }
  return root;
}
// Flatten an editable's text nodes into one string + a map back to each node.
function flatten(root: Element): { text: string; segs: Seg[] } {
  const segs: Seg[] = [];
  let text = '';
  let prevBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const block = blockOf(t, root);
    if (prevBlock !== null && block !== prevBlock) text += '\n';
    segs.push({ node: t, base: text.length });
    text += t.data;
    prevBlock = block;
  }
  return { text, segs };
}
function locate(segs: Seg[], offset: number): { node: Text; offset: number } | null {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (offset >= s.base) return { node: s.node, offset: Math.min(offset - s.base, s.node.length) };
  }
  return segs[0] ? { node: segs[0].node, offset: 0 } : null;
}
function makeRange(segs: Seg[], start: number, end: number): Range | null {
  const a = locate(segs, start);
  const b = locate(segs, end);
  if (!a || !b) return null;
  const r = new Range();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return r;
}

// --- shadow UI (badge + mirror overlay + suggestions panel) --------------------
// Styled to match the kimtos OS. The content script lives in the PAGE's document, so it can't
// read the extension's :root tokens — `lib/contentTheme.ts` is the one mirror of their VALUES,
// and it follows the Appearance setting rather than only the OS, which is what this block used
// to do (#1173). What stays local is what is NOT palette: the brand gradient (see
// `content/brand.ts` on why the mark is inline), the font stack and this panel's own radius.
const CSS_UI = `
${CONTENT_THEME_CSS}
:host {
  --gm-radius:16px;
  --gm-grad:linear-gradient(150deg,#8aa2ff,#5b6cff 46%,#18b6a4);
  --gm-font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
}
* { box-sizing: border-box; }
.overlay { position:absolute; overflow:hidden; pointer-events:none; }
.overlay .inner { position:absolute; top:0; left:0; margin:0; border-style:solid; border-color:transparent;
  color:transparent !important; background:transparent; overflow-wrap:break-word; }
.overlay mark { background:transparent; color:transparent; border-bottom:2px solid ${UNDERLINE_SPELL}; border-radius:1px;
  pointer-events:auto; cursor:pointer; }
.overlay mark.grammar { border-color:${UNDERLINE_GRAMMAR}; }
.panel { position:absolute; width:300px; max-height:360px; overflow:auto; pointer-events:auto;
  background:var(--kt-panel); color:var(--kt-text); border:1px solid var(--kt-hairline); border-radius:var(--gm-radius);
  box-shadow:var(--kt-shadow); backdrop-filter:blur(20px); font:400 13px/1.5 var(--gm-font); }
.head { padding:11px 14px; font-weight:700; border-bottom:1px solid var(--kt-hairline); display:flex;
  justify-content:space-between; align-items:center; }
.head-right { display:flex; align-items:center; gap:10px; }
.head button { background:none; border:0; color:var(--kt-text-secondary); font-size:15px; cursor:pointer; line-height:1; padding:0; }
.head .accept-all { background:var(--gm-grad); color:var(--kt-on-accent); border:0; border-radius:8px; padding:4px 11px; font:600 11px var(--gm-font); cursor:pointer; line-height:1.4; }
.card { padding:10px 14px; border-bottom:1px solid var(--kt-hairline); }
.card:last-child { border-bottom:0; }
.lbl { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--kt-text-secondary); }
.sug { margin:4px 0 8px; }
.old { text-decoration:line-through; color:var(--kt-text-secondary); }
.new { color:${UNDERLINE_GRAMMAR}; font-weight:700; }
.act { display:flex; gap:8px; }
.act button { border:0; border-radius:8px; padding:5px 12px; font-weight:600; cursor:pointer; font-family:var(--gm-font); }
.act .accept { background:var(--gm-grad); color:var(--kt-on-accent); }
.act .dismiss { background:var(--kt-surface); color:var(--kt-text); }
.act .dismiss:hover { background:var(--kt-surface-hover); }
.empty { padding:18px; color:var(--kt-text-secondary); text-align:center; }
.foot { display:flex; align-items:center; gap:6px; padding:9px 14px; border-top:1px solid var(--kt-hairline);
  font-size:11px; color:var(--kt-text-secondary); }
.foot .dh { font-weight:700; background:var(--gm-grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
`;

let root: ShadowRoot | null = null;
let overlay: HTMLDivElement;
let inner: HTMLDivElement;
let chip: FieldChip | null = null;
let panel: HTMLDivElement;

let host: HTMLElement | null = null;
let untheme: (() => void) | null = null;

function ensureUI(): void {
  if (root) return;
  host = document.createElement('div');
  host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS_UI;
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  inner = document.createElement('div');
  inner.className = 'inner';
  overlay.append(inner);
  panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.display = 'none';
  root.append(style, overlay, panel);
  untheme = themeShadowHost(host);
  document.documentElement.append(host);
  for (const node of [overlay, panel]) node.addEventListener('mousedown', (e) => e.preventDefault());
  // The affordance is now the shared field chip (#511): bottom-right, stacked with
  // Clipboard's, draggable. Order 1 = left of Clipboard (order 0). Click toggles the panel.
  chip = createFieldChip({
    name: 'grammit',
    order: 1,
    icon: glyph(15),
    title: 'Grammit — writing suggestions',
    onClick: () => (panelOpen ? closePanel() : openPanel()),
  });
}

// --- state ---------------------------------------------------------------------
let activeEl: Element | null = null;
let issues: Issue[] = [];
let segs: Seg[] = []; // node map for the active contentEditable (empty for text fields)
let timer: ReturnType<typeof setTimeout> | null = null;
let panelOpen = false;

const MIRROR_PROPS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'letter-spacing',
  'text-transform',
  'text-indent',
  'line-height',
  'text-align',
  'word-spacing',
  'tab-size',
];
function syncMirror(field: HTMLTextAreaElement | HTMLInputElement): void {
  const cs = getComputedStyle(field);
  for (const p of MIRROR_PROPS) inner.style.setProperty(p, cs.getPropertyValue(p));
  inner.style.whiteSpace = field instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
}
function paintOverlay(field: HTMLTextAreaElement | HTMLInputElement): void {
  const text = field.value;
  let html = '';
  let last = 0;
  for (const iss of [...issues].sort((a, b) => a.start - b.start)) {
    if (iss.start < last) continue;
    html +=
      esc(text.slice(last, iss.start)) +
      `<mark class="${isSpell(iss) ? 'spell' : 'grammar'}">${esc(text.slice(iss.start, iss.end))}</mark>`;
    last = iss.end;
  }
  html += esc(text.slice(last)) + '​';
  inner.innerHTML = html;
  for (const m of inner.querySelectorAll('mark')) m.addEventListener('click', () => openPanel());
}

function place(): void {
  if (!activeEl) return;
  const r = activeEl.getBoundingClientRect();
  const sx = window.scrollX;
  const sy = window.scrollY;
  if (activeEl instanceof HTMLElement) chip?.show(activeEl); // chip re-glues to the field's bottom-right
  if (isTextField(activeEl)) {
    overlay.style.display = '';
    overlay.style.left = `${sx + r.left}px`;
    overlay.style.top = `${sy + r.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
    inner.style.width = `${r.width}px`;
    inner.style.transform = `translate(${-activeEl.scrollLeft}px, ${-activeEl.scrollTop}px)`;
  } else {
    overlay.style.display = 'none';
  }
  if (panelOpen) {
    // Keep the panel on-screen: below the field by default, flipped above when there is no room,
    // and clamped horizontally so it never spills past a viewport edge (#308).
    const { left, top } = floatPlacement(
      { left: r.left, top: r.top, bottom: r.bottom },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${sx + left}px`;
    panel.style.top = `${sy + top}px`;
  }
}

function renderPanel(): void {
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.textContent = issues.length ? `${issues.length} suggestion${issues.length > 1 ? 's' : ''}` : 'No issues';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', () => closePanel());
  const right = document.createElement('div');
  right.className = 'head-right';
  if (issues.length > 1) {
    const aa = document.createElement('button');
    aa.className = 'accept-all';
    aa.textContent = 'Accept all';
    aa.addEventListener('click', () => acceptAll());
    right.append(aa);
  }
  right.append(close);
  head.append(title, right);
  const nodes: HTMLElement[] = [head];
  if (!issues.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Looks clean ✓';
    nodes.push(e);
  }
  for (const iss of issues) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      `<div class="lbl">${esc(iss.label || 'Suggestion')}</div>` +
      `<div class="sug"><span class="old">${esc(iss.original)}</span> → <span class="new">${esc(iss.suggestion)}</span></div>`;
    const act = document.createElement('div');
    act.className = 'act';
    const accept = document.createElement('button');
    accept.className = 'accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => applyFix(iss));
    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      issues = issues.filter((x) => x !== iss);
      refresh();
    });
    act.append(accept, dismiss);
    card.append(act);
    nodes.push(card);
  }
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = `${BRAND_MARK}<span>Powered by <span class="dh">KimtOS</span></span>`;
  nodes.push(foot);
  panel.replaceChildren(...nodes);
}

function applyFix(iss: Issue): void {
  const field = activeEl;
  if (!field) return;
  if (isTextField(field)) {
    field.focus();
    try {
      field.setRangeText(iss.suggestion, iss.start, iss.end, 'end');
    } catch {
      field.value = field.value.slice(0, iss.start) + iss.suggestion + field.value.slice(iss.end);
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // contentEditable: select the range and let execCommand replace it, so the
    // editor's own input handling (React/ProseMirror/etc.) stays in sync.
    const r = makeRange(segs, iss.start, iss.end);
    if (r) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      (field as HTMLElement).focus();
      // execEdit, not insertText: a removal suggestion (`suggestion: ''` — a repeated word, a
      // stray "to", shown as "Remove") is a DELETION, and inserting an empty string deletes
      // nothing. It reported success and left the text alone, so Remove was dead on every
      // contentEditable — Gmail, Slack, Notion, most rich editors on the web (#295).
      if (!execEdit(iss.suggestion)) applyToRange(r, iss.suggestion, field as HTMLElement);
    }
  }
  check(field);
}

// Apply every currently-shown suggestion in one pass. We must SNAPSHOT the list first:
// each applyFix ends in check(), which sets `issues = ruleIssues(text)` synchronously and
// only folds the SPELLING results back in asynchronously (from the worker). So re-reading
// issues[0] between fixes dropped every spelling suggestion — "Accept all" fixed just one
// misspelling per click (#252). mergeIssues guarantees the spans don't overlap, so applying
// the snapshot back-to-front (highest start first) keeps every not-yet-applied offset valid
// without depending on a re-check — true for both the textarea path and contentEditable
// (whose segment map check() rebuilds after each edit anyway).
function acceptAll(): void {
  if (!activeEl) return;
  const ordered = [...issues].sort((a, b) => b.start - a.start);
  for (const iss of ordered) {
    if (!activeEl) break;
    applyFix(iss);
  }
}

function openPanel(): void {
  if (!panel) return; // UI not built yet (no editable focused) — nothing to open
  panelOpen = true;
  panel.style.display = '';
  renderPanel();
  place();
}
function closePanel(): void {
  panelOpen = false;
  // closePanel runs from detach(), which can fire on a focusout before any
  // editable was focused (so ensureUI() hasn't built the panel yet).
  if (panel) panel.style.display = 'none';
}

function refresh(): void {
  if (!activeEl) return;
  const has = issues.length > 0;
  if (activeEl instanceof HTMLElement) chip?.show(activeEl);
  chip?.setCount(has ? issues.length : null); // count badge only when there are suggestions
  if (isTextField(activeEl)) {
    clearHighlights();
    syncMirror(activeEl);
    paintOverlay(activeEl);
  } else {
    inner.innerHTML = '';
    overlay.style.display = 'none';
    if (supportsHighlights()) {
      ensurePageHighlightStyle();
      const grammar: Range[] = [];
      const spell: Range[] = [];
      for (const iss of issues) {
        const r = makeRange(segs, iss.start, iss.end);
        if (r) (isSpell(iss) ? spell : grammar).push(r);
      }
      setHighlight(HL_GRAMMAR, grammar);
      setHighlight(HL_SPELL, spell);
    }
  }
  if (panelOpen) renderPanel();
  place();
}

// Ask the service worker to spell-check. The 60k-word dictionary cannot live in here:
// a content script is a single IIFE injected into EVERY page, so bundling it inflated
// this file from 24 kB to 543 kB. The worker holds one index and answers for all tabs.
// Any failure (worker asleep, app not installed) resolves to [] — the rule results still stand.
function spellFromWorker(text: string): Promise<Issue[]> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'grammit:spell', text }, (res?: { ok?: boolean; issues?: Issue[] }) => {
        if (chrome.runtime.lastError || !res?.ok) return resolve([]);
        resolve(res.issues ?? []);
      });
    } catch {
      resolve([]);
    }
  });
}

// Bumped on every check, so a slow spell response for text the user has already moved
// past is discarded instead of overwriting the current results.
let checkSeq = 0;

function check(field: Element): void {
  const seq = ++checkSeq;
  let text: string;
  if (isTextField(field)) {
    text = field.value;
    issues = text.trim() ? ruleIssues(text) : [];
    segs = [];
  } else {
    const f = flatten(field);
    segs = f.segs;
    text = f.text;
    issues = text.trim() ? ruleIssues(text) : [];
  }
  // Show the rules immediately — they are synchronous and instant.
  if (activeEl === field) refresh();

  // Then fold in spelling when it arrives. Rules win over spelling on any overlapping
  // span (mergeIssues), so a curated typo isn't ALSO reported as a raw misspelling.
  if (!text.trim()) return;
  void spellFromWorker(text).then((spell) => {
    if (seq !== checkSeq || activeEl !== field || !spell.length) return; // superseded
    issues = mergeIssues(issues, spell) as Issue[];
    refresh();
  });
}

function onInput(): void {
  if (!activeEl) return;
  chip?.markActivity(); // fade while typing, matching Clipboard's chip
  const el = activeEl;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => check(el), DEBOUNCE_MS);
}

function detach(): void {
  clearHighlights();
  if (activeEl) {
    activeEl.removeEventListener('input', onInput);
    activeEl.removeEventListener('scroll', place);
  }
  activeEl = null;
  issues = [];
  segs = [];
  closePanel();
  chip?.hide();
  if (overlay) overlay.style.display = 'none';
}

function onFocusIn(e: Event): void {
  const el = (e.target as Element | null)?.closest?.(EDITABLE_SEL);
  if (el) focusField(el);
}

// Split out of onFocusIn so activate() can adopt a field that is ALREADY focused: a user who
// enables it mid-sentence is looking at a focused textarea, and there will be no focusin event
// to wait for.
function focusField(el: Element): void {
  ensureUI();
  if (activeEl && activeEl !== el) detach();
  activeEl = el;
  el.addEventListener('input', onInput);
  el.addEventListener('scroll', place);
  check(el);
}

function onFocusOut(): void {
  setTimeout(() => {
    const a = document.activeElement;
    if (a?.closest?.(EDITABLE_SEL)) return;
    detach();
  }, 0);
}

function enabled(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORE_NS, 'grammitAnywhere'], (v) => {
        // Per-user (#489): `grammitAnywhere` is `{ byWs: { [workspaceId]: { enabled } } }`, read
        // for the active workspace (resolved from the `kimtos` blob this get already fetched). A
        // legacy scalar `{ enabled }` (no writer creates one today — defensive) has no `byWs`.
        const stored = v?.grammitAnywhere as { byWs?: Record<string, { enabled?: boolean }> } | undefined;
        const cfg = (stored?.byWs ? (stored.byWs[workspaceIdOf(v?.[STORE_NS])] ?? {}) : (stored ?? {})) as {
          enabled?: boolean;
        };
        resolve(cfg.enabled ?? true);
      });
    } catch {
      resolve(true);
    }
  });
}

/** This content script is injected into EVERY page, so without a gate it would underline for
 *  users who never installed Grammit. Ask the shared install rule (lib/installedApps.ts), fed with
 *  the only state a content script can read (the `kimtos` chrome.storage blob). */
const installed = (): Promise<boolean> => appInstalled(GRAMMIT_APP_ID);

// These were anonymous arrow functions, which cannot be passed to removeEventListener — so
// there was no way to take them off again even if anyone had tried to.
const onScroll = (): void => {
  if (activeEl) place();
};
const onResize = (): void => {
  if (activeEl) place();
};

/** The setting key `enabled()` reads, and the store blob `installed()` reads. */
const GATE_KEYS = [STORE_NS, 'grammitAnywhere'];

function activate(): void {
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  // A field may already be focused — someone who installs it mid-sentence is looking at a focused
  // textarea, and no focusin event is coming.
  const focused = document.activeElement?.closest?.(EDITABLE_SEL);
  if (focused) focusField(focused);
}

// Uninstalling has to take the feature OFF this page, not just stop refreshing it. This is the
// half that matters: without it, a tab left open across an uninstall keeps underlining.
function deactivate(): void {
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
  detach(); // drops the overlay, the chip and the current field's issues
  clearHighlights(); // the contentEditable underlines are painted on the PAGE, not in our shadow
  closePanel();
  if (timer) clearTimeout(timer);
  timer = null;
  // Take our UI out of the page entirely. ensureUI() rebuilds it if the user installs it again.
  // The chip is a separate host in document.body, so remove it explicitly.
  chip?.destroy();
  chip = null;
  untheme?.();
  untheme = null;
  host?.remove();
  host = null;
  root = null;
  document.getElementById('grammit-hl-style')?.remove();
}

// The gate is now a SUBSCRIPTION, not a snapshot. It switches the feature on when the user
// installs the app (no reload needed), and off the moment they uninstall it.
watchGate(
  async () => (await installed()) && (await enabled()),
  (on) => (on ? activate() : deactivate()),
  GATE_KEYS,
);
