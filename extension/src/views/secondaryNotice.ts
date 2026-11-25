// What a second new-tab page shows instead of running the apps a second time (#1172).
//
// Opening a new tab is not a request to duplicate a running desktop. Before single-instance, it did
// exactly that: the same app could be mounted in two pages, each with its own engines, workers and
// audio — and closing it in one could not touch the other. That is why a clip could go on playing
// somewhere the user could neither see nor stop.
//
// So this page offers the two things a user could actually want, and nothing else: go to the one
// that is running, or run them here instead. There is deliberately no "open anyway": that is the
// bug, and the whole point is that it is no longer reachable.
import { el } from '../lib/dom.js';
import type { HolderJob } from '../lib/presenceShared.js';

/** What the note says when the other tab is doing nothing but holding windows open. */
const BASE_NOTE = 'Using it here closes the apps in the other tab, including anything still playing.';

/** 'a', 'a and b', 'a, b and c' — the ordinary English list, not a comma-joined dump. */
const listOf = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** 'Video Recorder — Cleaning audio (64%)'. The percentage is omitted, not guessed, when the work
 *  cannot be measured — an invented number is the one thing a progress readout must never do. */
const describeJob = (job: HolderJob): string =>
  `${job.name} — ${job.label}${typeof job.ratio === 'number' ? ` (${Math.round(job.ratio * 100)}%)` : ''}`;

/**
 * What the other tab is doing, and what taking over costs — or '' when it is doing nothing.
 *
 * THIS IS THE POINT OF #1270. The note used to say only that taking over closes the apps "including
 * anything still playing", which is about playback: a user mid-way through a noise-reduction pass
 * was told nothing was at stake and reasonably believed it. It could not say more, because the
 * holder never reported what it was doing — see `lib/pagePresence.ts` for the channel that fixed
 * that. The decision stays the user's; what changes is that they are given the facts.
 *
 * EACH COST IS STATED ONLY WHEN IT APPLIES, exactly as `kimtManager.stopAllPrompt` does. A
 * noise-reduction pass keeps the recording it was cleaning and a speech render loses everything, so
 * the reassuring sentence is only written when it holds for EVERY job named. On a mixed set the
 * pessimistic one wins: over-warning costs a takeover the user could have made, under-warning costs
 * work they cannot get back, and only one of those is recoverable. Work that CANNOT be interrupted
 * is named as continuing rather than promised a stop that will not happen.
 *
 * Pure, and exported, so the wording is asserted directly rather than through a rendered card.
 */
export function describeHolderWork(jobs: readonly HolderJob[]): string {
  const stoppable = jobs.filter((j) => j.cancellable);
  const pinned = jobs.filter((j) => !j.cancellable);
  const parts: string[] = [];

  if (stoppable.length) {
    const one = stoppable.length === 1;
    parts.push(
      `The other tab is still working: ${listOf(stoppable.map(describeJob))}.`,
      `Taking over will stop ${one ? 'it' : 'them'}.`,
      stoppable.every((j) => j.savesOnStop)
        ? `What ${one ? 'it has' : 'they have'} already produced is kept.`
        : 'Whatever is unfinished is discarded.',
    );
  }
  if (pinned.length) parts.push(`${listOf(pinned.map((j) => j.name))} cannot be stopped and will keep running.`);

  return parts.join(' ');
}

/** The whole note: the standing sentence about windows, plus whatever the other tab is working on. */
export const noticeNote = (jobs: readonly HolderJob[]): string =>
  [BASE_NOTE, describeHolderWork(jobs)].filter(Boolean).join(' ');

export interface SecondaryNoticeOptions {
  /** Go to the page that holds the apps. Absent when we could not learn which tab that is. */
  onSwitch?: () => void;
  /** Take the apps over here — the other page releases them and stops whatever it was running. */
  onTakeOver: () => void;
  /**
   * Watch what the holder is working on, so the note can name it. Absent where there is no channel
   * to read (`vite dev` has no extension APIs), and the note falls back to the standing sentence.
   *
   * A subscription rather than a snapshot: the notice can sit on screen for minutes, and both
   * transitions matter — work that finishes while it is up would leave a warning about nothing, and
   * work that starts afterwards would not be warned about at all.
   *
   * The contract is "call me with the list NOW, and again whenever it changes"; the note is drawn
   * with the standing sentence until the first call arrives.
   */
  watchWork?: (onWork: (jobs: readonly HolderJob[]) => void) => () => void;
}

/**
 * Fill `host` with the choice. Returns a teardown that empties it again, which is what the takeover
 * path calls once this page has won.
 */
export function renderSecondaryNotice(
  host: HTMLElement,
  { onSwitch, onTakeOver, watchWork }: SecondaryNoticeOptions,
): () => void {
  host.className = 'secondary-overlay';

  const card = el('div', 'secondary-card');
  card.append(
    el('h1', 'secondary-title', 'Kimtos is already open in another tab'),
    el(
      'p',
      'secondary-lead',
      'Your apps run in one tab at a time, so a recording or a playing clip can never end up somewhere you cannot reach it.',
    ),
  );

  const actions = el('div', 'secondary-actions');
  if (onSwitch) {
    const go = el('button', 'button-primary', 'Switch to it');
    go.type = 'button';
    go.addEventListener('click', onSwitch);
    actions.append(go);
  }

  const here = el('button', onSwitch ? 'button-secondary' : 'button-primary', 'Use here instead');
  here.type = 'button';
  here.addEventListener('click', onTakeOver);
  actions.append(here);

  card.append(actions);
  const note = el('p', 'secondary-note', noticeNote([]));
  card.append(note);

  // Only the note's own text is rewritten when the holder's work changes — never the card around
  // it. Rebuilding an ancestor of the focused button would take focus off the control the user was
  // about to press, on a page that offers them nothing else.
  const unwatch = watchWork?.((jobs) => {
    note.textContent = noticeNote(jobs);
  });

  host.replaceChildren(card);
  host.hidden = false;
  // Focus lands somewhere useful for a keyboard user, and this is a full-page decision.
  (actions.firstElementChild as HTMLButtonElement | null)?.focus();

  return () => {
    unwatch?.();
    host.replaceChildren();
    host.hidden = true;
    host.className = '';
  };
}
