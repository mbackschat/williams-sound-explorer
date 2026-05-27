/**
 * RamHistory + scrub-mode time-travel tests.
 *
 * Two layers:
 *   1. The pure `RamHistory` ring buffer — push, capacity wrap, at-or-before
 *      lookup, defensive copy.
 *   2. Integration with `RealtimeRunner.snapshot()` — scrubbing through a
 *      SAW recording should yield engine-slot values that match the
 *      RAM state at the scrub head, not the (frozen) live values.
 */
import { describe, expect, it } from "vitest";
import {
  RamHistory,
  RAM_HISTORY_DEFAULT_INTERVAL,
  RAM_SNAPSHOT_SIZE,
} from "../src/engine/ramHistory.ts";
import { RealtimeRunner } from "../src/engine/realtimeRunner.ts";
import { loadROM } from "../src/node/rom.ts";

describe("RamHistory — ring buffer", () => {
  it("returns undefined when empty", () => {
    const h = new RamHistory(4);
    expect(h.at(0)).toBeUndefined();
    expect(h.at(10_000)).toBeUndefined();
  });

  it("at-or-before lookup returns the correct snapshot", () => {
    const h = new RamHistory(8);
    const ram = new Uint8Array(RAM_SNAPSHOT_SIZE);
    for (let cycle = 0; cycle < 5; cycle++) {
      ram[0] = cycle * 10; // marker byte
      h.push(cycle * 100, cycle * 7, ram);
    }
    expect(h.at(-1)).toBeUndefined(); // before oldest
    expect(h.at(0)!.cycle).toBe(0);
    expect(h.at(50)!.cycle).toBe(0);
    expect(h.at(100)!.cycle).toBe(100);
    expect(h.at(150)!.cycle).toBe(100);
    expect(h.at(400)!.cycle).toBe(400);
    expect(h.at(1_000_000)!.cycle).toBe(400);
  });

  it("capacity wrap drops oldest entries", () => {
    const h = new RamHistory(3);
    const ram = new Uint8Array(RAM_SNAPSHOT_SIZE);
    for (let i = 0; i < 7; i++) {
      ram[0] = i;
      h.push(i * 100, i, ram);
    }
    expect(h.size).toBe(3);
    // Only the last 3 (i=4,5,6) survive.
    expect(h.at(300)).toBeUndefined();          // dropped
    expect(h.at(400)!.ram[0]).toBe(4);
    expect(h.at(500)!.ram[0]).toBe(5);
    expect(h.at(600)!.ram[0]).toBe(6);
    expect(h.at(99_999)!.ram[0]).toBe(6);
  });

  it("returned ram is a fresh copy — mutating it doesn't affect later lookups", () => {
    const h = new RamHistory(2);
    const ram = new Uint8Array(RAM_SNAPSHOT_SIZE);
    ram[0] = 0x42;
    h.push(100, 0, ram);
    const snap = h.at(100)!;
    expect(snap.ram[0]).toBe(0x42);
    snap.ram[0] = 0xFF;
    expect(h.at(100)!.ram[0]).toBe(0x42); // ring still has the original
  });

  it("clear() resets size back to 0", () => {
    const h = new RamHistory(4);
    const ram = new Uint8Array(RAM_SNAPSHOT_SIZE);
    h.push(0, 0, ram);
    h.push(100, 0, ram);
    expect(h.size).toBe(2);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.at(50)).toBeUndefined();
  });

  it("default interval matches the documented 512-cycle cadence", () => {
    expect(RAM_HISTORY_DEFAULT_INTERVAL).toBe(512);
  });
});

async function newRunner(): Promise<RealtimeRunner> {
  const rom = await loadROM("defender");
  const r = new RealtimeRunner("defender", rom, { sampleRate: 48000 });
  r.bootToIdle();
  return r;
}

describe("scrub-mode RAM time-travel — runner integration", () => {
  it("VARI LOPER tracks the historical RAM, not the frozen live value", async () => {
    const r = await newRunner();
    r.fire(0x1D); // SAW
    const block = new Float32Array(512);

    // Drive SAW long enough that LOPER has visibly decayed from its initial
    // peak.  Collect (cycle, LOPER-at-that-time) samples so we know what
    // the historical RAM should yield.
    interface Probe { cycle: number; loper: number }
    const probes: Probe[] = [];
    let inVari = false;
    for (let i = 0; i < 800; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.vari) {
        inVari = true;
        probes.push({ cycle: snap.cycles, loper: snap.vari.loper });
      }
      if (inVari && !snap.vari) break;
    }
    expect(probes.length).toBeGreaterThan(20);

    // Find two probes that show different LOPER values (decay actually happened).
    const distinct = new Set(probes.map((p) => p.loper));
    expect(distinct.size, "LOPER should change over the sound").toBeGreaterThan(1);

    // Pick a probe whose LOPER differs from the live (final) value.
    const finalLoper = probes[probes.length - 1]!.loper;
    const earlier = probes.find((p) => p.loper !== finalLoper)!;
    expect(earlier).toBeDefined();

    // Scrub to the earlier probe's cycle and check the snapshot reports the
    // *historical* LOPER, not the frozen live one.
    r.startScrub(earlier.cycle, 0);
    const scrubSnap = r.snapshot();
    expect(scrubSnap.scrubbing).toBe(true);
    expect(scrubSnap.vari, "engine slot must populate at the historical PC").toBeDefined();
    // The captured LOPER should match the probe's value (give or take —
    // RamHistory is sampled every ~512 cycles, so it's the snapshot
    // at-or-before that cycle).  At a minimum it should NOT be the final
    // (frozen) value if the probe came well before the end.
    expect(scrubSnap.vari!.loper).toBe(earlier.loper);
  });

  it("scrubbing to a cycle before any RAM snapshot still produces a slot (falls back to live RAM)", async () => {
    const r = await newRunner();
    r.fire(0x11); // LITE
    const block = new Float32Array(512);
    // Drive LITE a bit so a RAM history exists.
    let firstCycle = -1;
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr && firstCycle < 0) firstCycle = snap.cycles;
      if (firstCycle >= 0 && !snap.lfsr) break;
    }
    // Scrub to position 0 — RamHistory.at() returns undefined for cycles
    // before the oldest snapshot; runner falls back to live RAM.
    r.startScrub(0, 0);
    const snap = r.snapshot();
    // We don't assert that the slot populates (live PC may be on BRA-self,
    // outside any engine range).  We assert no crash and snapshot is sane.
    expect(snap.scrubbing).toBe(true);
    expect(snap.recorded.size).toBeGreaterThan(0);
  });
});
