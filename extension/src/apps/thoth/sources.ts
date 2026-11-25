// Thoth — sources. Pure mappers that turn a raw stored record (from an app's
// IndexedDB collection) into a KbDoc the indexer can chunk and embed. Kept free
// of any IndexedDB access so the mapping is unit-testable; the actual
// dataStore.list() happens in the indexer (a later phase). Only text the user
// authored is indexed — everything stays on-device.

export interface KbDoc {
  /** Owning app id, e.g. 'notes'. */
  app: string;
  /** Stable id of the source record, so a citation can reopen it. */
  docId: string;
  /** Human label shown on a citation. */
  title: string;
  /** The text to chunk + embed. */
  text: string;
}

type Rec = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const join = (...parts: unknown[]): string =>
  parts
    .map(s)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');

// Pull readable text out of a NotaBoard's elements (text + sticky notes).
function boardText(elements: unknown): string {
  if (!Array.isArray(elements)) return '';
  return elements
    .map((e) => (e && typeof e === 'object' && 'text' in e ? s((e as Rec).text) : ''))
    .filter(Boolean)
    .join('\n');
}

function doc(app: string, id: unknown, title: string, text: string): KbDoc | null {
  const body = text.trim();
  if (!body || !id) return null;
  return { app, docId: String(id), title: title.trim() || '(untitled)', text: body };
}

export interface Source {
  /** The IndexedDB collection to read. */
  collection: string;
  app: string;
  /** Map one record → a KbDoc, or null to skip it. */
  toDoc: (rec: Rec) => KbDoc | null;
}

export const SOURCES: Source[] = [
  {
    collection: 'pages',
    app: 'notes',
    toDoc: (r) => doc('notes', r.id, s(r.title), s(r.content)),
  },
  {
    collection: 'todos',
    app: 'tasks',
    toDoc: (r) => doc('tasks', r.id, s(r.title), join(r.title, r.description)),
  },
  {
    collection: 'annotations',
    app: 'pdflib',
    toDoc: (r) =>
      doc('pdflib', r.id, `PDF highlight · p.${s(r.page) || String(r.page ?? '?')}`, join(r.text, r.comment)),
  },
  {
    collection: 'boards',
    app: 'notaboard',
    toDoc: (r) => doc('notaboard', r.id, s(r.title), boardText(r.elements)),
  },
];

// Map a batch of records from one source, dropping the empties.
export function documentsFrom(source: Source, records: Rec[]): KbDoc[] {
  return records.map((r) => source.toDoc(r)).filter((d): d is KbDoc => d !== null);
}
