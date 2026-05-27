/**
 * RAM-heatmap data-source tests (Step 6.6).
 *
 * Covers the model-side instrumentation only — the visual rendering of the
 * heatmap is canvas pixels and not unit-tested.  The relevant invariants:
 *
 *   1. `SoundBoard.write()` stamps `lastWriteCycle[addr]` with the CPU's
 *      current cycle on every successful write (both kinds — direct + Pattern
 *      5 override).
 *   2. Pattern 3 freeze toggles suppress both the value write AND the
 *      timestamp — a cell that hasn't actually changed should not appear
 *      hot in the heatmap.
 *   3. `RealtimeRunner.snapshot()` exposes a fresh `ramSnapshot` + matching
 *      `ramLastWrite` array.  The host's edits to the returned arrays must
 *      not mutate the runner's internals.
 */
import { describe, expect, it } from "vitest";

import { SoundBoard } from "../src/board/soundboard.ts";
import { createCPU } from "../src/cpu/m6800.ts";
import { RealtimeRunner } from "../src/engine/realtimeRunner.ts";
import { loadROM } from "../src/node/rom.ts";

describe("SoundBoard.lastWriteCycle — Step 6.6 stamp behaviour", () => {
  it("a fresh board reports every cell as never-written (cycle = 0)", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    for (let i = 0; i < 0x80; i++) {
      expect(board.lastWriteCycle[i]).toBe(0);
    }
  });

  it("write() stamps the addr with cpu.cycles", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    const cpu = createCPU();
    board.cpu = cpu;
    cpu.cycles = 12345;
    board.write(0x42, 0x99);
    expect(board.ram[0x42]).toBe(0x99);
    expect(board.lastWriteCycle[0x42]).toBe(12345);
    // Neighbours untouched.
    expect(board.lastWriteCycle[0x41]).toBe(0);
    expect(board.lastWriteCycle[0x43]).toBe(0);
  });

  it("each successive write updates the stamp to the latest cycle", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    const cpu = createCPU();
    board.cpu = cpu;
    cpu.cycles = 100;
    board.write(0x10, 0x55);
    cpu.cycles = 500;
    board.write(0x10, 0x66);
    expect(board.lastWriteCycle[0x10]).toBe(500);
  });

  it("Pattern 3 freeze (variFreezePeriod) suppresses both value AND stamp", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    const cpu = createCPU();
    board.cpu = cpu;
    board.toggles.variFreezePeriod = true;
    cpu.cycles = 4242;
    board.write(0x13, 0x77);
    expect(board.ram[0x13]).toBe(0);
    expect(board.lastWriteCycle[0x13]).toBe(0);
  });

  it("Pattern 5 override stamps the cell — overrides are active rewrites", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    const cpu = createCPU();
    board.cpu = cpu;
    board.paramOverrides.set(0x13, 0x80);
    cpu.cycles = 999;
    board.write(0x13, 0x42);
    expect(board.ram[0x13]).toBe(0x80);
    expect(board.lastWriteCycle[0x13]).toBe(999);
  });
});

describe("RealtimeRunner.snapshot — RAM payload (Step 6.6)", () => {
  it("ramSnapshot is 128 bytes and matches live RAM in idle state", async () => {
    const rom = await loadROM("defender");
    const r = new RealtimeRunner("defender", rom, { sampleRate: 48000 });
    r.bootToIdle();
    const s = r.snapshot();
    expect(s.ramSnapshot.length).toBe(128);
    expect(s.ramLastWrite.length).toBe(128);
    for (let i = 0; i < 128; i++) {
      expect(s.ramSnapshot[i]).toBe(r.board.ram[i]);
    }
  });

  it("snapshot's ramSnapshot is a fresh copy — host edits can't poison the runner", async () => {
    const rom = await loadROM("defender");
    const r = new RealtimeRunner("defender", rom, { sampleRate: 48000 });
    r.bootToIdle();
    const before = r.board.ram[0x10];
    const s = r.snapshot();
    s.ramSnapshot[0x10] = 0xAB;
    expect(r.board.ram[0x10]).toBe(before);
  });

  it("firing a sound bumps lastWriteCycle for the cells the engine touches", async () => {
    const rom = await loadROM("defender");
    const r = new RealtimeRunner("defender", rom, { sampleRate: 48000 });
    r.bootToIdle();
    // Snapshot pre-fire — most stamps zero.
    const pre = r.snapshot();
    const preNonZero = Array.from(pre.ramLastWrite).filter((c) => c > 0).length;
    r.fire(0x11); // LITE
    const block = new Float32Array(256);
    for (let i = 0; i < 30; i++) r.fillBlock(block);
    const post = r.snapshot();
    const postNonZero = Array.from(post.ramLastWrite).filter((c) => c > 0).length;
    // LITE updates LO/HI ($09/$0A), LFREQ ($19), CYCNT ($15), among others.
    expect(postNonZero).toBeGreaterThan(preNonZero);
    // At least one of the LFSR cells is recently-stamped.
    const hottestAddr = Array.from(post.ramLastWrite)
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c > 0)
      .sort((a, b) => b.c - a.c)[0]!;
    expect([0x09, 0x0A, 0x15, 0x19]).toContain(hottestAddr.i);
  });
});
