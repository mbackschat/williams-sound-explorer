/**
 * Tape-scrubber timeline math (`src/engine/scrubTimeline.ts`).
 *
 * Regression focus: the DAC-history ring is finite and evicts oldest-first, so
 * on long recordings `oldestCycle` advances past early segments whose sample
 * data is gone.  If those phantom segments aren't clipped out, they keep
 * rendering markers and shift the compact-timeline origin, stranding the scrub
 * thumb mid-track while the readout reads "0.0 ms" (the bug reported 2026-05).
 */
import { describe, expect, it } from "vitest";

import type { SoundSegment } from "../src/data/protocol.ts";
import {
  clipSegmentsToRange,
  compactDuration,
  cycleToCompactOffset,
  compactOffsetToCycle,
  scrubReadout,
  segmentEnd,
} from "../src/engine/scrubTimeline.ts";

const seg = (cmd: number, startCycle: number, endCycle: number | null): SoundSegment =>
  ({ cmd, startCycle, endCycle });

describe("segmentEnd", () => {
  it("returns endCycle for a closed segment", () => {
    expect(segmentEnd(seg(1, 100, 500), 9999)).toBe(500);
  });
  it("falls back to newestCycle for an open segment", () => {
    expect(segmentEnd(seg(1, 100, null), 800)).toBe(800);
  });
  it("never reports an open segment ending before it started", () => {
    expect(segmentEnd(seg(1, 1000, null), 200)).toBe(1000);
  });
});

describe("clipSegmentsToRange", () => {
  it("leaves segments fully inside the range untouched (same objects)", () => {
    const segs = [seg(1, 100, 300), seg(2, 400, 600)];
    const out = clipSegmentsToRange(segs, 0, 1000);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(segs[0]);
    expect(out[1]).toBe(segs[1]);
  });

  it("drops segments whose data was fully evicted (end < oldestCycle)", () => {
    const segs = [seg(5, 1000, 3000), seg(6, 4000, 6000), seg(7, 15000, 18000)];
    const out = clipSegmentsToRange(segs, 10000, 20000);
    expect(out.map((s) => s.cmd)).toEqual([7]);
  });

  it("clips a straddling segment's start up to oldestCycle", () => {
    const segs = [seg(7, 8000, 12000)];
    const out = clipSegmentsToRange(segs, 10000, 20000);
    expect(out).toHaveLength(1);
    expect(out[0]!.startCycle).toBe(10000);
    expect(out[0]!.endCycle).toBe(12000);
    expect(out[0]).not.toBe(segs[0]); // clipped → fresh object, original untouched
    expect(segs[0]!.startCycle).toBe(8000);
  });

  it("keeps an open segment whose effective end is in range", () => {
    const segs = [seg(1, 9000, null)];
    const out = clipSegmentsToRange(segs, 10000, 20000);
    expect(out).toHaveLength(1);
    expect(out[0]!.startCycle).toBe(10000);
    expect(out[0]!.endCycle).toBeNull();
  });

  it("returns empty for empty input and for all-evicted input", () => {
    expect(clipSegmentsToRange([], 0, 100)).toEqual([]);
    expect(clipSegmentsToRange([seg(1, 0, 50)], 100, 200)).toEqual([]);
  });
});

describe("compactDuration", () => {
  it("sums sound-only durations (silence excluded)", () => {
    const segs = [seg(1, 0, 200), seg(2, 1000, 1300)];
    expect(compactDuration(segs, 2000)).toBe(200 + 300);
  });
  it("uses newestCycle for an open segment", () => {
    expect(compactDuration([seg(1, 100, null)], 600)).toBe(500);
  });
});

describe("cycleToCompactOffset / compactOffsetToCycle", () => {
  const segs = [seg(1, 0, 200), seg(2, 1000, 1300)];

  it("a cycle in the leading silence maps to offset 0", () => {
    expect(cycleToCompactOffset(0, segs, 2000)).toBe(0);
  });
  it("a cycle inside the first segment maps to its in-segment offset", () => {
    expect(cycleToCompactOffset(150, segs, 2000)).toBe(150);
  });
  it("a cycle in the gap clamps to the end of the prior segment", () => {
    expect(cycleToCompactOffset(700, segs, 2000)).toBe(200);
  });
  it("a cycle inside the second segment accumulates prior durations", () => {
    expect(cycleToCompactOffset(1100, segs, 2000)).toBe(200 + 100);
  });
  it("round-trips offset → cycle → offset for in-range positions", () => {
    for (const off of [0, 50, 200, 250, 500]) {
      const c = compactOffsetToCycle(off, segs, 2000);
      expect(cycleToCompactOffset(c, segs, 2000)).toBe(off);
    }
  });

  it("REGRESSION (compact readout): leftmost sound reads 0.0 ms even with pre-roll before it", () => {
    // The ring's oldest cycle is 0, but the first *fired segment* starts 4474
    // cycles later (≈ 450 ms of pre-roll the compact axis skips — the bug:
    // the readout showed 450.6 ms at the slider's left edge).
    const rate = 894_886; // CPU_RATE_HZ
    const segs = [seg(0x03, 4474, 8000), seg(0x0b, 12000, 16000)];
    const oldest = 0;
    const newest = 20000;

    // Compact: the first sound's start is the slider's left edge → 0.0 ms.
    const compact = scrubReadout("compact", segs[0]!.startCycle, segs, oldest, newest, rate);
    expect(compact.posMs).toBeCloseTo(0, 5);
    expect(compact.totalMs).toBeCloseTo(((3526 + 4000) / rate) * 1000, 5); // sound-only

    // Realtime: same head reads its wall-clock offset from oldestCycle (~5 ms).
    const realtime = scrubReadout("realtime", segs[0]!.startCycle, segs, oldest, newest, rate);
    expect(realtime.posMs).toBeCloseTo((4474 / rate) * 1000, 5);
    expect(realtime.totalMs).toBeCloseTo((20000 / rate) * 1000, 5);
  });

  it("REGRESSION: after clipping a wrapped ring, oldestCycle maps to offset 0", () => {
    // Simulate the reported bug: 4 sounds, but the ring only still holds data
    // from cycle 10000 onward (the first two sounds were evicted, the third
    // straddles the boundary).
    const recorded = [
      seg(0x05, 1000, 3000),   // evicted
      seg(0x06, 4000, 6000),   // evicted
      seg(0x07, 8000, 12000),  // straddles oldest
      seg(0x1d, 15000, 18000), // retained
    ];
    const oldest = 10000;
    const newest = 20000;

    // Without clipping the origin is wrong — oldestCycle lands mid-track.
    expect(cycleToCompactOffset(oldest, recorded, newest)).toBeGreaterThan(0);

    // With clipping it lands at the far left, matching the "0.0 ms" readout.
    const clipped = clipSegmentsToRange(recorded, oldest, newest);
    expect(cycleToCompactOffset(oldest, clipped, newest)).toBe(0);
    expect(clipped.map((s) => s.cmd)).toEqual([0x07, 0x1d]);
  });
});
