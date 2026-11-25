import { el } from '../lib/dom.js';
import { setAccent } from '../lib/accent.js';

export interface WidgetItem {
  label: string;
  title?: string;
  onClick: () => void;
}
export interface ListWidgetOptions {
  title: string;
  accent: string;
  count?: number | string;
  onOpen: () => void;
  items: WidgetItem[];
  /** Max rows to show (default 5). */
  max?: number;
  /** Optional trailing "+ New …" action. */
  more?: { label: string; onClick: () => void };
}

// The shared dashboard "list" widget: an accented card with a title+count header
// that opens the app, up to `max` clickable rows, and an optional "+ more" action.
export function createListWidget({
  title,
  accent,
  count,
  onOpen,
  items,
  max = 5,
  more,
}: ListWidgetOptions): HTMLElement {
  const card = el('div', 'widget-card');
  setAccent(card, accent);

  const head = el('button', 'widget-head');
  head.append(el('span', 'widget-title', title));
  if (count != null) head.append(el('span', 'widget-count', String(count)));
  head.addEventListener('click', onOpen);
  card.append(head);

  const list = el('div', 'widget-list');
  for (const item of items.slice(0, max)) {
    const b = el('button', 'widget-note', item.label);
    if (item.title) b.title = item.title;
    b.addEventListener('click', item.onClick);
    list.append(b);
  }
  card.append(list);

  if (more) {
    const m = el('button', 'widget-more', more.label);
    m.addEventListener('click', more.onClick);
    card.append(m);
  }
  return card;
}
