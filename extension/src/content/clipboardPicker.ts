// KimtOS Clipboard — the in-page history picker + the on-field paste button.
// Opened by a hotkey (Alt+Shift+V), the right-click menu, OR the little KimtOS
// button that appears on any focused text field. Lets you grab a past clip and
// paste it without switching to the KimtOS tab. Everything lives in shadow roots
// (the page's CSS can't touch it). The history comes from the background SW (a
// content script can't read the extension DB). On pick it inserts into the field
// you were in — or copies to the clipboard if none is focused.

/* global chrome */
import { clipboardActiveCached, deliveryFor, type ClipItem } from '../lib/clipboardShared.js';
import { brandMark } from './brand.js';
import { createFieldChip, type FieldChip } from '../lib/fieldChip.js';
import { showToast } from './toast.js';
import { CONTENT_THEME_CSS, themeShadowHost } from '../lib/contentTheme.js';

let host: HTMLElement | null = null;
let allClips: ClipItem[] = [];
let loaded = false;
let redraw: (() => void) | null = null;
let untheme: (() => void) | null = null;

// The field + selection that was focused when the picker opened (the overlay's
// search box steals focus while open, so we restore this to paste).
let savedEl: Element | null = null;
let savedRange: { start: number; end: number } | null = null;
let savedDomRange: Range | null = null;

// The last-focused editable, so the on-field button (which we keep from stealing
// focus) still knows where to paste.
let targetField: HTMLElement | null = null;

export function initPicker(): void {
  // Primary trigger: the SW forwards the global command / right-click menu.
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'clip:open-picker') void openPicker();
  });
  // Fallback trigger: some Chrome profiles don't bind the manifest command (a
  // conflicting shortcut), so also catch Alt+Shift+V on the page. `code` is
  // keyboard-layout independent. openPicker() no-ops if already open.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || !clipboardActiveCached()) return;
      if (e.code === 'KeyV') {
        e.preventDefault();
        void openPicker();
        return;
      }
      // Alt+Shift+1/2/3 → paste the Nth most-recent clip straight into the field.
      const m = /^Digit([1-3])$/.exec(e.code);
      if (m) {
        e.preventDefault();
        quickPasteNth(Number(m[1]));
      }
    },
    true,
  );
  initFieldButton();
}

function isEditable(node: EventTarget | null): node is HTMLElement {
  if (node instanceof HTMLTextAreaElement) return true;
  if (node instanceof HTMLInputElement) {
    return node.type !== 'password' && ['text', 'search', 'url', 'email', 'tel', 'number', ''].includes(node.type);
  }
  return node instanceof HTMLElement && node.isContentEditable;
}

function rememberFocus(): void {
  const active = document.activeElement;
  savedEl = isEditable(active) ? active : targetField;
  savedRange = null;
  savedDomRange = null;
  if (savedEl instanceof HTMLInputElement || savedEl instanceof HTMLTextAreaElement) {
    savedRange = {
      start: savedEl.selectionStart ?? savedEl.value.length,
      end: savedEl.selectionEnd ?? savedEl.value.length,
    };
  } else if (savedEl instanceof HTMLElement && savedEl.isContentEditable) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) savedDomRange = sel.getRangeAt(0).cloneRange();
  }
}

function fetchClips(): Promise<ClipItem[]> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'clip:list' }, (resp?: { clips?: ClipItem[] }) => {
        if (chrome.runtime.lastError) resolve([]);
        else resolve(resp?.clips || []);
      });
    } catch {
      resolve([]);
    }
  });
}

/** Insert into the remembered field (paste), or copy to the clipboard if none. */
// An EMPTY paste must be a no-op, never an edit — but not because every branch is destructive with
// '': setRangeText('') replaces the selection with nothing and writeText('') wipes the system
// clipboard, so THOSE two must be guarded. execCommand('insertText', '') is NOT destructive — it is
// a silent no-op that leaves the selection untouched (believing otherwise shipped #255/#295; the
// command that actually removes a selection is 'delete' — see lib/editCommand.ts). Picking an image
// clip used to land here with '' and, via setRangeText, silently delete whatever the user had
// selected (#250).
//
// deliveryFor() already makes sure this is never CALLED with '' — this guard is the second line, so
// that a future caller cannot reintroduce the bug by reading `clip.text` directly again. Exported
// so that second line is actually tested rather than merely asserted: an untested guard is a
// decorative one.
export function pasteItem(text: string): void {
  if (!text) return;
  const el = savedEl;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    const start = savedRange?.start ?? el.value.length;
    const end = savedRange?.end ?? el.value.length;
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    if (savedDomRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedDomRange);
    }
    document.execCommand('insertText', false, text);
    return;
  }
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/**
 * Hand the chosen clip to the user.
 *
 * A TEXT clip is pasted where they were. An IMAGE clip cannot be — there is no way to insert a
 * picture into an arbitrary input — so it goes onto the SYSTEM clipboard instead, and we say so.
 * That keeps the feature (the image is one keystroke away) instead of deleting it, and it is the
 * same thing the Clipboard app itself does with an image clip.
 *
 * Nothing here can be destructive: `none` does nothing at all, and a failed image copy tells the
 * user rather than falling back to pasting an empty string, which is the bug this replaces (#250).
 */
function deliver(clip: ClipItem): void {
  const d = deliveryFor(clip);
  if (d.kind === 'text') {
    pasteItem(d.text);
    return;
  }
  if (d.kind === 'image') {
    void copyImageToClipboard(d.id);
    return;
  }
  // kind === 'none': a clip with nothing to give. Do nothing — do NOT paste ''.
}

async function copyImageToClipboard(id: string): Promise<void> {
  try {
    const resp = await new Promise<{ dataUrl?: string; mime?: string } | undefined>((resolve) => {
      chrome.runtime.sendMessage({ type: 'clip:image', id }, (r?: { dataUrl?: string; mime?: string }) => {
        if (chrome.runtime.lastError) resolve(undefined);
        else resolve(r);
      });
    });
    if (!resp?.dataUrl) throw new Error('no image');

    const blob = await (await fetch(resp.dataUrl)).blob();
    const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!ClipboardItemCtor || !navigator.clipboard?.write) throw new Error('no clipboard write');
    await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })]);
    showToast('Image copied - press paste');
  } catch {
    // An insecure page, an old browser, a denied permission. Say so; never silently do nothing,
    // and never fall back to pasting an empty string.
    showToast("Couldn't copy that image");
  }
}

/** Insert text into whatever field is focused right now (for quick-paste). */
function pasteIntoActive(text: string): void {
  if (!text) return; // same rule: never turn a paste into a deletion
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    document.execCommand('insertText', false, text);
  } else {
    void navigator.clipboard?.writeText(text).catch(() => {});
  }
}

/** Ask the SW for the Nth most-recent clip and paste it into the focused field. */
function quickPasteNth(n: number): void {
  try {
    chrome.runtime.sendMessage({ type: 'clip:nth', n }, (resp?: { text?: string }) => {
      if (chrome.runtime.lastError || !resp?.text) return;
      pasteIntoActive(resp.text);
    });
  } catch {
    // Extension context gone (reloaded) — ignore.
  }
}

function closePicker(): void {
  untheme?.();
  untheme = null;
  host?.remove();
  host = null;
  redraw = null;
}

async function openPicker(): Promise<void> {
  if (host || !document.body || !clipboardActiveCached()) return; // already open / Clipboard not installed
  rememberFocus();
  hideButton();
  allClips = [];
  loaded = false;
  render(); // overlay appears immediately (shows "Loading…")
  allClips = await fetchClips();
  loaded = true;
  redraw?.();
}

function render(): void {
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
${CONTENT_THEME_CSS}
    .backdrop{position:fixed;inset:0;background:var(--kt-scrim)}
    .palette{position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:min(560px,92vw);
      display:flex;flex-direction:column;background:var(--kt-panel);color:var(--kt-text);border:1px solid var(--kt-hairline);
      border-radius:14px;box-shadow:var(--kt-shadow);overflow:hidden;
      font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .q{border:0;outline:0;padding:14px 16px;font-size:15px;color:var(--kt-text);background:transparent;
      border-bottom:1px solid var(--kt-hairline)}
    .list{max-height:46vh;overflow-y:auto;padding:6px}
    .row{padding:9px 11px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--kt-text)}
    .row.on{background:color-mix(in srgb, var(--kt-accent) 22%, transparent)}
    .msg{padding:22px;text-align:center;color:var(--kt-text-secondary)}
    .hint{padding:8px 14px;border-top:1px solid var(--kt-hairline);font-size:11.5px;color:var(--kt-text-secondary)}
  </style>
  <div class="backdrop"></div>
  <div class="palette">
    <input class="q" placeholder="Search clipboard…" spellcheck="false" />
    <div class="list"></div>
    <div class="hint">↑ ↓ navigate · Enter paste · Esc close</div>
  </div>`;
  untheme = themeShadowHost(host);
  document.body.appendChild(host);

  const q = shadow.querySelector('.q') as HTMLInputElement;
  const list = shadow.querySelector('.list') as HTMLElement;
  const backdrop = shadow.querySelector('.backdrop') as HTMLElement;
  let filtered: ClipItem[] = [];
  let active = 0;

  const paint = (): void => {
    const rows = [...list.querySelectorAll<HTMLElement>('.row')];
    rows.forEach((r, i) => r.classList.toggle('on', i === active));
    rows[active]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (i: number): void => {
    const c = filtered[i];
    if (!c) return;
    closePicker();
    deliver(c);
  };
  const draw = (): void => {
    list.replaceChildren();
    if (!filtered.length) {
      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent = loaded ? (q.value ? 'No matching clips' : 'Nothing copied yet') : 'Loading…';
      list.append(msg);
      return;
    }
    filtered.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = `row${i === active ? ' on' : ''}`;
      row.textContent = c.preview || c.text;
      row.addEventListener('click', () => choose(i));
      row.addEventListener('mousemove', () => {
        if (active !== i) {
          active = i;
          paint();
        }
      });
      list.append(row);
    });
  };

  redraw = (): void => {
    const term = q.value.trim().toLowerCase();
    filtered = term ? allClips.filter((c) => c.text.toLowerCase().includes(term)) : allClips;
    if (active >= filtered.length) active = 0;
    draw();
  };

  q.addEventListener('input', () => {
    active = 0;
    redraw?.();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, filtered.length - 1);
      paint();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    }
  });
  backdrop.addEventListener('click', () => closePicker());
  redraw();
  requestAnimationFrame(() => q.focus());
}

// --- the on-field floating button ---------------------------------------------

// The on-field affordance, on the shared chip UI (#511): bottom-right, stacked with
// Grammit's chip, fade-while-typing, draggable. Order 0 = rightmost.
let chip: FieldChip | null = null;
function ensureChip(): FieldChip {
  if (chip) return chip;
  chip = createFieldChip({
    name: 'clipboard',
    order: 0,
    icon: brandMark(15),
    title: 'Paste from KimtOS Clipboard (Alt+Shift+V)',
    onClick: () => void openPicker(),
  });
  return chip;
}
function hideButton(): void {
  chip?.hide();
}

function initFieldButton(): void {
  document.addEventListener(
    'focusin',
    (e) => {
      if (isEditable(e.target) && clipboardActiveCached()) {
        targetField = e.target;
        ensureChip().show(e.target);
      }
    },
    true,
  );
  document.addEventListener(
    'focusout',
    () => {
      // Delay so a click on the chip (whose pointerdown we swallow) still lands.
      window.setTimeout(() => {
        if (!isEditable(document.activeElement)) chip?.hide();
      }, 150);
    },
    true,
  );
  // Fade the chip while typing, matching Grammit's.
  document.addEventListener(
    'input',
    (e) => {
      if (e.target === targetField) chip?.markActivity();
    },
    true,
  );
  const reposition = (): void => {
    if (targetField && isEditable(document.activeElement)) ensureChip().show(targetField);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}
