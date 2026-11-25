// One app handing data to another (e.g. a recording → Denoise → Voice to Text).
// The sender stashes a payload under the target app's id and opens that app; the
// target picks it up once on render. Kept on-device — it's just an in-memory baton.
//
//   sender:   const job = setHandoff('denoise', { blob, filename }, onStatus);
//             ctx.openApp('denoise');
//   receiver: const job = takeHandoff('denoise'); if (job) prefill(job);
//             ... later, when it runs: reportHandoff(job.jobId, 'done');
//
// `onStatus` lets the sender follow the job across apps ('processing' when the
// target starts working, then 'done' / 'error') so its button can reflect it.

export type HandoffStatus = 'processing' | 'done' | 'error';
export type HandoffPayload = Record<string, unknown> & { jobId: string };

const pending = new Map<string, HandoffPayload>(); // appId -> payload (incl. jobId)
const statusListeners = new Map<string, (status: HandoffStatus) => void>(); // jobId -> fn
let seq = 0;

export function setHandoff(
  appId: string,
  data: Record<string, unknown>,
  onStatus?: (status: HandoffStatus) => void,
): string {
  const jobId = `h${(seq += 1)}`;
  pending.set(appId, { ...data, jobId });
  if (onStatus) statusListeners.set(jobId, onStatus);
  return jobId;
}

// Returns the payload once, then clears it (so it doesn't re-fire on re-render).
export function takeHandoff(appId: string): HandoffPayload | null {
  const data = pending.get(appId) ?? null;
  pending.delete(appId);
  return data;
}

// Report a handed-off job's progress back to the sender. Terminal states drop
// the listener.
export function reportHandoff(jobId: string | undefined, status: HandoffStatus): void {
  if (!jobId) return;
  statusListeners.get(jobId)?.(status);
  if (status === 'done' || status === 'error') statusListeners.delete(jobId);
}
