// PDF Library — a reading list with an in-app reader. Books, PDF blobs and
// last-page memory are stored locally (IndexedDB via pdflib.local.js). The
// reader (PDF.js) is a lazily-imported module so it isn't in the main bundle.

import './pdflib.css';
import { getApi, jsonApi, callApi } from '../../lib/api.js';
import { createListWidget } from '../../components/widgetCard.js';
import { dataStore } from '../../lib/dataStore.js';
import { createBulkSelect } from '../../components/bulkSelect.js';
import { el } from '../../lib/dom.js';
import { DOWNLOAD, TRASH, iconButton } from '../../components/icons.js';
import { saveBookToDisk } from './download.js';
import appMeta from './meta.js';

interface Book {
  id: string;
  title?: string;
  url?: string;
  source?: string;
  read?: boolean;
  lastPage?: number;
  lastReadAt?: number;
  [key: string]: unknown;
}
interface Annotation {
  page?: number;
  text?: string;
  comment?: string;
  [key: string]: unknown;
}

const DOC = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
    <path d="M14 3v5h5"></path>
    <path d="M9 13h6M9 17h4"></path>
  </svg>`;

function host(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
];

// Set by the home "Continue reading" card so the next render opens that book
// straight into the reader instead of the list.
let pendingBookId: string | null = null;

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Read and annotate your PDFs',
  tip: 'Drag across books (or tap Select) to delete several at once. While reading, highlight text to add notes.',
  accent: appMeta.accent,
  order: appMeta.order,

  // KimtAI agent tools.
  tools: [
    {
      name: 'list_pdfs',
      description: 'List the PDFs in the library (with their id).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        const { books } = (await getApi('books')) as { books?: Book[] };
        const list = (books || []).map((b) => `${b.id} · ${b.read ? '✓' : '•'} ${b.title}`).join('\n') || '(empty)';
        return { ok: true, result: `Library:\n${list}`, summary: `${books?.length || 0} PDF(s)` };
      },
    },
    {
      name: 'get_pdf',
      description: 'Get one PDF by id: title, read/unread, last page read, and how many annotations it has.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const { books } = (await getApi('books')) as { books?: Book[] };
        const book = (books || []).find((b) => b.id === args.id);
        if (!book) return { ok: false, result: 'No PDF with that id.', summary: 'not found' };
        const { annotations } = (await getApi(`books/${book.id}/annotations`)) as { annotations?: Annotation[] };
        return {
          ok: true,
          result: `"${book.title}" — ${book.read ? 'read' : 'unread'}, on page ${book.lastPage || 1}, ${annotations?.length || 0} annotation(s).`,
          summary: `"${book.title}"`,
        };
      },
    },
    {
      name: 'search_pdfs',
      description: 'Find PDFs in the library whose title contains the query.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (args: Record<string, unknown>) => {
        const q = String(args.query || '').toLowerCase();
        const { books } = (await getApi('books')) as { books?: Book[] };
        const hits = (books || []).filter((b) => (b.title || '').toLowerCase().includes(q));
        const list = hits.map((b) => `${b.id} · ${b.read ? '✓' : '•'} ${b.title}`).join('\n');
        return {
          ok: true,
          result: hits.length
            ? `Matches for "${String(args.query)}":\n${list}`
            : `No PDFs match "${String(args.query)}".`,
          summary: `${hits.length} match(es)`,
        };
      },
    },
    {
      name: 'set_pdf_read',
      description: 'Mark a PDF as read or unread (id from list_pdfs).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, read: { type: 'boolean', description: 'true = read, false = unread' } },
        required: ['id', 'read'],
      },
      run: async (args: Record<string, unknown>) => {
        const read = args.read !== false && args.read !== 'false';
        const b = (await jsonApi('PATCH', `books/${String(args.id)}`, { read })) as Book;
        return {
          ok: true,
          result: `Marked "${b.title}" ${read ? 'read' : 'unread'}.`,
          summary: `${read ? 'read' : 'unread'}`,
        };
      },
    },
    {
      name: 'list_annotations',
      description: 'List the highlights and comments saved on a PDF (id from list_pdfs).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        const { annotations } = (await getApi(`books/${String(args.id)}/annotations`)) as {
          annotations?: Annotation[];
        };
        const list = (annotations || [])
          .map((a) => {
            const quote = (a.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            const note = a.comment ? ` — note: ${a.comment}` : '';
            return `- p.${a.page} “${quote}”${note}`;
          })
          .join('\n');
        return {
          ok: true,
          result: list || '(no annotations)',
          summary: `${annotations?.length || 0} annotation(s)`,
        };
      },
    },
    {
      name: 'remove_pdf',
      description: 'Remove a PDF from the library (id from list_pdfs).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async (args: Record<string, unknown>) => {
        await jsonApi('DELETE', `books/${String(args.id)}`);
        return { ok: true, result: 'PDF removed.', summary: 'removed a PDF' };
      },
    },
  ],

  // Data this app owns on-device (offered for deletion on uninstall).
  dataLabel: 'library & annotations',
  hasData: () => dataStore.hasAny('books', 'annotations'),
  async clearData() {
    await dataStore.clearCollection('annotations');
    await dataStore.clearCollection('books');
    await dataStore.clearBlobsByPrefix('pdf:'); // the stored PDF files
  },

  async badge(): Promise<number> {
    try {
      const { books } = (await getApi('books')) as { books?: Book[] };
      return (books || []).filter((b) => !b.read).length;
    } catch {
      return 0;
    }
  },

  // Home card: resume the most recently read book.
  widgetLabel: 'Pin last read book',
  widgetHint: 'Resume your latest PDF from the home',
  async widget(ctx: { openApp: (id: string) => void }): Promise<HTMLElement | null> {
    let books: Book[];
    try {
      books = ((await getApi('books')) as { books?: Book[] }).books || [];
    } catch {
      return null;
    }
    // Up to 5 most recently read books (newest activity first).
    const recent = books
      .filter((b) => b.lastReadAt)
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
      .slice(0, 5);
    if (!recent.length) return null;

    const resume = (id: string): void => {
      pendingBookId = id;
      ctx.openApp('pdflib');
    };

    return createListWidget({
      title: 'Continue reading',
      accent: '#38bdf8',
      count: recent.length,
      onOpen: () => ctx.openApp('pdflib'),
      items: recent.map((book) => ({
        label: book.title || 'Untitled',
        title: `Resume “${book.title}” · page ${book.lastPage || 1}`,
        onClick: () => resume(book.id),
      })),
    });
  },

  render(body: HTMLElement) {
    const root = el('div', 'app-flow');
    body.replaceChildren(root);

    let books: Book[] = [];
    let filter = 'all';
    let activeReader: { destroy?: () => void } | null = null; // current open reader

    const closeReader = (): void => {
      activeReader?.destroy?.();
      activeReader = null;
    };

    // Multi-select batch delete for the reading list.
    const bulk = createBulkSelect({
      noun: 'book',
      remove: async (book) => {
        await jsonApi('DELETE', `books/${book.id}`);
      },
      onChange: () => load(),
    });

    const load = async (): Promise<void> => {
      closeReader();
      try {
        books = ((await getApi('books')) as { books?: Book[] }).books || [];
      } catch (err) {
        root.replaceChildren(el('p', 'app-error', err instanceof Error ? err.message : String(err)));
        return;
      }
      // Coming from the home "Continue reading" card → open that book directly.
      if (pendingBookId) {
        const book = books.find((b) => b.id === pendingBookId);
        pendingBookId = null;
        if (book) {
          openReader(book);
          return;
        }
      }
      showList();
    };

    const openReader = async (book: Book): Promise<void> => {
      closeReader();
      root.replaceChildren(el('p', 'pdf-loading', 'Loading reader…'));
      try {
        const { createReader } = await import('./reader.js');
        activeReader = createReader({
          container: root,
          book,
          onBack: () => load(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        root.replaceChildren(el('p', 'app-error', `Couldn't load the reader: ${msg}`));
      }
    };

    function showList(): void {
      const wrap = el('div', 'pdf-listview');

      const header = el('div', 'pdf-header');
      header.append(el('h3', 'pdf-h-title', 'Reading list'));
      const unread = books.filter((b) => !b.read).length;
      header.append(el('span', 'pdf-count', unread ? `${unread} unread` : 'all read'));

      // Add: upload a PDF from the computer.
      const form = el('div', 'pdf-add');
      const title = el('input', 'input');
      title.placeholder = 'Title (optional)';
      form.append(title);

      const uploadRow = el('div', 'pdf-upload-row');
      const file = el('input');
      file.type = 'file';
      file.accept = 'application/pdf';
      file.hidden = true;
      const uploadBtn = el('button', 'button-secondary');
      uploadBtn.type = 'button';
      uploadBtn.textContent = 'Upload a PDF from your computer';
      uploadBtn.addEventListener('click', () => file.click());
      uploadRow.append(uploadBtn, file);

      const status = el('p', 'pdf-add-status');
      status.hidden = true;

      const busy = (msg: string): void => {
        status.textContent = msg;
        status.classList.remove('is-error');
        status.hidden = false;
      };
      const fail = (msg: string): void => {
        status.textContent = msg;
        status.classList.add('is-error');
        status.hidden = false;
      };

      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        busy('Uploading…');
        try {
          const fd = new FormData();
          fd.append('file', f, f.name);
          fd.append('title', title.value.trim());
          const book = (await callApi('books/upload', fd)) as Book;
          openReader(book);
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
        file.value = '';
      });

      // Filter
      const filterBar = el('div', 'tabs pdf-filter');
      for (const f of FILTERS) {
        const b = el('button', 'tab' + (filter === f.id ? ' is-active' : ''), f.label);
        b.addEventListener('click', () => {
          filter = f.id;
          showList();
        });
        filterBar.append(b);
      }

      // List
      const visible = bulk.filterVisible(
        books.filter((b) => filter === 'all' || (filter === 'unread' && !b.read) || (filter === 'read' && b.read)),
      );
      const list = el('ul', 'pdf-list');
      if (!visible.length) {
        list.append(
          el('li', 'pdf-empty', books.length ? 'Nothing here.' : 'No books yet. Import or upload one above.'),
        );
      } else {
        // In the All tab, mark where the read books begin (they sort last).
        const showDivider = filter === 'all' && visible.some((b) => !b.read) && visible.some((b) => b.read);
        let divided = false;
        visible.forEach((book) => {
          if (showDivider && book.read && !divided) {
            divided = true;
            const divider = el('li', 'pdf-divider');
            divider.append(el('span', undefined, 'Read'));
            list.append(divider);
          }
          list.append(bookRow(book as Book));
        });
      }

      wrap.append(header, form, uploadRow, status, filterBar, bulk.controls(visible), list);
      root.replaceChildren(wrap);
    }

    function bookRow(book: Book): HTMLElement {
      // Selection mode: a select checkbox replaces the read-toggle/remove actions.
      if (bulk.isSelecting()) {
        const item = el('li', 'pdf-item pdf-item-select' + (bulk.isChecked(book.id) ? ' is-selected' : ''));
        const sel = el('input', 'pdf-check');
        sel.type = 'checkbox';
        sel.checked = bulk.isChecked(book.id);
        const toggle = (): void => {
          bulk.setChecked(book.id, !bulk.isChecked(book.id));
          load();
        };
        sel.addEventListener('click', (e) => e.stopPropagation());
        sel.addEventListener('change', toggle);
        const cover = el('span', 'pdf-cover');
        cover.innerHTML = DOC;
        const info = el('span', 'pdf-open');
        info.append(el('span', 'pdf-title', book.title));
        const source = book.source === 'url' ? host(book.url || '') : 'Uploaded PDF';
        info.append(el('span', 'pdf-host', source));
        item.append(sel, cover, info);
        item.addEventListener('click', toggle);
        return bulk.bindRow(item, book.id);
      }

      const item = el('li', 'pdf-item' + (book.read ? ' is-read' : ''));
      bulk.bindRow(item, book.id); // drag across rows to select & batch-delete

      const cover = el('span', 'pdf-cover');
      cover.innerHTML = DOC;

      const open = el('button', 'pdf-open');
      open.append(el('span', 'pdf-title', book.title));
      const source = book.source === 'url' ? host(book.url || '') : 'Uploaded PDF';
      const sub = (book.lastPage ?? 0) > 1 ? `${source} · Page ${book.lastPage}` : source;
      open.append(el('span', 'pdf-host', sub));
      open.addEventListener('click', () => openReader(book));

      const actions = el('div', 'pdf-row-actions');
      const check = el('input', 'pdf-check');
      check.type = 'checkbox';
      check.checked = !!book.read;
      check.title = book.read ? 'Mark unread' : 'Mark read';
      check.addEventListener('change', async () => {
        await jsonApi('PATCH', `books/${book.id}`, { read: check.checked });
        load();
      });

      // Get the file back out. Nothing about the book changes — the PDF you
      // imported or uploaded is stored as-is, so this hands back the same bytes.
      const save = iconButton(DOWNLOAD, {
        title: 'Download',
        className: 'pdf-action pdf-action-save',
        onClick: () => void saveBookToDisk(book, root),
      });

      const remove = iconButton(TRASH, {
        title: 'Remove',
        className: 'pdf-action',
        // Shared confirm + undo toast, identical to the batch delete (#724).
        onClick: () =>
          void bulk.deleteOne(book, {
            confirmMessage: `Remove “${book.title}” from your library?`,
            undoMessage: `“${book.title}” removed`,
          }),
      });
      actions.append(check, save, remove);

      item.append(cover, open, actions);
      return item;
    }

    load();

    // Destroy the reader (its observers/render tasks) when the window closes.
    return closeReader;
  },
};

export default app;
