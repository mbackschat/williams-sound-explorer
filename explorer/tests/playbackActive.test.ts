import { describe, it, expect } from "vitest";
import { liveSoundActive } from "../src/engine/playbackActive.ts";
import type { SoundSegment } from "../src/engine/realtimeRunner.ts";

const seg = (startCycle: number, endCycle: number | null): SoundSegment => ({
  cmd: 0x11,
  startCycle,
  endCycle,
});

describe("liveSoundActive — Fire-button 'sounding now' hint", () => {
  it("is true when the trailing segment is still open (endCycle null)", () => {
    expect(liveSoundActive([seg(0, 1000), seg(2000, null)], false)).toBe(true);
  });

  it("is false when the trailing segment is closed (idle reached)", () => {
    expect(liveSoundActive([seg(0, 1000), seg(2000, 3000)], false)).toBe(false);
  });

  it("is false with no segments at all", () => {
    expect(liveSoundActive([], false)).toBe(false);
  });

  it("is false while scrubbing, even with an open trailing segment", () => {
    // Scrubbing replays past audio, not a live fire — the Fire button isn't 'firing'.
    expect(liveSoundActive([seg(2000, null)], true)).toBe(false);
  });

  it("looks only at the LAST segment (an earlier open one doesn't count)", () => {
    // Defensive: the driver never leaves a non-trailing segment open, but the
    // hint must track the newest fire, not a stale earlier one.
    expect(liveSoundActive([seg(0, null), seg(2000, 3000)], false)).toBe(false);
  });
});
