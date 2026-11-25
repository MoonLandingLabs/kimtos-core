// Thoth — a Private AI Knowledge Base. Builds an on-device search index of
// the user's own notes, PDFs and boards, then answers questions over them with
// an on-device model and citations. Retrieval = embed the question, cosine-match
// stored chunks (indexer.ts); generation = the KimtAI worker fed the top passages
// as context. Everything runs locally — nothing is uploaded. Opt-in / not default.
//
// The retrieved passages are the product; the generated text is only a summary of
// them (#913). Retrieval is reliable, but the small model summarising it is not —
// it can invent details with the correct passage in front of it — so the passages
// are shown verbatim the moment retrieval finds them, the summary is labelled as a
// summary, and grounding.ts flags any figure it asserts that the notes never say.

import './thoth.css';
import { el } from '../../lib/dom.js';
import { createEmbedder, type Embedder } from '../../lib/engines/embed.js';
import { createChat, recommendedModelId } from '../../lib/engines/kimtai.js';
import { reindex, indexStatus, indexGap, search, type Hit, type IndexStatus, type IndexGap } from './indexer.js';
import { kimtManager } from '../../lib/kimtManager.js';
import { checkGrounding, describeInvented } from './grounding.js';
import appMeta from './meta.js';
import { loadAsJob } from '../../lib/modelJob.js';

const ACCENT = appMeta.accent;
const APP_NAMES: Record<string, string> = { notes: 'Notes', tasks: 'Tasks', pdflib: 'PDF', notaboard: 'Board' };
const appName = (id: string): string => APP_NAMES[id] ?? id;
const pct = (r: number | null): string => (r == null ? '' : ` ${Math.round(r * 100)}%`);

interface Ctx {
  openApp?: (id: string) => void;
}
type Chat = ReturnType<typeof createChat>;

const app = {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Private AI knowledge base — ask your own notes, PDFs & boards, offline',
  tip: 'Thoth builds a private, on-device index of your notes, PDFs and boards, then answers questions across them with citations — fully offline, nothing uploaded. Click “Rebuild index” first, then ask.',
  accent: ACCENT,
  order: appMeta.order,

  // Agent tool: retrieve cited passages from the private on-device index.
  tools: [
    {
      name: 'search_knowledge',
      description:
        "Search the private, on-device knowledge index (the user's own notes, PDFs and boards) and return the most relevant cited passages. The index must be built first in the Thoth app (Rebuild index). Read-only.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
          limit: { type: 'number', description: 'Max passages to return (default 6, max 12)' },
        },
        required: ['query'],
      },
      run: async (args: { query?: string; limit?: number }) => {
        const query = String(args.query || '').trim();
        if (!query) return { ok: false, result: 'Provide a query.', summary: 'no query' };
        const stat = await indexStatus();
        if (!stat.chunks)
          return {
            ok: false,
            result: 'The knowledge index is empty. Open Thoth and click “Rebuild index” first.',
            summary: 'no index',
          };
        const k = Math.min(Math.max(Number(args.limit) || 6, 1), 12);
        const emb = await createEmbedder();
        const hits = await search(emb, query, k);
        if (!hits.length) return { ok: true, result: `No passages matched “${query}”.`, summary: '0 passages' };
        const body = hits
          .map(
            (h, i) => `[${i + 1}] ${appName(h.chunk.app)} · ${h.chunk.title || '(untitled)'}\n${h.chunk.text.trim()}`,
          )
          .join('\n\n');
        return {
          ok: true,
          result: `Found ${hits.length} passage(s) for “${query}”:\n\n${body}`,
          summary: `${hits.length} passage(s)`,
        };
      },
    },
  ],

  render(body: HTMLElement, ctx: Ctx = {}) {
    const root = el('div', 'thoth');
    body.replaceChildren(root);

    let embedder: Embedder | null = null;
    let chat: Chat | null = null;
    let indexing = false;
    let asking = false;
    let stat: IndexStatus = { chunks: 0, docs: 0 };
    // How far the index is behind the content. Non-zero after an interrupted build, and also
    // in the ordinary case where the user has simply written notes since the last one — both
    // of which used to be silent (#356).
    let gap: IndexGap = { toIndex: 0, toRemove: 0 };

    // Persistent elements — built once so streaming updates never detach them.
    const info = el('div', 'thoth-info');
    const rebuildBtn = el('button', 'thoth-btn');
    rebuildBtn.type = 'button';
    const statusEl = el('div', 'thoth-status');
    const input = el('textarea', 'thoth-input');
    input.placeholder = 'Ask across your notes, PDFs and boards…  (⌘/Ctrl+Enter)';
    input.rows = 2;
    input.spellcheck = false;
    const askBtn = el('button', 'thoth-btn thoth-ask');
    askBtn.type = 'button';
    askBtn.textContent = 'Ask';
    const answerLabel = el('div', 'thoth-answer-label');
    const answer = el('div', 'thoth-answer');
    const warning = el('div', 'thoth-warning');
    const sources = el('div', 'thoth-sources');

    const setStatus = (t: string): void => {
      statusEl.textContent = t;
    };
    // Never let a failure to COUNT the gap break the app: worst case we show what we always did.
    const readGap = async (): Promise<IndexGap> => {
      try {
        return await indexGap();
      } catch {
        return { toIndex: 0, toRemove: 0 };
      }
    };
    const refresh = (): void => {
      const indexed = stat.chunks ? `${stat.chunks} passages · ${stat.docs} documents indexed` : 'No index yet';
      // Say it plainly: an index that is behind is one that quietly misses documents when you
      // search, and the user cannot see that from a passage count.
      const behind = gap.toIndex ? ` · ${gap.toIndex} document${gap.toIndex === 1 ? '' : 's'} not indexed yet` : '';
      info.textContent = indexed + behind;
      info.classList.toggle('is-behind', gap.toIndex > 0 && !indexing);
      rebuildBtn.textContent = indexing
        ? 'Indexing…'
        : gap.toIndex
          ? `Index ${gap.toIndex} document${gap.toIndex === 1 ? '' : 's'}`
          : 'Rebuild index';
      rebuildBtn.disabled = indexing;
      askBtn.disabled = asking;
      askBtn.textContent = asking ? 'Asking…' : 'Ask';
    };

    // Both of these can DOWNLOAD on first use — about 23 MB for the embedder and about 300 MB for
    // the chat model — so both go through the orchestrator. They used to run as bare promises, so
    // pressing Ask started a 300 MB transfer that KimtManager showed only as "Thoth - Open", and
    // the embedder's download sat outside the job registered on the very next line (#1307).
    //
    // The status line stays as well: it is where the user is already looking, and the row is for
    // finding the work again from anywhere else.
    const ensureEmbedder = async (): Promise<Embedder> => {
      if (!embedder)
        embedder = await loadAsJob({ appId: appMeta.id, title: 'Downloading the search model' }, (onProgress) =>
          createEmbedder({
            onProgress: (p) => {
              onProgress(p);
              setStatus(`Downloading search model…${pct(p.ratio)}`);
            },
          }),
        );
      return embedder;
    };
    const ensureChat = async (): Promise<Chat> => {
      if (!chat) {
        setStatus('Loading the AI model…');
        chat = await loadAsJob({ appId: appMeta.id, title: 'Downloading the AI model' }, async (onProgress) => {
          const c = createChat({
            model: recommendedModelId(),
            onProgress: (p) => {
              onProgress(p);
              setStatus(`Downloading AI model…${pct(p.ratio)}`);
            },
          });
          await c.ready;
          return c;
        });
      }
      return chat;
    };

    /**
     * Rebuild the index — THROUGH THE ORCHESTRATOR (#1270).
     *
     * A rebuild embeds every note, PDF and board the user owns; on a real corpus that is minutes of
     * on-device inference, and none of it was registered. So it had no row in KimtManager, no Stop,
     * and nothing that tore the window down could stop it — including another tab taking the session
     * over, which closed the window and left the embedding running with no surface. App convention
     * 11, on the longest job in the app.
     *
     * `savesOnStop: true` is earned by `reindex` honouring the signal between documents and writing
     * the hash map for exactly what it finished: a stopped rebuild keeps the documents it indexed,
     * and the next one continues rather than starting over.
     */
    async function rebuild(): Promise<void> {
      if (indexing) return;
      indexing = true;
      refresh();
      try {
        const emb = await ensureEmbedder();
        const job = kimtManager.start({
          appId: appMeta.id,
          title: 'Building the search index',
          kind: 'compute',
          savesOnStop: true,
          run: async (ctx) => {
            stat = await reindex(
              emb,
              (done, total, label) => {
                setStatus(`Indexing ${done}/${total}: ${label}`);
                ctx.progress(total ? done / total : null);
                ctx.note(`Indexing ${done}/${total}`);
              },
              ctx.signal,
            );
          },
        });
        await job.run();
        // The orchestrator never rejects; it records the outcome. Rethrow so the catch below reports
        // it exactly as it always did.
        if (job.status() === 'failed') throw new Error(job.error() || 'the index could not be built');
        setStatus(
          job.status() === 'cancelled'
            ? 'Indexing stopped. What was indexed is kept — rebuilding picks up from there.'
            : stat.chunks
              ? `Indexed ${stat.chunks} passages from ${stat.docs} documents.`
              : 'Nothing to index yet — add some notes, PDFs or boards first.',
        );
      } catch (e) {
        setStatus(`Index failed: ${(e as Error).message}`);
      }
      // Recompute from the same plan the build uses, so the readout reflects what actually
      // landed — including a build that failed part-way and left some documents unindexed.
      gap = await readGap();
      indexing = false;
      refresh();
    }

    // The passages ARE the answer's evidence — verbatim text from the user's own
    // notes, shown in full the moment retrieval finds them (before the model has
    // said a word). A click on a passage header reopens it in its app.
    function showPassages(hits: Hit[]): void {
      sources.replaceChildren(el('div', 'thoth-src-label', 'From your notes'));
      hits.forEach((h, i) => {
        const item = el('div', 'thoth-passage');
        const head = el('button', 'thoth-chip');
        head.type = 'button';
        head.textContent = `[${i + 1}] ${appName(h.chunk.app)} · ${h.chunk.title}`;
        head.title = `Open in ${appName(h.chunk.app)}`;
        head.addEventListener('click', () => ctx.openApp?.(h.chunk.app));
        const text = el('div', 'thoth-passage-text', h.chunk.text);
        text.title = 'Expand or collapse';
        text.tabIndex = 0;
        text.setAttribute('role', 'button');
        text.setAttribute('aria-expanded', 'false');
        const toggle = (): void => {
          const on = text.classList.toggle('is-expanded');
          text.setAttribute('aria-expanded', String(on));
        };
        text.addEventListener('click', toggle);
        text.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });
        item.append(head, text);
        sources.append(item);
      });
    }

    async function ask(): Promise<void> {
      const q = input.value.trim();
      if (!q || asking) return;
      asking = true;
      answerLabel.textContent = '';
      answer.textContent = '';
      answer.classList.remove('is-error');
      warning.textContent = '';
      sources.replaceChildren();
      refresh();
      try {
        const emb = await ensureEmbedder();
        const hits = await search(emb, q, 6);
        if (!hits.length) {
          answer.textContent = stat.chunks
            ? 'I couldn’t find anything relevant in your indexed content.'
            : 'Your index is empty — click “Rebuild index” first.';
          asking = false;
          setStatus('');
          refresh();
          return;
        }
        // Show the retrieved notes NOW — they answer most questions on their own,
        // and they stay up even if loading or running the model then fails.
        showPassages(hits);
        const session = await ensureChat();
        const context = hits
          .map((h, i) => `[${i + 1}] ${appName(h.chunk.app)} — ${h.chunk.title}\n${h.chunk.text}`)
          .join('\n\n');
        const messages = [
          {
            role: 'system',
            content:
              'You are Thoth. Answer the question using ONLY the provided context, which is the user’s own notes. Cite sources inline like [1], [2]. If the answer is not in the context, say you don’t have it.',
          },
          { role: 'user', content: `Context:\n${context}\n\nQuestion: ${q}` },
        ];
        setStatus('Thinking…');
        answerLabel.textContent = 'AI summary — check it against the passages below';
        const done = (final: string): void => {
          const text = final || answer.textContent || '';
          answer.textContent = text;
          // A summary that asserts a figure the notes never mention is provably
          // invented — say so instead of presenting it as grounded (#913).
          const check = checkGrounding(text, [q, ...hits.flatMap((h) => [h.chunk.title, h.chunk.text])]);
          if (!check.ok) warning.textContent = `${describeInvented(check.invented)} Trust the passages below.`;
          setStatus('');
          asking = false;
          refresh();
        };
        session.send(
          messages as Parameters<typeof session.send>[0],
          {
            onToken: (_t: string, acc: string) => {
              answer.textContent = acc;
            },
            onDone: (text: string) => done(text),
            onError: (e: Error) => {
              answerLabel.textContent = '';
              answer.classList.add('is-error');
              answer.textContent = e.message;
              setStatus('');
              asking = false;
              refresh();
            },
          },
          { temperature: 0.2, maxTokens: 512 },
        );
      } catch (e) {
        answerLabel.textContent = '';
        answer.classList.add('is-error');
        answer.textContent = (e as Error).message;
        asking = false;
        setStatus('');
        refresh();
      }
    }

    rebuildBtn.addEventListener('click', () => void rebuild());
    askBtn.addEventListener('click', () => void ask());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void ask();
      }
    });

    void (async () => {
      try {
        stat = await indexStatus();
      } catch {
        /* empty index */
      }
      gap = await readGap();
      const header = el('div', 'thoth-header');
      header.append(info, rebuildBtn);
      const bar = el('div', 'thoth-askbar');
      bar.append(input, askBtn);
      const main = el('div', 'thoth-main');
      main.append(header, statusEl, bar, answerLabel, answer, warning, sources);
      root.replaceChildren(main);
      refresh();
      requestAnimationFrame(() => input.focus());
    })();

    return () => {
      chat?.dispose();
      embedder?.dispose();
    };
  },
};

export default app;
