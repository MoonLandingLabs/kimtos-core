// tasks — a to-do list per day. Logic (storage, CRUD, counts) lives in
// tasks.local.js (IndexedDB); this is the sidebar-of-days + list UI, a dock
// badge of open tasks, and a home widget showing what's left today.

import './tasks.css';
import { getApi, jsonApi } from '../../lib/api.js';
import { dataStore } from '../../lib/dataStore.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { el } from '../../lib/dom.js';
import { TRASH, BURGER, PENCIL, iconButton } from '../../components/icons.js';
import appMeta from './meta.js';
import { setAccent } from '../../lib/accent.js';

interface Todo {
  id: string;
  title?: string;
  description?: string;
  done?: boolean;
  date?: string;
  overdue?: boolean;
  [key: string]: unknown;
}
interface DayCount {
  date: string;
  open: number;
  total: number;
}

const ACCENT = appMeta.accent;

// Below this layout width the day sidebar collapses to a hamburger-toggled overlay.
const NARROW = 560;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function keyOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function parseKey(key: string): Date {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function labelFor(key: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (key === keyOf(today)) return 'Today';
  if (key === keyOf(yesterday)) return 'Yesterday';
  const d = parseKey(key);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function fullDate(key: string): string {
  const d = parseKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const isDate = (v: unknown): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'A fresh to-do list for each day',
  tip: 'Drag across tasks (or tap Select) to delete several at once. Each day starts a fresh list.',
  accent: ACCENT,
  order: appMeta.order,

  // KimtAI agent tools.
  tools: [
    {
      name: 'create_task',
      description: 'Add a to-do task. Date is YYYY-MM-DD; omit for today.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' } },
        required: ['title'],
      },
      run: async (args: Record<string, unknown>) => {
        const date = isDate(args.date) ? String(args.date) : keyOf(new Date());
        const t = (await jsonApi('POST', 'todos', {
          date,
          title: String(args.title || '').trim(),
        })) as Todo;
        return { ok: true, result: `Added "${t.title}" for ${date}.`, summary: `added "${t.title}"` };
      },
    },
    {
      name: 'list_tasks',
      description: 'List tasks for a day (YYYY-MM-DD; omit for today). Returns each task id.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } },
        required: [],
      },
      run: async (args: Record<string, unknown>) => {
        const date = isDate(args.date) ? String(args.date) : keyOf(new Date());
        const { todos } = (await getApi(`todos?date=${date}`)) as { todos?: Todo[] };
        const list =
          (todos || []).map((t) => `${t.id} · ${t.done ? '[x]' : '[ ]'} ${t.title}`).join('\n') || '(no tasks)';
        return { ok: true, result: `Tasks for ${date}:\n${list}`, summary: `${todos?.length || 0} task(s)` };
      },
    },
    {
      name: 'list_days',
      description: 'List the days that have tasks, with open and total counts per day.',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { dates } = (await getApi('todos/dates')) as { dates?: DayCount[] };
        const list = (dates || []).map((d) => `${d.date} · ${d.open} open / ${d.total} total`).join('\n') || '(none)';
        return { ok: true, result: list, summary: `${dates?.length || 0} day(s)` };
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task done (get its id from list_tasks).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const t = (await jsonApi('PATCH', `todos/${String(args.id)}`, { done: true })) as Todo;
        return { ok: true, result: `Completed "${t.title}".`, summary: `completed "${t.title}"` };
      },
    },
    {
      name: 'uncomplete_task',
      description: 'Mark a completed task as not done again (get its id from list_tasks).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const t = (await jsonApi('PATCH', `todos/${String(args.id)}`, { done: false })) as Todo;
        return { ok: true, result: `Reopened "${t.title}".`, summary: `reopened "${t.title}"` };
      },
    },
    {
      name: 'update_task',
      description: 'Change a task’s title and/or reschedule it to another day (date YYYY-MM-DD). Id from list_tasks.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['id'],
      },
      run: async (args: Record<string, unknown>) => {
        const patch: Record<string, unknown> = {};
        if (args.title != null) patch.title = String(args.title);
        if (isDate(args.date)) patch.date = String(args.date);
        if (!Object.keys(patch).length)
          return { ok: false, result: 'Provide a new title and/or a date (YYYY-MM-DD).', summary: 'nothing to change' };
        const t = (await jsonApi('PATCH', `todos/${String(args.id)}`, patch)) as Todo;
        return { ok: true, result: `Updated "${t.title}" (${t.date}).`, summary: `updated "${t.title}"` };
      },
    },
    {
      name: 'delete_task',
      description: 'Delete a task (get its id from list_tasks).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `todos/${String(args.id)}`);
        return { ok: true, result: 'Task deleted.', summary: 'deleted a task' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall).
  dataLabel: 'to-do lists',
  hasData: () => dataStore.hasAny('todos'),
  async clearData() {
    await dataStore.clearCollection('todos');
  },

  // Dock notification: total open (not-done) tasks across all days.
  async badge(): Promise<number> {
    try {
      const { dates } = (await getApi('todos/dates')) as { dates?: DayCount[] };
      return (dates || []).reduce((sum, d) => sum + d.open, 0);
    } catch {
      return 0;
    }
  },

  // Home card: today's open tasks plus anything still unfinished from earlier days.
  widgetLabel: "Pin today's tasks",
  widgetHint: 'Show open to-dos on the home',
  async widget(ctx: { openApp: (id: string) => void; refresh: () => void }): Promise<HTMLElement | null> {
    const today = keyOf(new Date());
    let data: { overdue?: Todo[]; today?: Todo[] };
    try {
      data = (await getApi(`todos/pending?today=${today}`)) as { overdue?: Todo[]; today?: Todo[] };
    } catch {
      return null;
    }
    const overdue = (data.overdue || []).map((t) => ({ ...t, overdue: true }));
    const todayOpen = (data.today || []).map((t) => ({ ...t, overdue: false }));
    const open = [...overdue, ...todayOpen]; // overdue first so it's not missed
    if (!open.length) return null;

    const card = el('div', 'widget-card');
    setAccent(card, ACCENT);

    const head = el('button', 'widget-head');
    head.append(el('span', 'widget-title', 'Today'), el('span', 'widget-count', `${open.length} left`));
    head.addEventListener('click', () => ctx.openApp('tasks'));
    card.append(head);

    const list = el('div', 'widget-list');
    open.slice(0, 5).forEach((todo) => {
      const item = el('div', 'widget-item');
      const check = el('input', 'todo-check');
      check.type = 'checkbox';
      check.addEventListener('change', async () => {
        await jsonApi('PATCH', `todos/${todo.id}`, { done: true });
        ctx.refresh();
      });
      item.append(check, el('span', 'widget-item-title', todo.title));
      if (todo.overdue) item.append(el('span', 'widget-item-tag', labelFor(todo.date!)));
      list.append(item);
    });
    if (open.length > 5) {
      const more = el('button', 'widget-more', `+${open.length - 5} more`);
      more.addEventListener('click', () => ctx.openApp('tasks'));
      list.append(more);
    }
    card.append(list);
    return card;
  },

  render(body: HTMLElement, ctx: { session?: unknown; saveSession?: (s: unknown) => void } = {}) {
    let dates: string[] = [];
    let openByDate: Record<string, number> = {};
    // Come back to the day the user was looking at (#1172). A remembered day that no longer has a
    // list falls back to today below, exactly like any other stale selection.
    let selected = (ctx.session as { day?: string } | null)?.day ?? keyOf(new Date());

    let narrow = false;

    // Multi-select batch delete AND the per-row delete, so both offer the same undo.
    // `onChange` is the full refresh: a delete changes a day's open count, so repainting
    // only the list would leave the sidebar dots stale.
    const bulk = createBulkSelect({
      noun: 'task',
      remove: async (todo) => {
        await jsonApi('DELETE', `todos/${todo.id}`);
      },
      onChange: () => refresh(),
    });

    const layout = el('div', 'todo-layout');
    const sidebar = el('nav', 'todo-sidebar');
    const main = el('div', 'todo-main');
    layout.append(sidebar, main);
    body.replaceChildren(layout);

    const toggleSidebar = (): void => void layout.classList.toggle('collapsed');

    // Collapse the day sidebar into an overlay when the window gets too narrow.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const isNarrow = w > 0 && w < NARROW;
      if (isNarrow === narrow) return;
      narrow = isNarrow;
      layout.classList.toggle('is-narrow', narrow);
      layout.classList.toggle('collapsed', narrow);
    });
    ro.observe(layout);

    // When the day sidebar is an open overlay, a click outside it closes it.
    layout.addEventListener('click', (e) => {
      if (!narrow || layout.classList.contains('collapsed')) return;
      const target = e.target as Element | null;
      if (target?.closest('.todo-sidebar') || target?.closest('.todo-burger')) return;
      layout.classList.add('collapsed');
    });

    async function refresh(): Promise<void> {
      let recorded: DayCount[] = [];
      try {
        recorded = ((await getApi('todos/dates')) as { dates?: DayCount[] }).dates || [];
      } catch {
        // ignore; loadTodos surfaces connection errors
      }
      openByDate = {};
      recorded.forEach((r) => {
        openByDate[r.date] = r.open;
      });
      const today = keyOf(new Date());
      dates = [...new Set([today, ...recorded.map((r) => r.date)])].sort().reverse();
      if (!dates.includes(selected)) {
        selected = today;
        ctx.saveSession?.({ day: today }); // the remembered day is gone — do not keep restoring it
      }
      drawSidebar();
      await loadTodos();
    }

    function drawSidebar(): void {
      sidebar.replaceChildren(
        ...dates.map((key) => {
          const btn = el('button', 'todo-day' + (key === selected ? ' is-active' : ''));
          btn.append(el('span', undefined, labelFor(key)));
          if (openByDate[key] > 0) {
            const dot = el('span', 'todo-day-dot');
            dot.title = `${openByDate[key]} open`;
            btn.append(dot);
          }
          btn.addEventListener('click', () => {
            selected = key;
            ctx.saveSession?.({ day: key });
            drawSidebar();
            loadTodos();
            if (narrow) layout.classList.add('collapsed');
          });
          return btn;
        }),
      );
    }

    async function loadTodos(): Promise<void> {
      try {
        const { todos } = (await getApi(`todos?date=${selected}`)) as { todos?: Todo[] };
        drawMain(todos || []);
      } catch (err) {
        main.replaceChildren(el('p', 'app-error', err instanceof Error ? err.message : String(err)));
      }
    }

    function drawMain(todos: Todo[]): void {
      const header = el('div', 'todo-header');
      const burger = iconButton(BURGER, { title: 'Toggle days', onClick: toggleSidebar, className: 'todo-burger' });
      const heading = el('div', 'todo-heading');
      heading.append(el('h3', 'todo-title', labelFor(selected)), el('p', 'todo-subtitle', fullDate(selected)));
      const left = todos.filter((t) => !t.done).length;
      header.append(burger, heading, el('span', 'todo-count', todos.length ? `${left} left` : ''));

      const composer = addComposer(async ({ title, description }) => {
        await jsonApi('POST', 'todos', { date: selected, title, description });
        loadTodos();
      });

      const visible = bulk.filterVisible(todos);
      const list = el('ul', 'todo-list');
      if (!visible.length) {
        list.append(el('li', 'todo-empty', 'Nothing here yet. Add your first task above.'));
      } else {
        visible.forEach((todo) => list.append(todoRow(todo as Todo)));
      }

      const blocks: HTMLElement[] = [header, composer];
      if (visible.length || bulk.isSelecting()) blocks.push(bulk.controls(visible));
      blocks.push(list);
      main.replaceChildren(...blocks);
    }

    function todoRow(todo: Todo): HTMLElement {
      // Selection mode: a select checkbox replaces the done-toggle/actions.
      if (bulk.isSelecting()) {
        const row = el('li', 'todo-row todo-row-select' + (bulk.isChecked(todo.id) ? ' is-selected' : ''));
        const sel = el('input', 'todo-check');
        sel.type = 'checkbox';
        sel.checked = bulk.isChecked(todo.id);
        const toggle = (): void => {
          bulk.setChecked(todo.id, !bulk.isChecked(todo.id));
          loadTodos();
        };
        sel.addEventListener('click', (e) => e.stopPropagation());
        sel.addEventListener('change', toggle);
        const content = el('div', 'todo-body');
        content.append(el('span', 'todo-row-title', todo.title));
        if (todo.description) content.append(el('span', 'todo-row-desc', todo.description));
        row.append(sel, content);
        row.addEventListener('click', toggle);
        return bulk.bindRow(row, todo.id);
      }

      const row = el('li', 'todo-row' + (todo.done ? ' is-done' : ''));
      bulk.bindRow(row, todo.id); // drag across rows to select & batch-delete

      const check = el('input', 'todo-check');
      check.type = 'checkbox';
      check.checked = !!todo.done;
      check.addEventListener('change', async () => {
        await jsonApi('PATCH', `todos/${todo.id}`, { done: check.checked });
        loadTodos();
      });

      const content = el('div', 'todo-body');
      content.append(el('span', 'todo-row-title', todo.title));
      if (todo.description) content.append(el('span', 'todo-row-desc', todo.description));

      const actions = el('div', 'todo-row-actions');
      actions.append(
        iconButton(PENCIL, { title: 'Edit', className: 'todo-action', onClick: () => beginEdit(row, todo) }),
        iconButton(TRASH, {
          title: 'Delete',
          className: 'todo-action',
          // Shared confirm + undo toast, identical to the batch delete (#724).
          onClick: () => void bulk.deleteOne(todo),
        }),
      );

      row.append(check, content, actions);
      return row;
    }

    function beginEdit(row: HTMLElement, todo: Todo): void {
      row.className = 'todo-row is-editing';
      row.replaceChildren(
        taskForm({
          title: todo.title,
          description: todo.description || '',
          submitLabel: 'Save',
          onSubmit: async ({ title, description }) => {
            await jsonApi('PATCH', `todos/${todo.id}`, { title, description });
            loadTodos();
          },
          onCancel: () => loadTodos(),
          autofocus: true,
        }),
      );
    }

    refresh();
  },
};

interface TaskFormData {
  title: string;
  description: string;
}
interface TaskFormOptions {
  title?: string;
  description?: string;
  submitLabel: string;
  onSubmit: (data: TaskFormData) => void;
  onCancel?: () => void;
  compact?: boolean;
  autofocus?: boolean;
}

// Compact composer that expands (via :focus-within) to reveal the description.
function addComposer(onSubmit: (data: TaskFormData) => void): HTMLElement {
  return taskForm({ submitLabel: 'Add task', onSubmit, compact: true });
}

function taskForm({
  title = '',
  description = '',
  submitLabel,
  onSubmit,
  onCancel,
  compact = false,
  autofocus = false,
}: TaskFormOptions): HTMLElement {
  const card = el('div', 'todo-compose' + (compact ? ' is-compact' : ''));

  const titleInput = el('input', 'todo-compose-title');
  titleInput.placeholder = compact ? '+  Add a task' : 'Task title';
  titleInput.value = title;

  const more = el('div', 'todo-compose-more');
  const descInput = el('textarea', 'todo-compose-desc');
  descInput.placeholder = 'Add a description (optional)';
  descInput.rows = 2;
  descInput.value = description;

  const actions = el('div', 'todo-compose-actions');
  const submit = el('button', 'button-primary', submitLabel);
  actions.append(submit);
  if (onCancel) {
    const cancel = el('button', 'button-secondary', 'Cancel');
    cancel.addEventListener('click', onCancel);
    actions.append(cancel);
  }

  more.append(descInput, actions);
  card.append(titleInput, more);

  const submitNow = (): void => {
    const t = titleInput.value.trim();
    if (!t) {
      titleInput.focus();
      return;
    }
    onSubmit({ title: t, description: descInput.value.trim() });
  };
  submit.addEventListener('click', submitNow);
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNow();
    }
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNow();
    else if (e.key === 'Escape' && onCancel) onCancel();
  });

  if (autofocus) requestAnimationFrame(() => titleInput.focus());
  return card;
}
