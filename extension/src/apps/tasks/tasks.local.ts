// Local handlers for Tasks. Todos are flat records carrying their own
// `date`; a date-keyed view is reconstructed by grouping.
import { register } from '../../lib/localRouter.js';
import { dataStore as db } from '../../lib/dataStore.js';

interface Todo {
  id: string;
  date: string;
  title?: string;
  description?: string;
  done?: boolean;
  created?: number;
  [key: string]: unknown;
}

const listTodos = async (): Promise<Todo[]> => (await db.list('todos')) as unknown as Todo[];
const byCreated = (a: Todo, b: Todo): number => (a.created || 0) - (b.created || 0);
const open = (t: Todo): boolean => !t.done;

register('GET', 'todos', async ({ query }) => {
  const todos = (await listTodos()).filter((t) => t.date === query.date).sort(byCreated);
  return { todos };
});

register('GET', 'todos/dates', async () => {
  const all = await listTodos();
  const groups = new Map<string, Todo[]>();
  for (const t of all) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date)!.push(t);
  }
  const dates = [...groups.keys()]
    .sort()
    .reverse()
    .map((date) => ({
      date,
      open: groups.get(date)!.filter(open).length,
      total: groups.get(date)!.length,
    }));
  return { dates };
});

register('GET', 'todos/pending', async ({ query }) => {
  const today = query.today;
  const all = await listTodos();
  const todayOpen = all.filter((t) => t.date === today && open(t)).sort(byCreated);
  const overdue = all
    .filter((t) => t.date < today && open(t))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byCreated(a, b)));
  return { today: todayOpen, overdue };
});

register('POST', 'todos', async ({ body }) => {
  const b = (body || {}) as { title?: string; description?: string; date?: string };
  const title = (b.title || '').trim();
  if (!title) throw new Error('A title is required.');
  return db.put('todos', {
    date: b.date,
    title,
    description: (b.description || '').trim(),
    done: false,
    created: Date.now(),
  });
});

register('PATCH', 'todos/:id', async ({ params, body }) => {
  const b = (body || {}) as { title?: string; description?: string; done?: boolean; date?: string };
  const patch: Record<string, unknown> = {};
  if (b.title != null && b.title.trim()) patch.title = b.title.trim();
  if (b.description != null) patch.description = b.description.trim();
  if (b.done != null) patch.done = b.done;
  if (b.date != null && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) patch.date = b.date; // reschedule to another day
  const todo = await db.patch('todos', params.id, patch);
  if (!todo) throw new Error('Todo not found.');
  return todo;
});

register('DELETE', 'todos/:id', async ({ params }) => {
  await db.remove('todos', params.id);
  return { ok: true };
});
