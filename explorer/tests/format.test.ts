/**
 * Pure UI formatting / metering helpers (`src/web/format.ts`).
 *
 * These were previously buried in the `main.ts` god-module (untested, since
 * `main.ts` touches `document` at load and never runs under Node).  Extracting
 * them made them testable — this file is the new coverage.
 */
import { describe, expect, it } from "vitest";

import { dbToPct, meterTrack, escapeHtml } from "../src/web/format.ts";

describe("dbToPct", () => {
  it("maps 0 dBFS to a full meter and the −60 dB floor to empty", () => {
    expect(dbToPct(0)).toBe(100);
    expect(dbToPct(-60)).toBe(0);
    expect(dbToPct(-30)).toBeCloseTo(50, 6);
  });

  it("clamps out-of-range input to [0, 100]", () => {
    expect(dbToPct(10)).toBe(100); // above 0 dBFS
    expect(dbToPct(-90)).toBe(0); // below the floor
  });

  it("treats non-finite (silence) as empty", () => {
    expect(dbToPct(-Infinity)).toBe(0);
    expect(dbToPct(NaN)).toBe(0);
  });
});

describe("meterTrack", () => {
  it("attacks instantly when the signal is louder than the current reading", () => {
    expect(meterTrack(-40, -10, 3)).toBe(-10);
    expect(meterTrack(-Infinity, -20, 3)).toBe(-20); // first signal after silence
  });

  it("releases toward the floor by releaseDb while the signal is silent", () => {
    expect(meterTrack(-10, -Infinity, 3)).toBe(-13);
    expect(meterTrack(-13, -Infinity, 0.75)).toBeCloseTo(-13.75, 6);
  });

  it("snaps to −Infinity once the decaying reading reaches the floor", () => {
    expect(meterTrack(-59, -Infinity, 3)).toBe(-Infinity); // −62 ≤ −60 floor
    expect(meterTrack(-Infinity, -Infinity, 3)).toBe(-Infinity); // already silent
  });

  it("decays toward a quieter live signal but never below it", () => {
    expect(meterTrack(-10, -20, 3)).toBe(-13); // max(-20, -13)
    expect(meterTrack(-10, -12, 3)).toBe(-12); // max(-12, -13) — clamped at the signal
  });
});

describe("escapeHtml", () => {
  it("escapes the four HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;",
    );
  });

  it("leaves single quotes and ordinary text untouched", () => {
    expect(escapeHtml("it's a LFSR — fine")).toBe("it's a LFSR — fine");
    expect(escapeHtml("")).toBe("");
  });
});
