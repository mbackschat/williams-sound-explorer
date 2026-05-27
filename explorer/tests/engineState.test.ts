/**
 * Engine-state populator tests (Step 4.1).
 *
 * Verifies that:
 *   1. While the CPU sits in the BRA-self idle loop (no sound), no engine
 *      slot is populated on the snapshot.
 *   2. Firing LITE on Defender produces a snapshot with `lfsr` populated as
 *      soon as the CPU enters the LITE address range.
 *   3. The reported `lfsr.state` matches what `HI:LO` actually contain in
 *      zero-page RAM at the moment of inspection.
 *   4. The same wiring fires on Stargate (same VSNDRM1-style addresses).
 *   5. Once the CPU returns to the BRA-self idle, the slot is gone again —
 *      the dispatch is by current PC, not "ever ran".
 *   6. The pure `engineStateForPc` function is callable in isolation
 *      (no runner required) for downstream consumers.
 */
import { describe, expect, it } from "vitest";

import { RealtimeRunner } from "../src/engine/realtimeRunner.ts";
import { engineStateForPc } from "../src/engine/engineState.ts";
import { SoundBoard } from "../src/board/soundboard.ts";
import { loadROM } from "../src/node/rom.ts";

const SAMPLE_RATE = 48000;
const LITE = 0x11;

async function newRunner(game: "defender" | "stargate" | "robotron" = "defender"): Promise<RealtimeRunner> {
  const rom = await loadROM(game);
  const r = new RealtimeRunner(game, rom, { sampleRate: SAMPLE_RATE });
  r.bootToIdle();
  return r;
}

describe("engineStateForPc — idle CPU", () => {
  it("no engine slot is set when sitting in BRA-self", async () => {
    const r = await newRunner();
    const snap = r.snapshot();
    expect(snap.lfsr).toBeUndefined();
  });
});

describe("engineStateForPc — LITE fire (Defender)", () => {
  it("populates lfsr once execution enters the LITE block", async () => {
    const r = await newRunner();
    r.fire(LITE);

    // Drive the CPU until the snapshot reports lfsr populated.  We cap at
    // a generous block budget so a regression that never enters LITE fails
    // visibly rather than hanging.
    const block = new Float32Array(256);
    let captured: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr) {
        captured = snap;
        break;
      }
    }
    expect(captured, "snapshot.lfsr was never populated during LITE").toBeDefined();
    const lfsr = captured!.lfsr!;
    expect(lfsr.state).toBeGreaterThanOrEqual(0);
    expect(lfsr.state).toBeLessThanOrEqual(0xFFFF);
    expect([0, 1]).toContain(lfsr.bitOut);
    // LFREQ + CYCNT live in $19 / $15 — both are bytes.
    expect(lfsr.lfreq).toBeLessThanOrEqual(0xFF);
    expect(lfsr.cycnt).toBeLessThanOrEqual(0xFF);
  });

  it("lfsr.state is the live (HI<<8|LO) value from $09:$0A", async () => {
    const r = await newRunner();
    r.fire(LITE);
    const block = new Float32Array(256);
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr) {
        const hi = r.board.read(0x09);
        const lo = r.board.read(0x0A);
        expect(snap.lfsr.state).toBe(((hi << 8) | lo) & 0xFFFF);
        expect(snap.lfsr.bitOut).toBe((lo & 1) as 0 | 1);
        return;
      }
    }
    throw new Error("lfsr never populated within budget");
  });

  it("clears back to undefined once execution leaves the LITE block", async () => {
    const r = await newRunner();
    r.fire(LITE);
    const block = new Float32Array(512);
    let everPopulated = false;
    for (let i = 0; i < 600; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr) everPopulated = true;
      // Once we leave the LITE block (PC back to the BRA-self idle), the
      // slot must vanish.  We give it plenty of blocks to finish.
      if (everPopulated && !snap.lfsr) {
        // PC has left [F88C, F8DC) — typically into the IRQ handler tail
        // (≥ F8DC) or back at the BRA-self idle.  Either is fine; what
        // matters is that the dispatch reflects the *current* PC.
        const inLite = snap.pc >= 0xF88C && snap.pc < 0xF8DC;
        expect(inLite).toBe(false);
        return;
      }
    }
    throw new Error("LITE never returned to idle within budget");
  });
});

describe("engineStateForPc — LITE fire (Stargate)", () => {
  it("populates lfsr the same way on Stargate (VSNDRM2 = VSNDRM1 structure)", async () => {
    const r = await newRunner("stargate");
    r.fire(LITE);
    const block = new Float32Array(256);
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr) {
        expect(snap.lfsr.state).toBeGreaterThanOrEqual(0);
        return;
      }
    }
    throw new Error("Stargate LITE never populated lfsr");
  });
});

describe("engineStateForPc — SAW fire (Defender)", () => {
  it("populates vari (and not lfsr) while executing in the VARI block", async () => {
    const r = await newRunner();
    r.fire(0x1D);
    const block = new Float32Array(256);
    let captured: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 200; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.vari) {
        captured = snap;
        break;
      }
    }
    expect(captured, "snapshot.vari was never populated during SAW").toBeDefined();
    const v = captured!.vari!;
    // Cells are all byte-wide; signed deltas can be negative.
    expect(v.loper).toBeGreaterThanOrEqual(0);
    expect(v.loper).toBeLessThanOrEqual(0xFF);
    expect(v.hiper).toBeLessThanOrEqual(0xFF);
    expect(v.locnt).toBeLessThanOrEqual(0xFF);
    expect(v.hicnt).toBeLessThanOrEqual(0xFF);
    expect(v.lodt).toBeGreaterThanOrEqual(-128);
    expect(v.lodt).toBeLessThanOrEqual(127);
    expect(v.hidt).toBeGreaterThanOrEqual(-128);
    expect(v.hidt).toBeLessThanOrEqual(127);
    // No overlap with LFSR.
    expect(captured!.lfsr).toBeUndefined();
  });

  it("LODT / HIDT / LOMOD are read as signed bytes", async () => {
    // Force-fill RAM via the board (white-box test of the read path) by
    // running a few cycles inside the VARI block and inspecting.
    const r = await newRunner();
    r.fire(0x1D);
    const block = new Float32Array(256);
    for (let i = 0; i < 200; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.vari) {
        const raw15 = r.board.read(0x15);
        const expected = raw15 & 0x80 ? raw15 - 0x100 : raw15;
        expect(snap.vari.lodt).toBe(expected);
        return;
      }
    }
    throw new Error("VARI slot never populated");
  });

  it("clears to undefined once execution leaves the VARI block", async () => {
    const r = await newRunner();
    r.fire(0x1D);
    const block = new Float32Array(512);
    let everPopulated = false;
    for (let i = 0; i < 1000; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.vari) everPopulated = true;
      if (everPopulated && !snap.vari) {
        const inVari = snap.pc >= 0xF82A && snap.pc < 0xF88C;
        expect(inVari).toBe(false);
        return;
      }
    }
    throw new Error("SAW never returned to idle within budget");
  });
});

describe("engineStateForPc — HBDV fire (Defender)", () => {
  it("populates gwave once execution enters the GWAVE block", async () => {
    const r = await newRunner();
    r.fire(0x01);
    const block = new Float32Array(256);
    let captured: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.gwave) {
        captured = snap;
        break;
      }
    }
    expect(captured, "snapshot.gwave was never populated during HBDV").toBeDefined();
    const g = captured!.gwave!;
    // 72-byte wavetable shape.
    expect(g.waveTable).toBeInstanceOf(Uint8Array);
    expect(g.waveTable.length).toBe(72);
    // Common cells fit a byte.
    expect(g.gper).toBeLessThanOrEqual(0xFF);
    expect(g.gecnt).toBeLessThanOrEqual(0xFF);
    // GWFRM / GWFRQ are word-sized.
    expect(g.gwfrm).toBeLessThanOrEqual(0xFFFF);
    expect(g.gwfrq).toBeLessThanOrEqual(0xFFFF);
    // Signed cells stay in [-128, 127].
    expect(g.fofset).toBeGreaterThanOrEqual(-128);
    expect(g.fofset).toBeLessThanOrEqual(127);
    expect(g.gdfinc).toBeGreaterThanOrEqual(-128);
    expect(g.gdfinc).toBeLessThanOrEqual(127);
    // No overlap with other engines.
    expect(captured!.lfsr).toBeUndefined();
    expect(captured!.vari).toBeUndefined();
  });

  it("waveTable mirrors RAM cells $24..$6B exactly", async () => {
    const r = await newRunner();
    r.fire(0x01);
    const block = new Float32Array(256);
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.gwave) {
        for (let j = 0; j < snap.gwave.waveTable.length; j++) {
          expect(snap.gwave.waveTable[j]).toBe(r.board.read(0x24 + j));
        }
        return;
      }
    }
    throw new Error("GWAVE slot never populated");
  });

  it("sampleIndex tracks X minus the GWTAB base when X points into the table", async () => {
    const r = await newRunner();
    r.fire(0x01);
    const block = new Float32Array(256);
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.gwave) {
        const expected = (r.cpu.x & 0xFFFF) - 0x24;
        if (expected >= 0 && expected < 72) {
          expect(snap.gwave.sampleIndex).toBe(expected);
        } else {
          expect(snap.gwave.sampleIndex).toBe(-1);
        }
        return;
      }
    }
    throw new Error("GWAVE slot never populated");
  });

  it("clears back to undefined once execution leaves the GWAVE block", async () => {
    const r = await newRunner();
    r.fire(0x01);
    const block = new Float32Array(512);
    let everPopulated = false;
    for (let i = 0; i < 1500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.gwave) everPopulated = true;
      if (everPopulated && !snap.gwave) {
        const inGwave = snap.pc >= 0xFB81 && snap.pc < 0xFCB6;
        expect(inGwave).toBe(false);
        return;
      }
    }
    throw new Error("HBDV never returned to idle within budget");
  });
});

describe("engineStateForPc — scrub-mode time travel", () => {
  it("scrubbing back through SAW re-populates the VARI slot even though the live CPU is idle", async () => {
    const r = await newRunner();
    r.fire(0x1D);
    const block = new Float32Array(512);
    // Capture an oldestCycle reading while inside SAW — that's the earliest
    // recorded event and is guaranteed to land in the VARI block.
    let saw = false;
    let variCycle = -1;
    for (let i = 0; i < 1000; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.vari && variCycle < 0) variCycle = snap.recorded.oldestCycle;
      if (snap.vari) saw = true;
      if (saw && !snap.vari) break;
    }
    expect(saw).toBe(true);
    expect(r.snapshot().vari, "live VARI slot should have cleared once SAW returned to idle").toBeUndefined();
    expect(variCycle).toBeGreaterThan(0);

    // Scrub back to the VARI-era cycle.  Live cpu.pc is still on BRA-self
    // (idle), but the dispatch should use the *historical* PC at the scrub
    // head and surface the VARI slot.
    r.startScrub(variCycle, 0);
    const scrubSnap = r.snapshot();
    expect(scrubSnap.scrubbing).toBe(true);
    expect(scrubSnap.vari, "VARI slot should re-appear at a VARI-era scrub head").toBeDefined();
    // Live PC is outside the VARI block (the engine slot came from history).
    const liveInVari = scrubSnap.pc >= 0xF82A && scrubSnap.pc < 0xF88C;
    expect(liveInVari).toBe(false);
  });

  it("scrubbing the LITE recording surfaces the lfsr slot via historical PC", async () => {
    const r = await newRunner();
    r.fire(0x11);
    const block = new Float32Array(512);
    let liteCycle = -1;
    for (let i = 0; i < 600; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr && liteCycle < 0) liteCycle = snap.recorded.oldestCycle;
      if (liteCycle >= 0 && !snap.lfsr) break;
    }
    expect(liteCycle).toBeGreaterThan(0);
    r.startScrub(liteCycle, 0);
    const scrubSnap = r.snapshot();
    expect(scrubSnap.lfsr, "LFSR slot should re-appear at a LITE-era scrub head").toBeDefined();
    expect(scrubSnap.vari).toBeUndefined();
  });
});

describe("engineStateForPc — SCREAM fire (Robotron)", () => {
  it("populates scream with 4 voices once execution enters the SCREAM block", async () => {
    const r = await newRunner("robotron");
    r.fire(0x1A);
    const block = new Float32Array(256);
    let captured: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.scream) {
        captured = snap;
        break;
      }
    }
    expect(captured, "snapshot.scream was never populated during SCREAM").toBeDefined();
    const s = captured!.scream!;
    expect(s.voices.length).toBe(4);
    for (const v of s.voices) {
      expect(v.freq).toBeLessThanOrEqual(0xFF);
      expect(v.timer).toBeLessThanOrEqual(0xFF);
    }
    expect(captured!.lfsr).toBeUndefined();
    expect(captured!.vari).toBeUndefined();
    expect(captured!.gwave).toBeUndefined();
    expect(captured!.organ).toBeUndefined();
  });

  it("voice freq/timer pairs mirror RAM at STABLE..STABLE+7 ($12..$19)", async () => {
    const r = await newRunner("robotron");
    r.fire(0x1A);
    const block = new Float32Array(256);
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.scream) {
        for (let v = 0; v < 4; v++) {
          expect(snap.scream.voices[v]!.freq).toBe(r.board.read(0x12 + v * 2));
          expect(snap.scream.voices[v]!.timer).toBe(r.board.read(0x13 + v * 2));
        }
        return;
      }
    }
    throw new Error("scream slot never populated");
  });
});

describe("engineStateForPc — ORGAN slot (pure reader)", () => {
  // ORGAN runs inside the IRQ tune-tick loop, not from a single fire().
  // Verify the slot reader works by poking RAM directly and driving the PC
  // into the ORGAN block via a manual step.  This isolates the populator
  // from the dispatch logic.
  it("returns the live OSCIL / DUR / RDELAY bytes when PC ∈ ORGAN range", async () => {
    const rom = await loadROM("robotron");
    const board = new SoundBoard("robotron", rom);
    board.write(0x12, 0x34); // DUR lo
    board.write(0x13, 0x12); // DUR hi
    board.write(0x14, 0xA5); // OSCIL — popcount 4
    for (let i = 0; i < 60; i++) board.write(0x15 + i, (i * 7) & 0xFF);

    const slots = engineStateForPc(0xF940, board); // mid-ORGAN block
    expect(slots.organ).toBeDefined();
    const o = slots.organ!;
    expect(o.dur).toBe(0x1234);
    expect(o.oscil).toBe(0xA5);
    expect(o.oscilCount).toBe(4);
    expect(o.rdelay.length).toBe(60);
    for (let i = 0; i < 60; i++) expect(o.rdelay[i]).toBe((i * 7) & 0xFF);
  });

  it("returns no slot when PC is outside the ORGAN range", async () => {
    const rom = await loadROM("robotron");
    const board = new SoundBoard("robotron", rom);
    expect(engineStateForPc(0xF000, board).organ).toBeUndefined();
    expect(engineStateForPc(0xF8CA, board).organ).toBeUndefined();
    expect(engineStateForPc(0xF967, board).organ).toBeUndefined();
  });
});

// SCREAM ($1A) and ORGAN ($1B/$1C) live in Defender's and Stargate's sound
// ROMs too — SCREAM was *born* on Defender (Robotron just added voice-spawn
// detune).  D/S overlay these engines one zero-page cell higher than Robotron
// (STABLE/DUR at $13 not $12, OSCIL $15, RDELAY $16), so they need their own
// specs to introspect.
describe("engineStateForPc — SCREAM fire (Defender + Stargate)", () => {
  for (const game of ["defender", "stargate"] as const) {
    it(`populates scream (4 voices, STABLE at $13) on ${game}`, async () => {
      const r = await newRunner(game);
      r.fire(0x1A);
      const block = new Float32Array(256);
      for (let i = 0; i < 500; i++) {
        r.fillBlock(block);
        const snap = r.snapshot();
        if (snap.scream) {
          expect(snap.scream.voices.length).toBe(4);
          for (let v = 0; v < 4; v++) {
            expect(snap.scream.voices[v]!.freq).toBe(r.board.read(0x13 + v * 2));
            expect(snap.scream.voices[v]!.timer).toBe(r.board.read(0x14 + v * 2));
          }
          expect(snap.organ).toBeUndefined();
          return;
        }
      }
      throw new Error(`scream slot never populated on ${game}`);
    });
  }
});

describe("engineStateForPc — ORGAN slot (pure reader, Defender + Stargate)", () => {
  // ORGAN1 (the DAC playback loop) sits at FADD on Defender / FAB2 on Stargate.
  const cases = [
    { game: "defender" as const, inRange: 0xFADD, below: 0xFA43, above: 0xFB0A },
    { game: "stargate" as const, inRange: 0xFAB2, below: 0xFA43, above: 0xFAE0 },
  ];
  for (const { game, inRange, below, above } of cases) {
    it(`returns live OSCIL/DUR/RDELAY when PC ∈ ORGAN range on ${game}`, async () => {
      const rom = await loadROM(game);
      const board = new SoundBoard(game, rom);
      board.write(0x13, 0x34); // DUR lo
      board.write(0x14, 0x12); // DUR hi
      board.write(0x15, 0xA5); // OSCIL — popcount 4
      for (let i = 0; i < 60; i++) board.write(0x16 + i, (i * 7) & 0xFF);

      const o = engineStateForPc(inRange, board).organ;
      expect(o).toBeDefined();
      expect(o!.dur).toBe(0x1234);
      expect(o!.oscil).toBe(0xA5);
      expect(o!.oscilCount).toBe(4);
      expect(o!.rdelay.length).toBe(60);
      for (let i = 0; i < 60; i++) expect(o!.rdelay[i]).toBe((i * 7) & 0xFF);

      // Boundary invariant: no slot just outside the range either side.
      expect(engineStateForPc(below, board).organ).toBeUndefined();
      expect(engineStateForPc(above, board).organ).toBeUndefined();
    });
  }
});

describe("engineStateForPc — CANNON ($17) fire (Defender)", () => {
  it("populates fnoise once execution enters the FNOISE block", async () => {
    const r = await newRunner();
    r.fire(0x17); // CANNON — distortion + descending slope
    const block = new Float32Array(256);
    let captured: ReturnType<typeof r.snapshot> | undefined;
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.fnoise) {
        captured = snap;
        break;
      }
    }
    expect(captured, "snapshot.fnoise was never populated during CANNON").toBeDefined();
    const fn = captured!.fnoise!;
    // All cells fit a byte/word respectively.
    expect(fn.fmax).toBeLessThanOrEqual(0xFF);
    expect(fn.freq).toBeLessThanOrEqual(0xFFFF);
    expect(fn.sampc).toBeLessThanOrEqual(0xFFFF);
    expect(fn.fdflg).toBeLessThanOrEqual(0xFF);
    expect(fn.dsflg).toBeLessThanOrEqual(0xFF);
    // CANNON specifically: distortion ON, slope DOWN per the catalogue.
    expect(fn.dsflg).not.toBe(0);
    expect(fn.fdflg).not.toBe(0);
    // No overlap with other engines.
    expect(captured!.lfsr).toBeUndefined();
    expect(captured!.vari).toBeUndefined();
    expect(captured!.gwave).toBeUndefined();
    expect(captured!.scream).toBeUndefined();
    expect(captured!.organ).toBeUndefined();
  });

  it("freq cell mirrors HI:LO at $14:$15 (Defender layout)", async () => {
    const r = await newRunner();
    r.fire(0x17);
    const block = new Float32Array(256);
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.fnoise) {
        const hi = r.board.read(0x14);
        const lo = r.board.read(0x15);
        expect(snap.fnoise.freq).toBe(((hi << 8) | lo) & 0xFFFF);
        return;
      }
    }
    throw new Error("fnoise slot never populated");
  });
});

describe("engineStateForPc — Robotron LFSR range (LITE)", () => {
  it("populates lfsr inside [F55C, F59D) using Robotron's LO=$06 HI=$05", async () => {
    const r = await newRunner("robotron");
    r.fire(0x11); // LITE — routes through Robotron's LITE engine
    const block = new Float32Array(256);
    for (let i = 0; i < 500; i++) {
      r.fillBlock(block);
      const snap = r.snapshot();
      if (snap.lfsr) {
        const hi = r.board.read(0x05);
        const lo = r.board.read(0x06);
        expect(snap.lfsr.state).toBe(((hi << 8) | lo) & 0xFFFF);
        return;
      }
    }
    throw new Error("Robotron LFSR slot never populated");
  });
});

describe("engineStateForPc — pure function", () => {
  it("is callable standalone with a board (no runner required)", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    // Inside the LITE block but with zeroed RAM — should produce a state
    // that reflects the RAM contents (here all zeros).
    const slots = engineStateForPc(0xF89E, board);
    expect(slots.lfsr).toBeDefined();
    expect(slots.lfsr!.state).toBe(0);
    expect(slots.lfsr!.bitOut).toBe(0);
  });

  it("returns no slot for a PC outside every known engine range", async () => {
    const rom = await loadROM("defender");
    const board = new SoundBoard("defender", rom);
    expect(engineStateForPc(0xF800, board).lfsr).toBeUndefined(); // SETUP
    expect(engineStateForPc(0xFFFF, board).lfsr).toBeUndefined(); // last byte
  });

  it("returns no slot for games without an LFSR range configured", async () => {
    const rom = await loadROM("robotron");
    const board = new SoundBoard("robotron", rom);
    // Even a PC that happens to fall in the Defender LFSR range is harmless
    // on Robotron — there's simply no range mapping.
    expect(engineStateForPc(0xF89E, board).lfsr).toBeUndefined();
  });
});
