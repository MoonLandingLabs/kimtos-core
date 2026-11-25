import { confirmDialog } from '../components/confirm.js';
import { setHandoff, type HandoffStatus } from './appHandoff.js';
import { dataStore as db } from './dataStore.js';
import { isInstalled } from '../models/installed.js';
import { el } from './dom.js';

// Shared cross-app handoff links. Several apps offer "send this clip to <other
// app>" actions (Voice to Text → Denoise, Denoise → Voice to Text): the clip is
// routed via appHandoff, and the trigger button/menu-item reflects the send with
// an Opening… → working → Done ✓ state machine (restoring on error/cancel). This
// centralizes that machinery for the media-text factory and Denoise.

/** A produced history entry (its `blobKey` is the clip to hand off). */
export interface HandoffEntry {
  id: string;
  from?: string | null; // null = produced here (no source app)
  name?: string;
  blobKey?: string;
  [key: string]: unknown;
}
/** A raw input clip forwarded before it's been processed here. */
export interface HandoffClip {
  blob?: Blob;
  filename?: string;
  from?: string | null;
  srcId?: string;
}
// A `link` describes one target app.
export interface HandoffLink {
  appId: string;
  label: string;
  icon?: string;
  working?: string;
  done?: string;
  blobKey?: (entry: HandoffEntry) => string | undefined; // which stored blob to send
  filename?: (entry: HandoffEntry) => string; // filename for the handed-over clip
  againMessage?: string;
  againConfirm?: string; // confirm if already processed there
}
type StatusFn = (status: HandoffStatus) => void;
interface CreateHandoffOptions {
  self: { id: string; name: string };
  openApp?: (appId: string) => void;
  links?: HandoffLink[];
}

export function createHandoffLinks({ self, openApp, links = [] }: CreateHandoffOptions) {
  // In-flight sends, keyed `${entryId}:${appId}`, so a button/menu-item stays
  // disabled/hidden until the target reports back.
  const busy = new Set<string>();
  const keyOf = (entry: HandoffEntry, appId: string): string => `${entry.id}:${appId}`;

  // Has `appId` already produced a result from this exact record? (targets stamp
  // results they made from a handoff with our id + the source record's id.)
  const alreadyDone = async (appId: string, entry: HandoffEntry): Promise<boolean> =>
    (await db.list(`history:${appId}`)).some((e) => e.from === self.id && e.srcId === entry.id);

  const blobKeyOf = (link: HandoffLink, entry: HandoffEntry): string | undefined =>
    (link.blobKey || ((e: HandoffEntry) => e.blobKey))(entry);
  // Links that apply to a produced entry: target installed, not the entry's own
  // origin (don't send it straight back), and the entry still has the blob to send.
  const linksFor = (entry: HandoffEntry): HandoffLink[] =>
    links.filter((l) => l.appId !== entry.from && isInstalled(l.appId) && !!blobKeyOf(l, entry));
  // Links usable from the input screen (no entry yet): just the installed ones.
  const forwardLinks = (): HandoffLink[] => links.filter((l) => isInstalled(l.appId));

  // Send a produced clip (link.blobKey(entry)) to the target, stamped with our id
  // and the source record id. Confirms first if it was already processed there.
  const sendResult = async (link: HandoffLink, entry: HandoffEntry, onStatus?: StatusFn): Promise<boolean> => {
    if (!isInstalled(link.appId)) return false;
    if (link.againMessage && (await alreadyDone(link.appId, entry))) {
      const go = await confirmDialog(link.againMessage, {
        confirmLabel: link.againConfirm || 'Do it again',
        danger: false,
      });
      if (!go) return false;
    }
    const key = blobKeyOf(link, entry);
    const blob = key ? await db.getBlob(key) : null;
    if (!blob) return false;
    setHandoff(
      link.appId,
      {
        blob,
        filename: (link.filename ? link.filename(entry) : entry.name) || `${self.id}.webm`,
        from: self.id,
        fromLabel: self.name,
        srcId: entry.id,
      },
      onStatus,
    );
    openApp?.(link.appId);
    return true;
  };

  // Forward a raw input clip (not produced here) — its original provenance is
  // preserved (not stamped to us), since we didn't process it.
  const sendInput = async (
    link: HandoffLink,
    clip: HandoffClip | null | undefined,
    onStatus?: StatusFn,
  ): Promise<boolean> => {
    if (!clip?.blob || !isInstalled(link.appId)) return false;
    setHandoff(
      link.appId,
      { blob: clip.blob, filename: clip.filename, from: clip.from || null, srcId: clip.srcId },
      onStatus,
    );
    openApp?.(link.appId);
    return true;
  };

  // The Opening… → working → Done ✓ button. `send` is (onStatus) => Promise<bool>;
  // `trackKey` (when given) mirrors an in-flight send in `busy` so re-renders show
  // the right state. Returns { el, setLabel }.
  const makeButton = (
    link: HandoffLink,
    send: (onStatus: StatusFn) => Promise<boolean>,
    trackKey?: string,
  ): { el: HTMLButtonElement; setLabel: (t: string) => void } => {
    const b = el('button', 'button-secondary mt-link');
    b.type = 'button';
    const setLabel = (t: string): void => {
      b.innerHTML = `${link.icon || ''}<span>${t}</span>`;
    };
    setLabel(link.label);
    if (trackKey && busy.has(trackKey)) {
      b.disabled = true;
      setLabel(link.working || 'Working…');
    }
    b.addEventListener('click', async () => {
      b.disabled = true; // don't send (and process) the same clip twice
      setLabel('Opening…');
      if (trackKey) busy.add(trackKey);
      const ok = await send((status) => {
        if (status === 'processing') setLabel(link.working || 'Working…');
        else if (status === 'done') {
          setLabel(link.done || 'Done ✓');
          if (trackKey) busy.delete(trackKey);
        } else if (status === 'error') {
          if (trackKey) busy.delete(trackKey);
          b.disabled = false;
          setLabel(link.label);
        }
      });
      if (!ok) {
        // cancelled (or unavailable) — restore the button
        if (trackKey) busy.delete(trackKey);
        b.disabled = false;
        setLabel(link.label);
      }
    });
    return { el: b, setLabel };
  };

  // A result-screen button: sends the produced clip, tracked in `busy` by entry.
  const resultButton = (link: HandoffLink, entry: HandoffEntry) =>
    makeButton(link, (onStatus) => sendResult(link, entry, onStatus), keyOf(entry, link.appId));

  // An input-screen button: forwards the current clip (read fresh at click time via
  // getClip()), not busy-tracked. `sync(clip|null)` enables it when there's a clip
  // and hides it when the clip came from this link's own app. Returns { el, sync }.
  const forwardButton = (link: HandoffLink, getClip: () => HandoffClip | null) => {
    const { el: btn } = makeButton(link, (onStatus) => sendInput(link, getClip(), onStatus));
    return {
      el: btn,
      sync: (clip: HandoffClip | null): void => {
        btn.hidden = !!clip && clip.from === link.appId; // came from there → don't route back
        btn.disabled = !clip;
      },
    };
  };

  // Context-menu rows for a produced entry's links (omitting ones already in
  // flight — a menu row can't show a disabled/progress state).
  const menuItems = (entry: HandoffEntry) =>
    linksFor(entry)
      .filter((l) => !busy.has(keyOf(entry, l.appId)))
      .map((l) => ({
        label: l.label,
        icon: l.icon,
        onClick: async (): Promise<void> => {
          const key = keyOf(entry, l.appId);
          busy.add(key);
          const ok = await sendResult(l, entry, (s) => {
            if (s === 'done' || s === 'error') busy.delete(key);
          });
          if (!ok) busy.delete(key);
        },
      }));

  return {
    busy,
    keyOf,
    alreadyDone,
    linksFor,
    forwardLinks,
    sendResult,
    sendInput,
    resultButton,
    forwardButton,
    menuItems,
  };
}
