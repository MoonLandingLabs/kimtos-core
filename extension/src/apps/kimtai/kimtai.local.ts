// Local handlers for KimtAI. A conversation is one record in the `chats`
// collection carrying its whole message thread, a `pinned` flag, and optional
// per-chat generation `config`. The sidebar list only needs the light fields, so
// it's served a summary that omits the (potentially long) `messages` array.
// Everything stays on-device in IndexedDB.
import { register } from '../../lib/localRouter.js';
import { dataStore as db } from '../../lib/dataStore.js';

interface Chat {
  id: string;
  title?: string;
  created?: number;
  updated?: number;
  pinned?: boolean;
  [key: string]: unknown;
}
interface ChatStep {
  tool: string;
  ok: boolean;
  summary: string;
}
interface ChatMessage {
  role: string;
  content: string;
  steps?: ChatStep[];
}

const COLLECTION = 'chats';
const listChats = async (): Promise<Chat[]> => (await db.list(COLLECTION)) as unknown as Chat[];
// Pinned conversations sort to the top, then most-recently-updated.
const bySort = (a: Chat, b: Chat): number =>
  (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || 0) - (a.updated || 0);

// Never ship a chat's full thread to the list view.
// `at` is what the shared history sidebar renders as the row's timestamp. It is derived
// from `updated`, not stored twice: for a conversation you come back to, when it last
// changed is the useful time, and `created` is only the fallback for a record written
// before `updated` existed (#953).
const summary = ({ id, title, created, updated, pinned }: Chat) => ({
  id,
  title,
  created,
  updated,
  at: updated ?? created,
  pinned: !!pinned,
});

// An assistant turn may carry a `steps` trace of the tools the agent used.
const normalizeSteps = (steps: unknown): ChatStep[] | undefined =>
  Array.isArray(steps)
    ? steps
        .filter((s) => s && typeof s.tool === 'string')
        .slice(0, 12)
        .map((s) => ({ tool: s.tool, ok: s.ok !== false, summary: String(s.summary || '').slice(0, 120) }))
    : undefined;

const normalizeMessages = (messages: unknown): ChatMessage[] =>
  Array.isArray(messages)
    ? messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => {
          const out: ChatMessage = { role: m.role, content: m.content };
          const steps = m.role === 'assistant' ? normalizeSteps(m.steps) : undefined;
          if (steps?.length) out.steps = steps;
          return out;
        })
    : [];

interface ChatConfig {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}
// Per-chat generation controls, clamped to safe ranges.
const normalizeConfig = (config: unknown): ChatConfig | undefined => {
  if (!config || typeof config !== 'object') return undefined;
  const c = config as Record<string, unknown>;
  const out: ChatConfig = {};
  if (typeof c.systemPrompt === 'string') out.systemPrompt = c.systemPrompt;
  if (typeof c.temperature === 'number') out.temperature = Math.min(1, Math.max(0, c.temperature));
  if (typeof c.maxTokens === 'number') out.maxTokens = Math.min(2048, Math.max(64, Math.round(c.maxTokens)));
  return out;
};

register('GET', 'chats', async () => {
  const chats = (await listChats()).sort(bySort).map(summary);
  return { chats };
});

register('GET', 'chats/:id', async ({ params }) => {
  const chat = await db.get(COLLECTION, params.id);
  if (!chat) throw new Error('Conversation not found.');
  return chat;
});

register('POST', 'chats', async ({ body }) => {
  const b = (body || {}) as Partial<Chat> & { messages?: unknown; config?: unknown };
  const now = Date.now();
  return db.put(COLLECTION, {
    title: (b.title || '').trim() || 'New chat',
    messages: normalizeMessages(b.messages),
    pinned: !!b.pinned,
    config: normalizeConfig(b.config),
    created: now,
    updated: now,
  });
});

register('PATCH', 'chats/:id', async ({ params, body }) => {
  const b = (body || {}) as Partial<Chat> & { messages?: unknown; config?: unknown };
  const patch: Record<string, unknown> = { updated: Date.now() };
  if (b.title != null) patch.title = b.title.trim() || 'New chat';
  if (b.messages != null) patch.messages = normalizeMessages(b.messages);
  if (b.pinned != null) patch.pinned = !!b.pinned;
  if (b.config != null) patch.config = normalizeConfig(b.config);
  const chat = await db.patch(COLLECTION, params.id, patch);
  if (!chat) throw new Error('Conversation not found.');
  return chat;
});

register('DELETE', 'chats/:id', async ({ params }) => {
  await db.remove(COLLECTION, params.id);
  return { ok: true };
});
