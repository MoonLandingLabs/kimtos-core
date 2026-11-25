// One shared in-field chip UI for content-script affordances (Grammit, Clipboard, …).
// Every app's field button is a matched sibling — same look, same bottom-right
// placement, the same fade-while-typing and the same draggable nudge — instead of a
// bespoke corner control that lands on top of the text (#511). Framework-free and
// content-script-safe (the same layer as the shared install gate), so it bundles
// into every content script without pulling in the DOM-heavy app code.

import { CONTENT_THEME_CSS, themeShadowHost } from './contentTheme.js';

const CHIP_ATTR = 'data-kimtos-chip'; // marks a chip host so chips from OTHER content-script
const ORDER_ATTR = 'data-kimtos-chip-order'; // bundles can be found + stacked without collision
const OFFSET_KEY = 'kimtos:fieldChipOffset';
const SIZE = 26; // chip box, px
const GAP = 6; // between stacked chips
const EDGE = 6; // inset from the field's bottom-right corner
const DRAG_THRESHOLD = 4; // px a press must travel before it becomes a drag (not a click)

type Offset = { dx: number; dy: number };

interface LocalArea {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface ChromeLike {
  storage?: { local?: LocalArea };
}
const localArea = (): LocalArea | null => (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local ?? null;

// The draggable nudge is shared across every chip (drag one, the pair moves) and
// persisted globally so it survives navigation. Loaded once, kept live.
let sharedOffset: Offset = { dx: 0, dy: 0 };
const offsetListeners = new Set<() => void>();
const notifyOffset = (): void => offsetListeners.forEach((f) => f());

void (async () => {
  const local = localArea();
  if (!local) return;
  const v = (await local.get(OFFSET_KEY))[OFFSET_KEY] as Partial<Offset> | undefined;
  if (v && typeof v.dx === 'number' && typeof v.dy === 'number') {
    sharedOffset = { dx: v.dx, dy: v.dy };
    notifyOffset();
  }
})();

function persistOffset(o: Offset): void {
  sharedOffset = o;
  notifyOffset();
  void localArea()?.set({ [OFFSET_KEY]: o });
}

const CHIP_CSS = `
  :host { all: initial; }
${CONTENT_THEME_CSS}
  .wrap { position: relative; }
  .chip { display:flex; align-items:center; justify-content:center; box-sizing:border-box;
    width:${SIZE}px; height:${SIZE}px; border-radius:8px; background:var(--kt-panel);
    border:1px solid var(--kt-hairline); box-shadow:var(--kt-shadow);
    color:var(--kt-text); cursor:pointer; opacity:.85; transition:opacity .12s ease; touch-action:none;
    -webkit-user-select:none; user-select:none; }
  .chip:hover { opacity:1; }
  .chip.dim { opacity:.28; }
  .chip svg { display:block; }
  .count { position:absolute; top:-6px; right:-6px; min-width:15px; height:15px; padding:0 3px;
    box-sizing:border-box; border-radius:999px; background:var(--kt-accent); color:var(--kt-on-accent);
    font:600 10px/15px system-ui,-apple-system,sans-serif; text-align:center; pointer-events:none; }
`;

export interface FieldChip {
  /** The host in document.body (position:fixed). */
  readonly host: HTMLElement;
  /** The clickable chip element — anchor a panel to it if needed. */
  readonly button: HTMLElement;
  /** Show + place the chip against `field` (hidden for tiny/off-screen fields). */
  show(field: HTMLElement): void;
  hide(): void;
  /** Show a small count badge (e.g. Grammit's suggestion count); null/0 clears it. */
  setCount(n: number | null): void;
  /** Dim the chip briefly — call on the field's input so it fades while typing. */
  markActivity(): void;
  /** Remove the host and its listeners (for teardown/tests). */
  destroy(): void;
}

/**
 * Create a field chip. `order` decides the horizontal stack (lower = further right);
 * chips slot leftward past any lower-order sibling that is currently visible, so the
 * layout is gap-free whether one app or both are active — and it coordinates across
 * the two separate content-script bundles via the shared DOM markers above.
 */
export function createFieldChip(opts: {
  name: string; // stable id, also the DOM marker value
  order: number; // lower sits further right
  icon: string; // inline SVG string
  title: string;
  onClick: () => void;
}): FieldChip {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
  host.setAttribute(CHIP_ATTR, opts.name);
  host.setAttribute(ORDER_ATTR, String(opts.order));
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CHIP_CSS;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.title = opts.title;
  chip.innerHTML = opts.icon;
  const count = document.createElement('span');
  count.className = 'count';
  count.style.display = 'none';
  wrap.append(chip, count);
  shadow.append(style, wrap);
  document.body.appendChild(host);

  let field: HTMLElement | null = null;
  let dimTimer: ReturnType<typeof setTimeout> | null = null;

  const onOffset = (): void => place();
  offsetListeners.add(onOffset);
  const untheme = themeShadowHost(host);

  // How many currently-visible sibling chips sit further right (lower order) than me.
  function slotIndex(): number {
    let slot = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${CHIP_ATTR}]`))) {
      if (el === host || el.style.display === 'none') continue;
      if (Number(el.getAttribute(ORDER_ATTR)) < opts.order) slot++;
    }
    return slot;
  }

  function place(): void {
    if (!field || host.style.display === 'none') return;
    const r = field.getBoundingClientRect();
    const slot = slotIndex();
    const left = r.right - EDGE - SIZE - slot * (SIZE + GAP) + sharedOffset.dx;
    const top = r.bottom - EDGE - SIZE + sharedOffset.dy;
    host.style.left = `${Math.max(4, Math.min(window.innerWidth - SIZE - 4, left))}px`;
    host.style.top = `${Math.max(4, Math.min(window.innerHeight - SIZE - 4, top))}px`;
  }

  function show(f: HTMLElement): void {
    field = f;
    const r = f.getBoundingClientRect();
    // Skip tiny (checkbox-sized) or off-screen fields — a chip there is only noise.
    if (r.width < 44 || r.height < 16 || r.bottom < 8 || r.top > window.innerHeight - 8) {
      hide();
      return;
    }
    host.style.display = 'block';
    place();
  }

  function hide(): void {
    host.style.display = 'none';
  }

  function setCount(n: number | null): void {
    if (n && n > 0) {
      count.textContent = n > 99 ? '99+' : String(n);
      count.style.display = '';
    } else {
      count.style.display = 'none';
    }
  }

  function markActivity(): void {
    chip.classList.add('dim');
    if (dimTimer) clearTimeout(dimTimer);
    dimTimer = setTimeout(() => chip.classList.remove('dim'), 900);
  }

  // Press = click; press-and-move = drag the shared nudge (so the pair can be pulled
  // off a field's own controls). `pointerdown` is prevented so the field keeps focus.
  let down: { x: number; y: number; base: Offset } | null = null;
  let dragged = false;
  chip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = { x: e.clientX, y: e.clientY, base: { ...sharedOffset } };
    dragged = false;
    try {
      chip.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture is unavailable in some test/dom shims — dragging still works.
    }
  });
  chip.addEventListener('pointermove', (e) => {
    if (!down) return;
    const mdx = e.clientX - down.x;
    const mdy = e.clientY - down.y;
    if (!dragged && Math.hypot(mdx, mdy) < DRAG_THRESHOLD) return;
    dragged = true;
    sharedOffset = { dx: down.base.dx + mdx, dy: down.base.dy + mdy };
    notifyOffset(); // live-move every chip while dragging
  });
  const endPress = (): void => {
    if (!down) return;
    if (dragged) persistOffset(sharedOffset);
    else opts.onClick();
    down = null;
  };
  chip.addEventListener('pointerup', endPress);
  chip.addEventListener('pointercancel', () => {
    down = null;
  });

  function destroy(): void {
    untheme();
    offsetListeners.delete(onOffset);
    host.remove();
  }

  return { host, button: chip, show, hide, setCount, markActivity, destroy };
}

/** Test-only: reset the shared drag nudge between cases. */
export function __resetFieldChipOffset(): void {
  sharedOffset = { dx: 0, dy: 0 };
  notifyOffset();
}
