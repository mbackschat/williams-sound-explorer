/**
 * DacHistory (DAC event ring buffer) tests.
 *
 * Covers: empty-buffer behaviour, sequential push, capacity wrap, binary
 * search lookups before/at/after the recorded range, clear, large bursts
 * that overwrite many old entries.
 */
import { describe, expect, it } from "vitest";
import { DacHistory, DAC_SILENCE } from "../src/engine/dacHistory.ts";

describe("DacHistory — empty buffer", () => {
  it("range() returns zeros when nothing has been pushed", () => {
    const h = new DacHistory(8);
    const r = h.range();
    expect(r.size).toBe(0);
    expect(r.oldestCycle).toBe(0);
    expect(r.newestCycle).toBe(0);
  });

  it("valueAt() returns DAC silence ($80) for any query", () => {
    const h = new DacHistory(8);
    expect(h.valueAt(0)).toBe(DAC_SILENCE);
    expect(h.valueAt(1_000_000)).toBe(DAC_SILENCE);
  });

  it("rejects capacity <= 0", () => {
    expect(() => new DacHistory(0)).toThrow();
    expect(() => new DacHistory(-1)).toThrow();
  });
});

describe("DacHistory — without wrap (size < capacity)", () => {
  it("range() reports oldest = first push, newest = last push", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    h.push(300, 0x30);
    const r = h.range();
    expect(r.size).toBe(3);
    expect(r.oldestCycle).toBe(100);
    expect(r.newestCycle).toBe(300);
  });

  it("valueAt() returns DAC silence for cycles before the oldest event", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    expect(h.valueAt(50)).toBe(DAC_SILENCE);
    expect(h.valueAt(99)).toBe(DAC_SILENCE);
  });

  it("valueAt() returns the event byte at an exact cycle match", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    h.push(300, 0x30);
    expect(h.valueAt(100)).toBe(0x10);
    expect(h.valueAt(200)).toBe(0x20);
    expect(h.valueAt(300)).toBe(0x30);
  });

  it("valueAt() returns the previous event byte for cycles between events (ZOH)", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    h.push(300, 0x30);
    expect(h.valueAt(150)).toBe(0x10);
    expect(h.valueAt(199)).toBe(0x10);
    expect(h.valueAt(250)).toBe(0x20);
    expect(h.valueAt(299)).toBe(0x20);
  });

  it("valueAt() returns the newest event byte for cycles after the last event", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    expect(h.valueAt(500)).toBe(0x20);
    expect(h.valueAt(1_000_000)).toBe(0x20);
  });
});

describe("DacHistory — with wrap (size == capacity)", () => {
  it("after wrap, oldestCycle is the first un-overwritten event", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i * 0x10);
    const r = h.range();
    expect(r.size).toBe(4);
    expect(r.oldestCycle).toBe(300); // events 1 & 2 were overwritten
    expect(r.newestCycle).toBe(600);
  });

  it("after wrap, valueAt() at the oldest still-recorded cycle returns its byte", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i * 0x10);
    expect(h.valueAt(300)).toBe(0x30);
    expect(h.valueAt(400)).toBe(0x40);
    expect(h.valueAt(500)).toBe(0x50);
    expect(h.valueAt(600)).toBe(0x60);
  });

  it("after wrap, valueAt() before the oldest still-recorded cycle returns DAC silence", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i * 0x10);
    // 100 and 200 were overwritten; queries before 300 should be silent.
    expect(h.valueAt(50)).toBe(DAC_SILENCE);
    expect(h.valueAt(200)).toBe(DAC_SILENCE);
    expect(h.valueAt(299)).toBe(DAC_SILENCE);
  });

  it("ZOH still works correctly across the wrap point", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i * 0x10);
    expect(h.valueAt(350)).toBe(0x30);
    expect(h.valueAt(450)).toBe(0x40);
    expect(h.valueAt(550)).toBe(0x50);
    expect(h.valueAt(650)).toBe(0x60);
  });
});

describe("DacHistory — clear()", () => {
  it("returns the buffer to the empty state", () => {
    const h = new DacHistory(8);
    h.push(100, 0x10);
    h.push(200, 0x20);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.range().size).toBe(0);
    expect(h.valueAt(150)).toBe(DAC_SILENCE);
  });

  it("can be re-used after clear()", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i);
    h.clear();
    h.push(1000, 0xAA);
    expect(h.range().oldestCycle).toBe(1000);
    expect(h.range().newestCycle).toBe(1000);
    expect(h.valueAt(1000)).toBe(0xAA);
  });
});

describe("DacHistory — eventsInRange", () => {
  it("returns events whose cycle falls inside [start, end]", () => {
    const h = new DacHistory(16);
    for (let i = 1; i <= 8; i++) h.push(i * 100, i * 0x10);
    const r = h.eventsInRange(250, 550);
    expect(r.count).toBe(3);
    expect(Array.from(r.cycles)).toEqual([300, 400, 500]);
    expect(Array.from(r.values)).toEqual([0x30, 0x40, 0x50]);
  });

  it("handles a query before any event (returns empty)", () => {
    const h = new DacHistory(16);
    for (let i = 1; i <= 4; i++) h.push(i * 100, i);
    const r = h.eventsInRange(0, 50);
    expect(r.count).toBe(0);
  });

  it("handles a query past every event (returns empty)", () => {
    const h = new DacHistory(16);
    for (let i = 1; i <= 4; i++) h.push(i * 100, i);
    const r = h.eventsInRange(10000, 20000);
    expect(r.count).toBe(0);
  });

  it("caps to maxCount, keeping the newest events", () => {
    const h = new DacHistory(16);
    for (let i = 1; i <= 10; i++) h.push(i * 100, i);
    const r = h.eventsInRange(0, 100000, 3);
    expect(r.count).toBe(3);
    // Newest 3 in range = cycles 800, 900, 1000
    expect(Array.from(r.cycles)).toEqual([800, 900, 1000]);
  });

  it("works correctly after the ring has wrapped", () => {
    const h = new DacHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i * 100, i);
    // After wrap, surviving events are cycles 300..600.
    const r = h.eventsInRange(0, 1000);
    expect(r.count).toBe(4);
    expect(Array.from(r.cycles)).toEqual([300, 400, 500, 600]);
  });
});

describe("DacHistory — large bursts", () => {
  it("handles N = 10 * capacity pushes without losing the latest values", () => {
    const h = new DacHistory(100);
    for (let i = 0; i < 1000; i++) h.push(i + 1, i & 0xFF);
    const r = h.range();
    expect(r.size).toBe(100);
    expect(r.newestCycle).toBe(1000);
    expect(h.valueAt(1000)).toBe(999 & 0xFF);
    expect(h.valueAt(901)).toBe(900 & 0xFF);
  });

  it("binary search remains O(log n) — 10k push + 10k lookups completes fast", () => {
    const h = new DacHistory(10_000);
    for (let i = 0; i < 10_000; i++) h.push(i * 7 + 13, i & 0xFF);
    // Sanity check on lookups, not timing — but the lookup loop should
    // finish near-instantly even at this size.
    for (let i = 0; i < 10_000; i++) {
      const target = i * 7 + 13;
      expect(h.valueAt(target)).toBe(i & 0xFF);
    }
  });
});
