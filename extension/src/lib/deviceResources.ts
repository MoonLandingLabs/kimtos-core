// Device-capability check for model downloads (#269). Before a user downloads a multi-hundred-MB
// on-device model, we compare what the model wants against what THIS machine reports and, if the
// machine looks under-spec, warn them (and make them acknowledge it) rather than let them download
// something that will crash the tab or crawl.
//
// The detection reads what a browser actually exposes — coarse on purpose:
//  - navigator.hardwareConcurrency: logical CPU cores.
//  - navigator.deviceMemory: RAM in GB, but BUCKETED and capped at 8 (privacy), so a 32 GB machine
//    reports 8. That is fine here: our floors are <= 8, so "reports 8" always clears them; we never
//    over-warn a big machine, we just can't distinguish 8 from 64 (and don't need to).
//  - navigator.gpu: WebGPU present (much faster inference).
//  - navigator.storage.estimate(): free disk budget for the origin.
//
// evaluateModelFit is PURE (no globals) so it is unit-tested without a browser.

export interface DeviceResources {
  /** Logical CPU cores, or undefined if the browser doesn't say. */
  cores?: number;
  /** RAM in GB — bucketed and capped at 8 by the browser; undefined if unavailable. */
  ramGB?: number;
  /** Whether WebGPU is available (fast path for the bigger models). */
  webgpu: boolean;
  /** Free storage budget in GB for this origin, or undefined if unavailable. */
  storageFreeGB?: number;
}

/** The requirement fields a model declares (a structural subset of Model). */
export interface ModelReq {
  minRamGB: number;
  recRamGB: number;
  downloadMB: number;
  needsWebGPU: boolean;
  recWebGPU: boolean;
}

export type FitLevel = 'ok' | 'caution' | 'warn';

export interface FitResult {
  /** `warn`: likely to fail / be unusable — the UI gates the download behind an ack.
   *  `caution`: will work but be slower / tight — shown as advice, not a gate.
   *  `ok`: this device meets the model's needs. */
  level: FitLevel;
  /** Human-readable reasons, worst first. Empty when `ok`. */
  reasons: string[];
}

/** Read what this machine reports. Guarded so it never throws on a browser missing an API. */
export async function detectDeviceResources(): Promise<DeviceResources> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    (Navigator & { deviceMemory?: number }) | undefined;
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined;
  const ramGB = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined;
  const webgpu = !!nav && 'gpu' in nav;

  let storageFreeGB: number | undefined;
  try {
    if (nav?.storage?.estimate) {
      const { quota, usage } = await nav.storage.estimate();
      if (typeof quota === 'number') {
        storageFreeGB = Math.max(0, (quota - (usage ?? 0)) / 1e9);
      }
    }
  } catch {
    /* estimate() can reject in some contexts — leave it undefined */
  }
  return { cores, ramGB, webgpu, storageFreeGB };
}

const oneDp = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Compare a model's needs against a device. Pure — no globals, so it is unit-tested directly.
 *  A missing measurement (e.g. `ramGB` undefined on a browser that doesn't expose it) is treated
 *  as "can't tell, don't warn": we never block on absence of data, only on data that is actually
 *  below the bar. */
export function evaluateModelFit(model: ModelReq, res: DeviceResources): FitResult {
  const warns: string[] = [];
  const cautions: string[] = [];

  // RAM — the main failure mode: a model bigger than memory OOMs the tab on load.
  if (typeof res.ramGB === 'number') {
    if (res.ramGB < model.minRamGB) {
      warns.push(
        `This model needs about ${model.minRamGB} GB of RAM, but this device reports about ` +
          `${oneDp(res.ramGB)} GB. It may fail to load or crash the tab.`,
      );
    } else if (res.ramGB < model.recRamGB) {
      cautions.push(
        `This model runs best with about ${model.recRamGB} GB of RAM; this device reports about ` +
          `${oneDp(res.ramGB)} GB, so expect slower replies.`,
      );
    }
  }

  // GPU — needsWebGPU is a hard requirement; recWebGPU is a strong recommendation.
  if (!res.webgpu) {
    if (model.needsWebGPU) {
      warns.push('This model requires WebGPU (GPU acceleration), which this browser does not report.');
    } else if (model.recWebGPU) {
      cautions.push(
        'This model is much faster with a GPU (WebGPU), which this device does not report — on CPU it may be slow.',
      );
    }
  }

  // Storage — a download that doesn't fit will fail partway. Ask for the footprint plus headroom.
  if (typeof res.storageFreeGB === 'number') {
    const needGB = (model.downloadMB / 1024) * 1.2; // 20% headroom for unpacking/cache
    if (res.storageFreeGB < needGB) {
      warns.push(
        `This model needs about ${oneDp(model.downloadMB / 1024)} GB of free space, but only about ` +
          `${oneDp(res.storageFreeGB)} GB appears available.`,
      );
    }
  }

  if (warns.length) return { level: 'warn', reasons: [...warns, ...cautions] };
  if (cautions.length) return { level: 'caution', reasons: cautions };
  return { level: 'ok', reasons: [] };
}

/** A short one-line summary of the device, for the download dialog ("This device: …"). */
export function describeDevice(res: DeviceResources): string {
  const parts: string[] = [];
  if (typeof res.cores === 'number') parts.push(`${res.cores} CPU cores`);
  if (typeof res.ramGB === 'number') parts.push(`~${oneDp(res.ramGB)} GB RAM${res.ramGB >= 8 ? '+' : ''}`);
  parts.push(res.webgpu ? 'GPU (WebGPU) available' : 'no WebGPU');
  if (typeof res.storageFreeGB === 'number') parts.push(`~${oneDp(res.storageFreeGB)} GB free`);
  return parts.join(' · ');
}
