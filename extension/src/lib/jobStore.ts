// A job with an identity outside the page.
//
// Every on-device job used to be a promise living in the new tab, and nothing was written until it
// RESOLVED. Close the tab 95% of the way through a three-minute Denoise run and there is nothing
// on disk: no result, and — the part that matters — no input either. The recording only ever
// existed in that page. It is gone, and it existed nowhere else (#314).
//
// For a local-first tool that is the worst possible outcome. So a job now writes itself down
// BEFORE it starts: the input blob and a record of what was being done to it. If the tab dies, the
// record outlives it, and the app can offer to pick the work back up.
//
// WHAT THIS IS NOT. It is not mid-computation resume. The engines are not chunked or
// checkpointable, so a job that died at 95% re-runs from the beginning. That is a real limitation
// and it is worth being exact about: the win here is that THE WORK IS NO LONGER UNRECOVERABLE —
// the input survives, and re-running is possible at all. Checkpointing needs the engines to become
// resumable, which is a larger change that belongs on top of this, not inside it.
//
// STORAGE. One in-flight job per app (the UI runs one at a time), keyed by app id so AnubisDB
// attributes it automatically (convention 6): the record at kv `<appId>:job`, the input blob at
// `<appId>:job-input`. No registry edit, no new collection.
import { dataStore } from './dataStore.js';

export interface JobRecord {
  /** What kind of work — the app decides the vocabulary ('denoise', 'transcribe'…). */
  kind: string;
  /** The user-facing name of the thing being worked on, for the resume prompt. */
  name: string;
  /** Whatever the app needs to re-run it. Must be JSON-serialisable. */
  params?: Record<string, unknown>;
  startedAt: number;
}

/** The store this talks to. Injectable so the behaviour can be tested without IndexedDB. */
export interface JobDb {
  kv: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: (key: string, value: unknown) => Promise<void>;
    del: (key: string) => Promise<void>;
  };
  putBlob: (key: string, blob: Blob) => Promise<void>;
  getBlob: (key: string) => Promise<Blob | undefined>;
  delBlob: (key: string) => Promise<void>;
}

const defaultDb = (): JobDb => dataStore as unknown as JobDb;

const recordKey = (appId: string): string => `${appId}:job`;
const inputKey = (appId: string): string => `${appId}:job-input`;

/**
 * Write the job down before running it.
 *
 * The ORDER is the whole point: the input blob lands first, then the record that points at it. A
 * record without its input is a resume prompt that cannot resume — a lie told to a user who has
 * just lost a recording.
 */
export async function beginJob(
  appId: string,
  job: Omit<JobRecord, 'startedAt'>,
  input: Blob,
  db: JobDb = defaultDb(),
): Promise<void> {
  await db.putBlob(inputKey(appId), input);
  await db.kv.set(recordKey(appId), { ...job, startedAt: Date.now() } satisfies JobRecord);
}

/**
 * The job finished — successfully or not — so there is nothing to recover.
 *
 * Called on BOTH paths. A failed job that leaves its record behind would greet the user with a
 * resume prompt for work that already told them it failed.
 */
export async function endJob(appId: string, db: JobDb = defaultDb()): Promise<void> {
  await db.kv.del(recordKey(appId));
  await db.delBlob(inputKey(appId));
}

/**
 * A job that was running when the page died — that is what a leftover record MEANS.
 *
 * There is no timeout and no heartbeat: a record exists only between begin and end, and the page
 * cannot both be gone and still be running. If the record is here, the tab closed mid-job.
 */
export async function pendingJob(appId: string, db: JobDb = defaultDb()): Promise<JobRecord | null> {
  const record = await db.kv.get<JobRecord>(recordKey(appId));
  if (!record) return null;
  // A record whose input is missing cannot be resumed — offering to would be a lie. Clean it up
  // and say there is nothing, rather than dangle a button that cannot work.
  const input = await db.getBlob(inputKey(appId));
  if (!input) {
    await endJob(appId, db);
    return null;
  }
  return record;
}

/** The input the pending job was working on. */
export async function pendingInput(appId: string, db: JobDb = defaultDb()): Promise<Blob | undefined> {
  return db.getBlob(inputKey(appId));
}
