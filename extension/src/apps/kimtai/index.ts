// KimtAI — a private AI chat that runs entirely on-device. A small
// instruction-tuned LLM (Transformers.js + WebGPU, in a Web Worker) answers in a
// streaming thread; nothing is ever uploaded. Users keep several models in a
// Model Library and pick which to chat with. Conversations persist in IndexedDB
// (see kimtai.local.js).
//
// Chat is plain streamed generation for small models. When a tool-capable model
// is loaded (Qwen/Llama — supportsNativeTools), the send routes through the agent
// loop in lib/agentTools.js instead, so the model can call MCP-shaped tools
// (the installed apps' tools) and answer from the results.

import './kimtai.css';
import { getApi, jsonApi } from '../../lib/api.js';
import { dataStore } from '../../lib/dataStore.js';
import { getAppValue, setAppConfig } from '../../lib/appConfig.js';
import { el, overlayHost } from '../../lib/dom.js';
import { rafThrottle } from '../../lib/timing.js';
import { renderMarkdownInto } from '../../lib/markdown.js';
import { downloadText, safeFilename } from '../../lib/download.js';
import { createEntrySession, createHistorySidebar, type HistorySidebarEntry } from '../../components/historySidebar.js';
import { createResizer } from '../../components/resizer.js';
import { makeSidebarResponsive } from '../../components/sidebarResponsive.js';
import { createProgressBar } from '../../components/progressBar.js';
import { kimtManager, type Job } from '../../lib/kimtManager.js';
import { createCopyButton } from '../../components/copyButton.js';
import { createPopover } from '../../components/popover.js';
import { promptDialog } from '../../components/promptDialog.js';
import { confirmDialog } from '../../components/confirm.js';
import { detectDeviceResources, evaluateModelFit, describeDevice } from '../../lib/deviceResources.js';
import { PENCIL, DOWNLOAD, PIN, SLIDERS, REGEN } from '../../components/icons.js';
import {
  MODELS,
  byId,
  createChat,
  buildMessages,
  downloadModel,
  isDownloadCancelled,
  removeModel,
  downloadedModels,
  webgpuAvailable,
  modelSpeeds,
  recordSpeed,
  recommendedModelId,
  pruneRemovedModels,
  supportsNativeTools,
} from '../../lib/engines/kimtai.js';
import { runAgent, availableTools, systemTools, type AgentSession } from '../../lib/agentTools.js';
import { showSnackbar } from '../../components/snackbar.js';
import appMeta from './meta.js';
import { setAccent } from '../../lib/accent.js';

const ACCENT = appMeta.accent;

// Keep this SHORT (#565). The detailed version (#552/#557) backfired: a 1B-class model recited it
// back when the user just said "Hi" — a long system prompt gives a weak instruction-follower more
// to parrot and get confused by. A terse prompt with only the load-bearing facts (on-device,
// offline, no lookups, brief + honest) is followed far better. This is the last useful prompt
// lever; beyond it the model is at its ceiling. Overridable per chat.
const DEFAULT_SYSTEM =
  'You are KimtAI, a private assistant that runs offline on the user’s device — nothing they type ' +
  'leaves it, and you can’t look things up online. Keep replies short and honest; if you’re not ' +
  'sure, say so instead of guessing.';
const LENGTHS: [string, number][] = [
  ['Short', 256],
  ['Medium', 512],
  ['Long', 1024],
  ['Max', 2048],
];

interface Message {
  role: string;
  content: string;
}
interface ChatConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}
interface ChatEntry {
  id: string;
  title?: string;
  pinned?: boolean;
  messages?: Message[];
  config?: Partial<ChatConfig>;
  [key: string]: unknown;
}
interface ModelInfo {
  id: string;
  label: string;
  badge?: string;
  params?: string;
  size?: string;
  needsWebGPU?: boolean;
  tier?: string;
  note?: string;
  [key: string]: unknown;
}
interface ChatSession {
  ready: Promise<string>;
  send: (
    msgs: Message[],
    handlers: {
      onToken?: (t: string, acc: string) => void;
      onDone?: (text: string | null) => void;
      onError?: (e: unknown) => void;
    },
    opts?: Record<string, unknown>,
  ) => void;
  dispose: () => void;
  stop: () => void;
}

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const tempLabel = (v: number): string =>
  v <= 0.15 ? 'Precise' : v < 0.5 ? 'Balanced' : v < 0.85 ? 'Creative' : 'Wild';
// Relative decode speed by catalog tier (until a real tok/s is measured).
const SPEED_TIER: Record<string, string> = { Tiny: 'Fastest', Small: 'Fast' };

const titleFrom = (messages: Message[]): string => {
  const first = messages.find((m) => m.role === 'user');
  const t = (first?.content || '').replace(/\s+/g, ' ').trim();
  return t.length > 44 ? `${t.slice(0, 44)}…` : t || 'New chat';
};

let sidebarWidth = 240; // drag-resizable; persists across opens within the session.

/**
 * Which model the app's single in-flight download is fetching.
 *
 * This is NOT a second job registry — a second registry is exactly what it replaced (#1275).
 * The job, its progress, its abort signal, its place in the queue and its terminal state all
 * belong to `kimtManager`; this one field only names WHAT the running job is downloading, which
 * a JobSpec has nowhere to carry, so the Model Library can put the live row against the right
 * model. Everything else is read back from the orchestrator.
 *
 * It is deliberately never cleared. `activeModelDownload()` gates on there being a live job, so a
 * left-over name is unreachable — and clearing it when the job settles would race the abort path,
 * where the record is dropped synchronously but the download's rejection arrives a microtask
 * later: the old job's cleanup would then blank the name belonging to a download that had already
 * started, leaving a live transfer with no row against it.
 */
let downloadingModel: string | null = null;

/** The app's download job, if one is running or queued. */
const modelDownloadJob = (): Job | null => kimtManager.jobFor(appMeta.id);

/** Which model is being downloaded right now, if any. */
const activeModelDownload = (): string | null => (modelDownloadJob() ? downloadingModel : null);

/** Bytes as a reader sees them, one decimal place. */
const mb = (n: number): string => `${Math.round(n / 1e5) / 10} MB`;

/**
 * Start a model download as an orchestrated job.
 *
 * One per app, because that is what the orchestrator gives us for free: a second download waits
 * for a slot instead of fighting the first one for the connection. Registering is also what puts
 * the transfer in KimtManager, in Stop all, and in the list a takeover names before it destroys
 * it — none of which knew this download existed while it had its own registry.
 */
function startModelDownload(id: string, label: string): Job {
  downloadingModel = id;
  return kimtManager.start({
    appId: appMeta.id,
    kind: 'download',
    title: `Downloading ${label}`,
    cancellable: true,
    // Stopping keeps whole files already fetched, but the file in flight restarts — so it does
    // NOT keep what it was doing, and a prompt that claimed otherwise would be lying about a
    // gigabyte. Declared rather than guessed (see JobSpec.savesOnStop).
    savesOnStop: false,
    run: async (ctx) => {
      try {
        await downloadModel(
          id,
          (p: unknown) => {
            const e = (p ?? {}) as { ratio?: number | null; loaded?: number; total?: number; label?: string };
            ctx.progress(typeof e.ratio === 'number' ? e.ratio : null);
            // The note is the description BOTH surfaces read: the KimtManager row and the Model
            // Library. Real bytes when the server told us the size, the engine's own phase
            // otherwise — never a number we invented.
            ctx.note(e.total ? `${mb(e.loaded ?? 0)} of ${mb(e.total)}` : (e.label ?? 'Downloading'));
          },
          ctx.signal,
        );
      } catch (err) {
        // Cancelling is a normal outcome, not a failure: the row goes back to "Download".
        if (isDownloadCancelled(err) || ctx.signal.aborted) return;
        throw err;
      }
    },
  });
}

// Set by the home search bar (the "KimtAI" home layout) so opening the app sends
// the user's typed message straight away.
let pendingMessage: string | null = null;
export function askKimtAI(message: string): void {
  pendingMessage = message;
}

export default {
  id: appMeta.id,
  name: appMeta.name,
  description: 'Chat with a private AI, fully on your device',
  tip: 'KimtAI runs a small AI model right in your browser — nothing is uploaded. Open Models to download it, then just start chatting.',
  accent: ACCENT,
  order: appMeta.order,

  dataLabel: 'conversations',
  hasData: () => dataStore.hasAny('chats'),
  async clearData() {
    await dataStore.clearCollection('chats');
  },

  settings: [
    {
      key: 'systemPrompt',
      label: 'System prompt',
      hint: 'Default persona/behaviour for new chats (each chat can override it via the tune button)',
      type: 'text',
      default: DEFAULT_SYSTEM,
    },
  ],

  widgetLabel: 'Pin Ask KimtAI',
  widgetHint: 'A shortcut to the AI chat on the home',
  widget(ctx: { openApp: (id: string) => void }): HTMLElement {
    const card = el('div', 'widget-card');
    setAccent(card, ACCENT);
    const head = el('div', 'widget-head');
    head.append(el('span', 'widget-title', 'KimtAI'));
    const body = el('button', 'widget-cta', 'Ask KimtAI…');
    body.type = 'button';
    body.addEventListener('click', () => ctx.openApp('kimtai'));
    card.append(head, body);
    return card;
  },

  render(body: HTMLElement, ctx: { session?: unknown; saveSession?: (s: unknown) => void } = {}) {
    // Come back to the chat the user was reading (#1172).
    const entrySession = createEntrySession(ctx);
    // --- session state ---
    let session: ChatSession | null = null;
    let sessionModel: string | null = null;
    let engineDevice: string | null = null; // 'webgpu' | 'wasm' — the EP the model uses
    let generating = false;
    let activeChatId: string | null = null;
    let messages: Message[] = [];
    let chatConfig = defaults();
    let autoFollow = true; // keep pinned to the bottom while streaming
    let loadLabel = ''; // live model-load status ("Downloading… 42%", "Warming up…")
    let liveStatusEl: HTMLElement | null = null; // composer status <span> updated while loading
    // A reply that has been started but has NOT reached the engine yet, because the model is
    // still loading. The engine cannot cancel it — it routes by run id and no run exists before
    // `send()`, so `stop()` is a deliberate no-op there (#967) and the reply used to stream
    // anyway once the load finished (#982). Set for exactly that window, so Stop has something
    // to cancel; null once the run is the engine's problem, or once the conversation it was
    // asked in has been left.
    let pendingRun: { cancel: () => void } | null = null;

    function paintLoadStatus(): void {
      if (liveStatusEl?.isConnected && !engineDevice) liveStatusEl.textContent = loadLabel || 'Loading model…';
    }

    function defaults(): ChatConfig {
      return {
        systemPrompt: (getAppValue('kimtai', 'systemPrompt', DEFAULT_SYSTEM) as string) || DEFAULT_SYSTEM,
        // Default 0.4 ("Balanced"), not 0.7 ("Creative"): a lower temperature keeps a small model
        // focused and markedly less prone to padding/inventing (#557). Overridable per chat.
        temperature: clampNum(getAppValue('kimtai', 'temperature', 0.4), 0, 1, 0.4),
        maxTokens: clampNum(getAppValue('kimtai', 'maxTokens', 512), 64, 2048, 512),
      };
    }

    const activeModel = (): string | null => {
      const stored = getAppValue('kimtai', 'activeModel') as string | undefined;
      return stored && byId(stored) ? stored : null;
    };

    // --- layout: reuse the shared sidebar shell (mt-*) ---
    const layout = el('div', 'mt-layout kimtai-layout');
    const history = createHistorySidebar({
      title: 'Chats',
      emptyText: 'No conversations yet.',
      searchable: true,
      searchPlaceholder: 'Search chats…',
      load: async () => {
        try {
          return ((await getApi('chats')) as { chats?: HistorySidebarEntry[] }).chats || [];
        } catch {
          return [];
        }
      },
      remove: async (entry) => {
        await jsonApi('DELETE', `chats/${entry.id}`);
      },
      // No `date` override: the shared sidebar falls back to formatWhen(entry.at), and the
      // chats route serves `at` as the last-updated time. Passing an empty string here is
      // what suppressed the timestamp every other app shows (#953).
      itemOf: (entry) => ({
        snippet: ((entry as ChatEntry).title as string) || 'New chat',
        pinned: !!(entry as ChatEntry).pinned,
      }),
      menu: (entry) => {
        const e = entry as ChatEntry;
        return [
          { label: e.pinned ? 'Unpin' : 'Pin', icon: PIN, onClick: () => togglePin(e) },
          { label: 'Rename', icon: PENCIL, onClick: () => renameChat(e) },
          { label: 'Export .md', icon: DOWNLOAD, onClick: () => exportChat(e) },
        ];
      },
      onOpen: (entry) => {
        openChat(entry);
        entrySession.remember(entry.id);
      },
      onNew: () => {
        newChat();
        entrySession.remember(null);
      },
      initialActiveId: entrySession.initialActiveId,
      confirmMessage: 'Delete this conversation?',
      undoMessage: 'Conversation deleted',
      selectable: true,
      bulkConfirm: (n) => `Delete ${n} conversation${n === 1 ? '' : 's'}?`,
      bulkUndo: (n) => `${n} conversation${n === 1 ? '' : 's'} deleted`,
    });
    const sidebarEl = history.el;
    sidebarEl.style.width = `${sidebarWidth}px`;
    const resizer = createResizer({
      layout,
      pane: sidebarEl,
      reserve: 320,
      onResize: (w) => {
        sidebarWidth = w;
      },
    });
    const main = el('div', 'kimtai-main mt-main');
    layout.append(sidebarEl, resizer, main);
    body.replaceChildren(layout);
    const responsive = makeSidebarResponsive({ layout, sidebar: sidebarEl, label: 'Chats' });

    // --- header (model status + tune + Model Library) ---
    const modelChip = el('span', 'kimtai-model-status');
    const tuneBtn = el('button', 'kimtai-icon-btn');
    tuneBtn.type = 'button';
    tuneBtn.title = 'Chat settings (prompt, creativity, length)';
    tuneBtn.setAttribute('aria-label', 'Chat settings');
    tuneBtn.innerHTML = SLIDERS;
    tuneBtn.addEventListener('click', openTune);
    const modelsBtn = el('button', 'button-secondary kimtai-models-btn', 'Models');
    modelsBtn.type = 'button';
    modelsBtn.addEventListener('click', openLibrary);
    const header = el('div', 'kimtai-header');
    header.append(modelChip, tuneBtn, modelsBtn);
    const tunePop = createPopover({ host: header, className: 'kimtai-pop' });

    const thread = el('div', 'kimtai-thread');
    const jump = el('button', 'kimtai-jump', '↓ Latest');
    jump.type = 'button';
    jump.hidden = true;
    jump.addEventListener('click', () => {
      autoFollow = true;
      scrollToEnd();
      jump.hidden = true;
    });
    thread.addEventListener(
      'scroll',
      rafThrottle(() => {
        const near = isNearBottom();
        autoFollow = near;
        jump.hidden = near;
      }),
    );

    // --- composer ---
    const input = el('textarea', 'kimtai-input');
    input.rows = 1;
    input.placeholder = 'Message KimtAI…';
    input.addEventListener('input', rafThrottle(autoGrow));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    });
    const sendBtn = el('button', 'button-primary kimtai-send', 'Send');
    sendBtn.type = 'button';
    sendBtn.addEventListener('click', onSend);
    const composer = el('div', 'kimtai-composer');
    composer.append(input, sendBtn);

    main.append(header, thread, jump, composer);

    function autoGrow(): void {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }
    const isNearBottom = (): boolean => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    function scrollToEnd(): void {
      thread.scrollTop = thread.scrollHeight;
    }

    async function refreshModelChip(): Promise<void> {
      const active = activeModel();
      const downloaded = await downloadedModels();
      if (!downloaded.length) {
        modelChip.textContent = 'No model — use Models →';
        modelChip.classList.add('is-empty');
        return;
      }
      modelChip.classList.remove('is-empty');
      const dev = engineDevice === 'webgpu' ? ' · GPU' : engineDevice === 'wasm' ? ' · CPU' : '';
      const m = active ? byId(active) : null;
      modelChip.textContent = (m ? m.label : 'Ready') + dev;
    }

    // --- conversations ---
    // A generation belongs to the conversation it was started in, and that conversation
    // IS its `messages` array: `newChat()`/`openChat()` install a fresh one. So a reply
    // that arrives after the user has moved on can tell it is no longer wanted and drop
    // itself, instead of being appended to — and persisted into — whichever conversation
    // is now open (#951). Every write-back path checks this before touching state.
    const stillOwns = (owner: Message[]): boolean => owner === messages;

    // Leaving a conversation mid-reply is an explicit teardown, not an abandonment.
    // Without it the composer stays stuck on Stop in the conversation you just opened,
    // because `generating` is only ever cleared by the old generation's finish (#951).
    function endActiveGeneration(): void {
      if (!generating) return;
      // Detach the conversation from the run BEFORE stopping it: stop() settles the
      // run synchronously, and its finish() must see it no longer owns the thread so
      // the half-streamed reply is dropped, not written into the chat being left
      // (the user can Retry). A fresh array with the same turns keeps the content
      // for persist() below and severs the ownership.
      messages = [...messages];
      // stop(), not dispose. The engine routes a run's messages by run id (#967):
      // stopping settles the run and drops anything the worker still posts for it,
      // so it can never report into the next conversation — and the model stays
      // resident instead of paying a reload on the next send.
      session?.stop();
      // Leaving is not cancelling: the reply drops itself because it no longer owns the
      // conversation (below), so the Stop handle for it is simply no longer the app's to hold.
      pendingRun = null;
      generating = false;
      updateComposer();
      armIdle();
      // Keep the message the user already sent in the chat they sent it in — this runs
      // before `messages`/`activeChatId` are reassigned, so it saves the right one.
      void persist();
    }

    function newChat(): void {
      endActiveGeneration();
      activeChatId = null;
      messages = [];
      chatConfig = defaults();
      drawThread();
    }

    async function openChat(entry: HistorySidebarEntry): Promise<void> {
      endActiveGeneration();
      try {
        const chat = (await getApi(`chats/${entry.id}`)) as ChatEntry;
        activeChatId = chat.id;
        messages = Array.isArray(chat.messages) ? chat.messages : [];
        chatConfig = { ...defaults(), ...(chat.config || {}) };
        drawThread();
      } catch {
        newChat();
      }
    }

    async function renameChat(entry: ChatEntry): Promise<void> {
      const name = await promptDialog({
        title: 'Rename conversation',
        label: 'Name',
        value: entry.title || '',
        confirmLabel: 'Rename',
      });
      if (name == null) return;
      await jsonApi('PATCH', `chats/${entry.id}`, { title: name });
      history.refresh();
    }

    async function togglePin(entry: ChatEntry): Promise<void> {
      await jsonApi('PATCH', `chats/${entry.id}`, { pinned: !entry.pinned });
      history.refresh();
    }

    async function exportChat(entry: ChatEntry): Promise<void> {
      const chat = (await getApi(`chats/${entry.id}`)) as ChatEntry;
      const lines = [`# ${chat.title || 'Conversation'}`, ''];
      for (const m of chat.messages || []) {
        lines.push(m.role === 'user' ? '**You:**' : '**KimtAI:**', '', m.content, '');
      }
      downloadText(lines.join('\n'), `${safeFilename(chat.title || 'conversation', 'conversation')}.md`);
    }

    async function persist(): Promise<void> {
      // Bind to the conversation as it is NOW: the write is async, and the user may open
      // another chat while it is in flight (#951).
      const owner = messages;
      const chatId = activeChatId;
      const title = titleFrom(owner);
      if (chatId) {
        await jsonApi('PATCH', `chats/${chatId}`, { messages: owner, title, config: chatConfig });
      } else if (owner.length) {
        const chat = (await jsonApi('POST', 'chats', { messages: owner, title, config: chatConfig })) as ChatEntry;
        // Only adopt the new id if this is still the conversation on screen; otherwise it
        // would point the open chat at a record that is not its own.
        if (stillOwns(owner)) activeChatId = chat.id;
      }
      history.refresh();
    }

    // --- per-chat generation controls ---
    async function setChatConfig(patch: Partial<ChatConfig>): Promise<void> {
      chatConfig = { ...chatConfig, ...patch };
      for (const [k, v] of Object.entries(patch)) await setAppConfig('kimtai', k, v);
      if (activeChatId) await jsonApi('PATCH', `chats/${activeChatId}`, { config: chatConfig });
    }

    function openTune(): void {
      tunePop.toggle(tuneBtn, (panel) => {
        panel.append(el('label', 'kimtai-pop-label', 'System prompt'));
        const sys = el('textarea', 'kimtai-pop-textarea');
        sys.rows = 3;
        sys.value = chatConfig.systemPrompt;
        sys.placeholder = DEFAULT_SYSTEM;
        sys.addEventListener('input', () => setChatConfig({ systemPrompt: sys.value }));
        panel.append(sys);

        const creativity = el('label', 'kimtai-pop-label');
        creativity.append('Creativity — ');
        const cName = el('span', 'kimtai-pop-strong', tempLabel(chatConfig.temperature));
        creativity.append(cName);
        panel.append(creativity);
        const temp = el('input', 'kimtai-pop-range');
        temp.type = 'range';
        temp.min = '0';
        temp.max = '1';
        temp.step = '0.05';
        temp.value = String(chatConfig.temperature);
        temp.addEventListener('input', () => {
          const v = Number(temp.value);
          cName.textContent = tempLabel(v);
          setChatConfig({ temperature: v });
        });
        panel.append(temp);

        panel.append(el('label', 'kimtai-pop-label', 'Response length'));
        const len = el('select', 'kimtai-pop-select');
        for (const [label, val] of LENGTHS) {
          const o = el('option', undefined, label);
          o.value = String(val);
          if (val === chatConfig.maxTokens) o.selected = true;
          len.append(o);
        }
        len.addEventListener('change', () => setChatConfig({ maxTokens: Number(len.value) }));
        panel.append(len);
      });
    }

    // --- rendering the thread ---
    function drawThread(): void {
      thread.replaceChildren();
      if (!messages.length) {
        thread.append(emptyState());
        return;
      }
      messages.forEach((m, i) => thread.append(messageRow(m, i, i === messages.length - 1)));
      scrollToEnd();
    }

    function emptyState(): HTMLElement {
      const wrap = el('div', 'kimtai-empty');
      wrap.append(
        el('h3', 'kimtai-empty-title', 'Ask KimtAI anything'),
        el('p', 'kimtai-empty-sub', 'It runs entirely on your device — your chats never leave the browser.'),
      );
      if (!webgpuAvailable()) {
        wrap.append(
          el(
            'p',
            'kimtai-note',
            'Your browser has no WebGPU, so models run slower (CPU). A small model is recommended.',
          ),
        );
      }
      return wrap;
    }

    // A finalized message row (user or assistant) from the stored history.
    function messageRow(msg: Message, index: number, isLast: boolean): HTMLElement {
      const row = el('div', `kimtai-msg is-${msg.role}`);
      const bubble = el('div', 'kimtai-bubble');
      if (msg.role === 'assistant') {
        const md = el('div', 'md-preview');
        renderMarkdownInto(md, msg.content);
        bubble.append(md);
        row.append(bubble, assistantActions(msg.content, 0, isLast));
      } else {
        bubble.textContent = msg.content;
        const edit = el('button', 'kimtai-edit');
        edit.type = 'button';
        edit.title = 'Edit & resend';
        edit.setAttribute('aria-label', 'Edit & resend');
        edit.innerHTML = PENCIL;
        edit.addEventListener('click', () => editUser(index));
        row.append(bubble, edit);
      }
      return row;
    }

    // Actions under an assistant reply: Copy, Regenerate (last only), + speed meta.
    function assistantActions(content: string, rate: number, isLast: boolean): HTMLElement {
      const actions = el('div', 'kimtai-msg-actions');
      actions.append(createCopyButton(() => content, 'Copy'));
      if (isLast) {
        const regen = el('button', 'kimtai-mini-btn kimtai-regen');
        regen.type = 'button';
        regen.title = 'Regenerate reply';
        regen.innerHTML = `${REGEN}<span>Retry</span>`;
        regen.addEventListener('click', () => void regenerate());
        actions.append(regen);
      }
      const dev = engineDevice === 'webgpu' ? 'GPU' : engineDevice === 'wasm' ? 'CPU' : '';
      const metaText = [rate ? `${rate} tok/s` : '', dev].filter(Boolean).join(' · ');
      if (metaText) actions.append(el('span', 'kimtai-meta', metaText));
      return actions;
    }

    function updateComposer(): void {
      sendBtn.textContent = generating ? 'Stop' : 'Send';
      sendBtn.classList.toggle('is-stop', generating);
      input.disabled = false;
    }

    // --- sending / streaming ---
    async function ensureSession(): Promise<ChatSession | null> {
      const downloaded = await downloadedModels();
      if (!downloaded.length) return null;
      let model = activeModel();
      if (!model || !downloaded.includes(model)) {
        model = downloaded[0];
        await setAppConfig('kimtai', 'activeModel', model);
        refreshModelChip();
      }
      if (session && sessionModel === model) return session;
      session?.dispose();
      sessionModel = model;
      engineDevice = null;
      loadLabel = 'Loading model…';
      session = createChat({
        model,
        onProgress: (p: { ratio?: number | null }) => {
          loadLabel = p?.ratio != null ? `Downloading model… ${Math.round(p.ratio * 100)}%` : 'Downloading model…';
          paintLoadStatus();
        },
        onStatus: (st: string) => {
          if (st === 'warming') loadLabel = 'Warming up the model…';
          else if (st === 'wasm-fallback') loadLabel = 'GPU unavailable — loading on CPU (slow)…';
          paintLoadStatus();
        },
      }) as ChatSession;
      return session;
    }

    function resetSession(): void {
      session?.dispose();
      session = null;
      sessionModel = null;
      engineDevice = null;
    }

    // Free the resident model when the user isn't actively chatting.
    const IDLE_MS = 4 * 60 * 1000;
    const HIDDEN_MS = 20 * 1000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const freeIdleSession = (): void => {
      if (generating || !session) return;
      resetSession();
      refreshModelChip();
    };
    const armIdle = (ms = IDLE_MS): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(freeIdleSession, ms);
    };
    const onVisibility = (): void => armIdle(document.hidden ? HIDDEN_MS : IDLE_MS);
    document.addEventListener('visibilitychange', onVisibility);

    async function onSend(): Promise<void> {
      if (generating) {
        // Before the request reaches the engine the engine has no run to stop, so the app
        // cancels the pending reply itself (#982). The model load is deliberately left to
        // finish: the resident model is what the next send reuses.
        if (pendingRun) pendingRun.cancel();
        else session?.stop();
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      const owner = messages;
      const s = await ensureSession();
      if (!s) {
        openLibrary();
        return;
      }
      // The user opened another chat while the session was being resolved. Leave the text
      // in the composer rather than posting it into a conversation it was not meant for —
      // the same ownership rule the reply itself follows (#951).
      if (!stillOwns(owner)) return;
      if (!messages.length) thread.replaceChildren();
      messages.push({ role: 'user', content: text });
      thread.append(messageRow(messages[messages.length - 1], messages.length - 1, false));
      input.value = '';
      autoGrow();
      autoFollow = true;
      scrollToEnd();
      runGeneration(s);
    }

    // Retry loads the model the same way Send does. It used to require an already-resident
    // `session` and bail silently without one — which is exactly the state a reopened
    // conversation is in (`openChat` never builds a session), and the state any conversation
    // returns to once the idle timer frees the model. So Retry did nothing at all, with no
    // feedback (#952).
    async function regenerate(): Promise<void> {
      if (generating) return;
      const owner = messages;
      const s = await ensureSession();
      if (!s) {
        openLibrary();
        return;
      }
      if (!stillOwns(owner)) return; // the user opened another chat while the model loaded
      if (messages[messages.length - 1]?.role === 'assistant') {
        messages.pop();
        thread.querySelector('.kimtai-msg.is-assistant:last-child')?.remove();
      }
      if (!messages.length) return;
      autoFollow = true;
      runGeneration(s);
    }

    function editUser(index: number): void {
      // Say why rather than doing nothing: an unresponsive button reads as a broken app.
      if (generating) {
        showSnackbar('Stop the current reply before editing a message.');
        return;
      }
      const msg = messages[index];
      if (!msg || msg.role !== 'user') return;
      messages = messages.slice(0, index);
      input.value = msg.content;
      autoGrow();
      input.focus();
      drawThread();
      persist();
    }

    async function runGeneration(s: ChatSession): Promise<void> {
      // The conversation this reply belongs to. Everything below is checked against it,
      // so a late token or a late completion cannot touch a conversation it was not
      // asked in (#951).
      const owner = messages;
      generating = true;
      if (idleTimer) clearTimeout(idleTimer); // don't dispose the model while it's working
      updateComposer();
      thread.querySelectorAll('.kimtai-regen').forEach((b) => b.remove());

      const row = el('div', 'kimtai-msg is-assistant');
      const bubble = el('div', 'kimtai-bubble');
      const md = el('div', 'md-preview is-streaming');
      const status = el('span', 'kimtai-thinking', engineDevice ? 'Thinking…' : loadLabel || 'Loading model…');
      liveStatusEl = status;
      md.append(status);
      bubble.append(md);
      row.append(bubble);
      thread.append(row);
      if (autoFollow) scrollToEnd();

      let tokens = 0;
      let startTime = 0;
      let renderTimer: ReturnType<typeof setTimeout> | null = null;
      let statusShown = true;

      const scheduleRender = (text: string): void => {
        if (renderTimer) return;
        renderTimer = setTimeout(() => {
          renderTimer = null;
          renderMarkdownInto(md, text);
          md.classList.add('is-streaming');
          if (autoFollow) scrollToEnd();
        }, 140);
      };

      const onStream = (text: string): void => {
        // `thread` is shared, so an abandoned stream would still scroll the conversation
        // the user has moved to while rendering into a detached bubble.
        if (!stillOwns(owner)) return;
        if (statusShown) {
          status.remove();
          statusShown = false;
        }
        if (!startTime) startTime = performance.now();
        tokens++;
        scheduleRender(text);
      };

      const finish = async (finalText: string, isError: boolean): Promise<void> => {
        if (renderTimer) clearTimeout(renderTimer);
        // The user left this conversation while it was generating. `endActiveGeneration`
        // has already reset the composer for the conversation now open, so this reply has
        // nowhere to go — dropping it is the whole point (#951).
        if (!stillOwns(owner)) return;
        generating = false;
        armIdle();
        updateComposer();
        if (statusShown) status.remove();
        if (isError) {
          md.classList.remove('is-streaming');
          md.replaceChildren(el('p', 'kimtai-error', finalText));
          return;
        }
        const content = (finalText || '').trim() || '(no response)';
        messages.push({ role: 'assistant', content });
        md.classList.remove('is-streaming');
        renderMarkdownInto(md, content);
        const rate = tokens && startTime ? Math.round(tokens / ((performance.now() - startTime) / 1000)) : 0;
        if (rate && sessionModel) recordSpeed(sessionModel, rate);
        row.append(assistantActions(content, rate, true));
        if (autoFollow) scrollToEnd();
        await persist();
      };

      // Stop is offered from the moment Send is pressed, but the request only reaches the
      // engine after the model has loaded — seconds on a WASM machine. For that window the
      // app is the only thing that can cancel the reply, so it registers how (#982).
      let cancelled = false;
      // Only ever clears THIS run's handle: a later run may already have replaced it, and
      // dropping that one would leave the reply now pending with nothing to cancel it.
      const releasePending = (): void => {
        if (pendingRun === pending) pendingRun = null;
      };
      const pending = {
        cancel: (): void => {
          releasePending();
          cancelled = true;
          if (renderTimer) clearTimeout(renderTimer);
          row.remove(); // the placeholder reply, still showing the load status
          generating = false;
          armIdle();
          updateComposer();
          // The turn the user already sent stays in the conversation they sent it in — the
          // same rule `endActiveGeneration` follows. Cancelling the reply must not lose it.
          void persist();
        },
      };
      pendingRun = pending;

      try {
        const device = await s.ready;
        // From here the run is the engine's to stop: it is either dispatched below or
        // abandoned outright, so the app-level handle has nothing left to cancel.
        releasePending();
        // Stop was pressed while the model was loading. The load itself is allowed to finish
        // (the model stays resident for the next send); the reply is simply never asked for.
        if (cancelled) return;
        // Loading a model takes seconds; the user may well have moved on by now, and there
        // is no point asking for a reply nobody will read (#951).
        if (!stillOwns(owner)) return;
        engineDevice = device;
        if (status.isConnected) status.textContent = 'Thinking…';
        refreshModelChip();
        const model = sessionModel ?? '';
        // Plain chat: one streamed generation, no tool loop. Also the safety-net
        // fallback if the agent loop ever fails, so a tool bug can't crash chat.
        const runPlainChat = (): void => {
          const work = buildMessages(messages, chatConfig.systemPrompt || DEFAULT_SYSTEM);
          s.send(
            work,
            {
              onToken: (_t, acc) => onStream(acc),
              onDone: (text) => finish(text || '', false),
              onError: (err) => finish(err instanceof Error ? err.message : 'Something went wrong.', true),
            },
            { temperature: chatConfig.temperature, maxTokens: chatConfig.maxTokens },
          );
        };
        const tools = [...availableTools(), ...systemTools];
        if (tools.length && supportsNativeTools(model)) {
          // Agentic path: a tool-capable model (Qwen/Llama) can call tools —
          // the installed apps' tools — in a loop, then answer. Only for
          // native-tool models; small models stay on plain chat. ANY failure in the
          // loop falls back to plain chat (and logs) so it can never crash chat.
          try {
            await runAgent({
              session: s as unknown as AgentSession,
              history: messages,
              systemPrompt: chatConfig.systemPrompt || DEFAULT_SYSTEM,
              model,
              tools,
              // Prompt-based protocol, not Transformers.js's native template `tools`.
              nativeTools: false,
              genOpts: { temperature: chatConfig.temperature, maxTokens: chatConfig.maxTokens },
              onStream: (acc) => onStream(acc),
              onStep: (info) => {
                if (status.isConnected)
                  status.textContent = info.status === 'run' ? `Using ${info.tool}…` : 'Thinking…';
              },
              onFinal: (text) => void finish(text || '', false),
              onError: (err) => {
                console.error('[kimtai] agent loop error — falling back to plain chat:', err);
                runPlainChat();
              },
            });
          } catch (agentErr) {
            console.error('[kimtai] agent loop threw — falling back to plain chat:', agentErr);
            runPlainChat();
          }
        } else {
          runPlainChat();
        }
      } catch (err) {
        releasePending();
        resetSession();
        refreshModelChip();
        // The user already cancelled this reply; the row is gone and the composer is back on
        // Send, so a load failure has nowhere to report and nothing left to settle.
        if (cancelled) return;
        finish(err instanceof Error ? err.message : 'The model failed to load.', true);
      }
    }

    // --- Model Library overlay ---
    async function openLibrary(): Promise<void> {
      const downloaded = new Set(await downloadedModels());
      const speeds = (await modelSpeeds()) as Record<string, number>;
      const rec = recommendedModelId();

      const overlay = el('div', 'kimtai-lib-overlay');
      setAccent(overlay, ACCENT);
      const card = el('div', 'kimtai-lib-card');
      const head = el('div', 'kimtai-lib-head');
      head.append(el('h2', 'kimtai-lib-title', 'Model Library'));
      const close = el('button', 'close-x', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      head.append(close);
      const sub = el(
        'p',
        'kimtai-lib-sub',
        'Download any models you like and pick one to chat with. Everything runs on your device.',
      );
      const recModel = byId(rec);
      const recNote = recModel
        ? el(
            'p',
            'kimtai-lib-rec',
            `${recModel.label} — a small, fast chat model that runs entirely on your device. Nothing is uploaded.`,
          )
        : null;
      const list = el('div', 'kimtai-lib-list');
      card.append(head, sub, ...(recNote ? [recNote] : []), list);
      overlay.append(card);
      overlayHost().append(overlay);

      // Closing the library does not stop a download, and nothing has to say so any more: the
      // transfer has a row in KimtManager with its own progress and its own Stop. The snackbar
      // that used to live here — six seconds, with a Reopen button — was standing in for that
      // row, and the only way back to a running download was the dialog it started in (#1275).
      const shut = (): void => {
        overlay.remove();
        refreshModelChip();
      };
      close.addEventListener('click', shut);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) shut();
      });

      const drawList = (): void =>
        list.replaceChildren(
          ...(MODELS as unknown as ModelInfo[]).map((m) => modelRow(m, downloaded, speeds, rec, drawList)),
        );
      drawList();
    }

    // Resource-gated download confirm (#269): compare the model's declared needs against what THIS
    // device reports and, when it looks under-spec, warn and require an explicit acknowledgement
    // before the Download button is enabled. An already-downloaded model never reaches here (its
    // row shows Use/Remove). Resolves true to proceed, false to cancel.
    async function confirmModelDownload(id: string): Promise<boolean> {
      const model = byId(id);
      if (!model) return false;
      const res = await detectDeviceResources();
      const fit = evaluateModelFit(model, res);

      const body = el('div', 'kimtai-dl-confirm');
      body.append(
        el('p', 'kimtai-dl-title', `Download ${model.label}?`),
        el('p', 'kimtai-dl-size', `${model.size} · one-time download, then it runs offline.`),
        el('p', 'kimtai-dl-device', `This device: ${describeDevice(res)}`),
      );

      if (fit.level !== 'ok') {
        const box = el('div', `kimtai-dl-warn is-${fit.level}`);
        box.append(
          el(
            'p',
            'kimtai-dl-warn-title',
            fit.level === 'warn' ? 'This model may not run well on this device' : 'Heads up',
          ),
        );
        const ul = el('ul', 'kimtai-dl-reasons');
        for (const r of fit.reasons) ul.append(el('li', '', r));
        box.append(ul);
        body.append(box);
      }

      // A small confirm prompt, not a full window (#563): the size/device summary and any
      // fit warning render inside the shared confirm card. A hard 'warn' must be
      // acknowledged — the checkbox keeps Download disabled until it is ticked.
      return confirmDialog(body, {
        confirmLabel: 'Download',
        danger: false,
        checkbox: fit.level === 'warn' ? { label: 'I understand and want to download it anyway.' } : undefined,
      });
    }

    function modelRow(
      m: ModelInfo,
      downloaded: Set<string>,
      speeds: Record<string, number> | undefined,
      rec: string,
      redraw: () => void,
    ): HTMLElement {
      const row = el('div', 'kimtai-lib-row');
      const info = el('div', 'kimtai-lib-info');
      const nameLine = el('div', 'kimtai-lib-name');
      nameLine.append(el('span', 'kimtai-lib-label', m.label));
      if (m.badge) nameLine.append(el('span', `kimtai-badge tier-${m.badge.toLowerCase()}`, m.badge));
      if (m.id === rec) nameLine.append(el('span', 'kimtai-badge tier-rec', 'Recommended'));
      const measured = speeds?.[m.id] ? ` · ~${speeds[m.id]} tok/s here` : '';
      const meta = el(
        'div',
        'kimtai-lib-meta',
        `${m.params} · ${m.size} · ${m.needsWebGPU ? 'WebGPU' : 'CPU/WebGPU'} · ${SPEED_TIER[m.tier ?? ''] || ''}${measured}`,
      );
      info.append(nameLine, meta, el('div', 'kimtai-lib-note', m.note ?? ''));
      const actions = el('div', 'kimtai-lib-actions');
      row.append(info, actions);

      const render = (isDownloaded: boolean): void => {
        actions.replaceChildren();
        if (isDownloaded) {
          const isActive = activeModel() === m.id;
          const use = el('button', 'button-secondary', isActive ? 'In use ✓' : 'Use');
          use.type = 'button';
          use.disabled = isActive;
          use.addEventListener('click', async () => {
            await setAppConfig('kimtai', 'activeModel', m.id);
            if (sessionModel && sessionModel !== m.id) resetSession();
            refreshModelChip();
            redraw();
          });
          const del = el('button', 'button-secondary is-danger', 'Remove');
          del.type = 'button';
          del.addEventListener('click', async () => {
            if (!(await confirmDialog(`Remove ${m.label}? You can download it again later.`))) return;
            await removeModel(m.id);
            downloaded.delete(m.id);
            if (sessionModel === m.id) resetSession();
            render(false);
            refreshModelChip();
          });
          actions.append(use, del);
        } else if (activeModelDownload() === m.id) {
          showDownloading(modelDownloadJob()!);
        } else {
          const dl = el('button', 'button-primary');
          dl.type = 'button';
          dl.innerHTML = `${DOWNLOAD}<span>Download</span>`;
          dl.addEventListener('click', async () => {
            if (!(await confirmModelDownload(m.id))) return;
            // One download per app: the orchestrator queues rather than letting two of them
            // share one connection, and a second Download button would be a lie about that.
            if (modelDownloadJob()) {
              showSnackbar('Another model is already downloading. It will start when that finishes.');
              return;
            }
            showDownloading(startModelDownload(m.id, m.label));
          });
          actions.append(dl);
        }
      };

      // The live download state for this row: progress bar plus a Cancel control (#655).
      // Rendered both when the user starts the download and when the Model Library is
      // reopened on one already in flight, so the control is never missing.
      const showDownloading = (job: Job): void => {
        const bar = createProgressBar({ hint: 'One-time download — then it runs offline.' });
        const paint = (): void => bar.update({ phase: 'download', label: job.label(), ratio: job.progress() });
        paint();
        const cancel = el('button', 'button-secondary kimtai-dl-cancel', 'Cancel');
        cancel.type = 'button';
        cancel.setAttribute('aria-label', `Cancel downloading ${m.label}`);
        cancel.addEventListener('click', () => {
          cancel.disabled = true;
          cancel.textContent = 'Cancelling…';
          job.cancel();
        });
        const live = el('div', 'kimtai-dl-live');
        live.append(bar.el, cancel);
        actions.replaceChildren(live);

        // The orchestrator is the one source of truth for this transfer, so the row watches it
        // rather than owning it. A download outlives the Model Library window, so reopening the
        // library builds a SECOND row against the same job while this one is detached — drop the
        // stale subscription instead of repainting a row nobody can see.
        const off = kimtManager.subscribe(() => {
          if (!row.isConnected) {
            off();
            return;
          }
          const status = job.status();
          if (status === 'running' || status === 'queued') {
            paint();
            return;
          }
          off();
          if (status === 'done') {
            downloaded.add(m.id);
            render(true);
            refreshModelChip();
            return;
          }
          if (status === 'failed') {
            actions.replaceChildren(el('p', 'kimtai-error', job.error() || 'Download failed.'));
            setTimeout(() => render(false), 2500);
            return;
          }
          // Cancelled — back to a Download button, and say so, because the user asked for it.
          render(false);
          showSnackbar(`Download of ${m.label} cancelled.`);
        });
      };

      render(downloaded.has(m.id));
      return row;
    }

    // --- init ---
    refreshModelChip();
    history.showNew();
    entrySession.start();

    pruneRemovedModels()
      .then((n: number) => {
        if (n) refreshModelChip();
      })
      .catch(() => {});

    // Opened from the home search bar's "KimtAI" layout: send the typed message.
    if (pendingMessage) {
      input.value = pendingMessage;
      pendingMessage = null;
      void onSend();
    }

    return () => {
      history.destroy(); // first: stopping things below is itself what asks the sidebar to repaint
      if (idleTimer) clearTimeout(idleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      session?.dispose();
      responsive?.destroy();
    };
  },
};
