/**
 * Pure timeline math for the tape-scrubber slider.
 *
 * The DAC-history ring is finite (≈50k events) and evicts oldest-first, so on
 * long recordings `recorded.oldestCycle` advances forward past early segments
 * whose sample data has already been overwritten.  These helpers clip the
 * retained-segment list down to the ring's live cycle range and map cycles ↔
 * the "compact" timeline axis (the inter-sound silence removed).
 *
 * Kept free of DOM / module state so they're unit-testable — see
 * `tests/scrubTimeline.test.ts`, which pins the wrapped-ring regression.
 */
import type { SoundSegment } from "./host.ts";

/** Effective end cycle of a segment; an open segment ends at `newestCycle`. */
export function segmentEnd(seg: SoundSegment, newestCycle: number): number {
  return seg.endCycle ?? Math.max(seg.startCycle, newestCycle);
}

/**
 * Clip the segment list to the cycles the ring still holds.  Drops segments
 * whose data is fully evicted (effective end before `oldestCycle`) and clips a
 * straddling segment's start up to `oldestCycle`.  After this the first
 * retained segment starts exactly at `oldestCycle`, so it maps to compact
 * offset 0 — i.e. the scrub thumb's far-left position — keeping the slider, the
 * markers, and the wall-clock readout in agreement.
 */
export function clipSegmentsToRange(
  segments: readonly SoundSegment[],
  oldestCycle: number,
  newestCycle: number,
): SoundSegment[] {
  const out: SoundSegment[] = [];
  for (const s of segments) {
    if (segmentEnd(s, newestCycle) < oldestCycle) continue; // fully evicted
    out.push(s.startCycle < oldestCycle ? { ...s, startCycle: oldestCycle } : s);
  }
  return out;
}

/** Total sound-only duration across the segments (the compact-axis length). */
export function compactDuration(segs: readonly SoundSegment[], newestCycle: number): number {
  let total = 0;
  for (const s of segs) {
    const end = segmentEnd(s, newestCycle);
    if (end > s.startCycle) total += end - s.startCycle;
  }
  return total;
}

/** Map a CPU cycle to its position on the compact axis (0..compactDuration). */
export function cycleToCompactOffset(
  cycle: number,
  segs: readonly SoundSegment[],
  newestCycle: number,
): number {
  let acc = 0;
  for (const s of segs) {
    const end = segmentEnd(s, newestCycle);
    if (end <= s.startCycle) continue;
    const dur = end - s.startCycle;
    if (cycle < s.startCycle) return acc; // gap — clamp to end of prior segment
    if (cycle <= end) return acc + (cycle - s.startCycle);
    acc += dur;
  }
  return acc; // past the last segment
}

/**
 * Position + total for the scrub readout, expressed in the *same* axis the
 * slider uses for the active timeline mode.  This is what keeps "0.0 ms" at the
 * slider's left edge: in compact mode the readout must measure sound-only
 * elapsed time (so the first sound = 0), not wall-clock from `oldestCycle`
 * (which can be hundreds of ms earlier — the pre-roll that compact mode skips).
 */
export function scrubReadout(
  mode: "compact" | "realtime",
  scrubCycle: number,
  segs: readonly SoundSegment[],
  oldestCycle: number,
  newestCycle: number,
  cpuRateHz: number,
): { posMs: number; totalMs: number } {
  const toMs = (cycles: number): number => (cycles / cpuRateHz) * 1000;
  if (mode === "compact") {
    return {
      posMs: toMs(cycleToCompactOffset(scrubCycle, segs, newestCycle)),
      totalMs: toMs(compactDuration(segs, newestCycle)),
    };
  }
  return {
    posMs: toMs(Math.max(0, scrubCycle - oldestCycle)),
    totalMs: toMs(Math.max(0, newestCycle - oldestCycle)),
  };
}

/** Inverse: map a compact-axis offset back to a CPU cycle. */
export function compactOffsetToCycle(
  offset: number,
  segs: readonly SoundSegment[],
  newestCycle: number,
): number {
  let acc = 0;
  for (const s of segs) {
    const end = segmentEnd(s, newestCycle);
    if (end <= s.startCycle) continue;
    const dur = end - s.startCycle;
    if (offset <= acc + dur) return s.startCycle + (offset - acc);
    acc += dur;
  }
  if (segs.length > 0) return segmentEnd(segs[segs.length - 1]!, newestCycle);
  return 0;
}
