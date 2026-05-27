/**
 * Pattern 5 / Step 6.2 — paramOverride tests.
 *
 * Two layers:
 *   1. Pure bus test: SoundBoard.write() respects paramOverrides (override
 *      wins over CPU value, and over the Pattern 3 freeze toggles).
 *   2. Runner integration: forcing LOPER mid-SAW makes the VARI slot
 *      report the forced value AND keeps it pinned across CPU writes.
 */
import { describe, expect, it } from "vitest";

import { RealtimeRunner } from "../src/audio/realtimeRunner.ts";
import { SoundBoard } from "../src/board/soundboard.ts";
import { loadROM } from "../src/board/rom.ts";

describe("paramOverride — SoundBoard.write()", () => {
  it("override forces the value the CPU tries to write", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    board.paramOverrides.set(0x13, 0x80);
    board.write(0x13, 0x42);
    expect(board.read(0x13)).toBe(0x80);
  });

  it("clearing the override lets normal writes through again", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    board.paramOverrides.set(0x13, 0x80);
    board.write(0x13, 0x42);
    expect(board.read(0x13)).toBe(0x80);
    board.paramOverrides.delete(0x13);
    board.write(0x13, 0x42);
    expect(board.read(0x13)).toBe(0x42);
  });

  it("override beats engine-toggle freeze (rewrite wins over discard)", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    board.toggles.variFreezePeriod = true;     // would otherwise drop $13 writes
    board.paramOverrides.set(0x13, 0x55);      // but override takes priority
    board.write(0x13, 0x99);
    expect(board.read(0x13)).toBe(0x55);
  });

  it("overrides only intercept their target cell, not neighbours", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    board.paramOverrides.set(0x13, 0x80);
    board.write(0x14, 0x42); // HIPER, not in the override set
    expect(board.read(0x14)).toBe(0x42);
  });
});

describe("paramOverride — RealtimeRunner.setParamOverride()", () => {
  async function newRunner(): Promise<RealtimeRunner> {
    const rom = await loadROM("defender");
    const r = new RealtimeRunner("defender", rom, { sampleRate: 48000 });
    r.bootToIdle();
    return r;
  }

  it("setting an override stomps the live RAM cell immediately", async () => {
    const r = await newRunner();
    r.setParamOverride(0x13, 0x80);
    expect(r.board.read(0x13)).toBe(0x80);
  });

  it("clearing an override removes it from the map", async () => {
    const r = await newRunner();
    r.setParamOverride(0x13, 0x80);
    expect(r.board.paramOverrides.has(0x13)).toBe(true);
    r.setParamOverride(0x13, null);
    expect(r.board.paramOverrides.has(0x13)).toBe(false);
  });

  it("VARI's LOPER stays pinned when overridden mid-SAW", async () => {
    const r = await newRunner();
    r.fire(0x1D); // SAW
    const block = new Float32Array(256);

    // Run a few blocks so the VARI inner loop is active.
    let firstSnap: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 200; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.vari) {
        firstSnap = s;
        break;
      }
    }
    expect(firstSnap?.vari).toBeDefined();

    // Force LOPER to a recognisable value and drive a chunk.  The CPU
    // would normally walk LOPER through a decaying sequence; with the
    // override pinned, every snapshot should report exactly $80.
    r.setParamOverride(0x13, 0x80);
    for (let i = 0; i < 50; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.vari) {
        expect(s.vari.loper).toBe(0x80);
      }
    }
  });

  it("releasing the override lets LOPER drift again", async () => {
    const r = await newRunner();
    r.fire(0x1D);
    const block = new Float32Array(256);
    for (let i = 0; i < 200; i++) { r.fillBlock(block); if (r.snapshot().vari) break; }

    r.setParamOverride(0x13, 0x80);
    for (let i = 0; i < 30; i++) r.fillBlock(block);
    r.setParamOverride(0x13, null);

    // After releasing, LOPER should change again as VSWEEP runs.
    const baseline = r.board.read(0x13);
    let drifted = false;
    for (let i = 0; i < 200 && !drifted; i++) {
      r.fillBlock(block);
      if (r.board.read(0x13) !== baseline) drifted = true;
    }
    expect(drifted).toBe(true);
  });
});
