// Keeps the cleaned audio locked to the video while the clip is re-muxed.
//
// The re-mux plays the video in a <video> element and feeds the cleaned audio from an
// AudioBufferSourceNode, then re-records the pair. Those are two free-running clocks. The
// audio one never waits; the video one does: every decoder hiccup, seek, buffering pause or
// throttled tab holds the picture back while the audio keeps going. The lag is cumulative and
// nothing ever paid it back, so a long clip drifted further out of step the longer it ran —
// fine for the first few minutes, visibly wrong from about minute 25.
//
// The cleaned audio itself is sample-exact (the denoiser returns exactly as many samples as it
// was given), so the fix is not in the audio: it is to make the video the master. Whenever the
// audio position strays from the video's current time by more than a few frames, the audio is
// restarted at the video's position.

/** Beyond this the ear/eye notices (lip-sync is perceptibly off from roughly 45 ms). */
export const RESYNC_TOLERANCE_S = 0.04;

/** Where the audio source is now, in seconds into the cleaned audio. */
export function audioPosition(offset: number, startedAt: number, now: number): number {
  return offset + Math.max(0, now - startedAt);
}

/**
 * The offset to restart the audio at so it matches the video, or `null` when it is already in
 * step (within `tolerance`). Clamped to the audio length; at or past the end the caller should
 * simply let it finish.
 */
export function resyncOffset(
  videoTime: number,
  audioPos: number,
  audioDuration: number,
  tolerance: number = RESYNC_TOLERANCE_S,
): number | null {
  if (!Number.isFinite(videoTime) || !Number.isFinite(audioPos)) return null;
  if (Math.abs(audioPos - videoTime) <= tolerance) return null;
  return Math.min(Math.max(0, videoTime), audioDuration);
}
