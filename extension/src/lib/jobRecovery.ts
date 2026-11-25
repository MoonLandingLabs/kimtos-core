// The offer you get when a job died with the tab: "your file is still here — resume, or discard".
//
// It lives here rather than in an app because every engine app needs exactly the same thing, and
// the first one to need it (Denoise, #314) grew it inline. A second copy in the media-text factory
// would have been the third hand-maintained version of one behaviour, which is how this codebase
// has been bitten before.
//
// What it is careful about: it only appears when there is an input to resume FROM. `pendingJob`
// sweeps a record whose blob has gone missing, so a button that cannot do what it says never
// reaches the user — they have just lost a recording; a dead button is not what they need.
import { el } from './dom.js';
import { endJob, pendingInput, pendingJob } from './jobStore.js';

export interface ResumeOptions {
  /** Re-run the job on the recovered input. */
  onResume: (input: Blob, name: string) => void;
  /** What the work was, in the user's words: "processing", "transcribing"… */
  verb?: string;
}

/**
 * Show the resume offer, if a job was interrupted. Does nothing when there is none.
 *
 * The copy says the job RESTARTS. The engines are not checkpointable, so a recovered job re-runs
 * from the beginning — telling the user it "resumes" would imply we kept the 95% they had already
 * paid for, which we did not (#314).
 */
export async function mountResumeBanner(appId: string, host: HTMLElement, opts: ResumeOptions): Promise<void> {
  const unfinished = await pendingJob(appId);
  if (!unfinished) return;
  const input = await pendingInput(appId);
  if (!input) return; // pendingJob already swept a record with no input

  const verb = opts.verb ?? 'being processed';
  const banner = el('div', 'app-tip');
  banner.append(
    el(
      'p',
      'app-tip-text',
      `“${unfinished.name}” was still ${verb} when the tab closed. The file was kept — ` +
        `it will start again from the beginning.`,
    ),
  );

  const resume = el('button', 'app-tip-ok', 'Resume');
  resume.type = 'button';
  resume.addEventListener('click', () => {
    banner.remove();
    opts.onResume(input, unfinished.name);
  });

  const discard = el('button', 'button-secondary', 'Discard');
  discard.type = 'button';
  discard.addEventListener('click', () => {
    void endJob(appId); // the user let it go — do not offer it again tomorrow
    banner.remove();
  });

  banner.append(resume, discard);
  host.prepend(banner);
}
