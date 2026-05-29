/**
 * Headless helper for the Explore-mode Fire button's "sounding now" hint.
 *
 * The realtime driver keeps the trailing {@link SoundSegment} open
 * (`endCycle === null`) while DAC output is active and closes it ~50 ms after
 * the routine goes idle (see `realtimeRunner.ts`).  So a live sound is playing
 * iff the newest segment is still open.  Scrubbing replays *past* audio rather
 * than a fresh fire, so it never lights the Fire button.
 */
import type { SoundSegment } from "./realtimeRunner.ts";

export function liveSoundActive(segments: readonly SoundSegment[], scrubbing: boolean): boolean {
  if (scrubbing || segments.length === 0) return false;
  return segments[segments.length - 1]!.endCycle === null;
}
