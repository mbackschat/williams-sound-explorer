/**
 * Engine-toggle tests (Step 4.4 — Pattern 3).
 *
 * Each toggle is verified to actually suppress the targeted RAM write
 * without freezing the CPU or breaking unrelated state.  The strategy is:
 *
 *   1. Run the relevant sound with the toggle OFF until a marker cell
 *      observably changes (proves the test setup is real).
 *   2. Re-run with the toggle ON and assert the marker cell stays constant
 *      from whatever value it had right after fire().
 *   3. Cross-check that the engine slot still populates (engine is still
 *      running — we didn't kill it, just gated one write).
 */
import { describe, expect, it } from "vitest";

import { RealtimeRunner } from "../src/audio/realtimeRunner.ts";
import {
  shouldDiscardWrite,
  transformWriteValue,
} from "../src/audio/engineToggles.ts";
import { loadROM } from "../src/board/rom.ts";

const SAMPLE_RATE = 48000;

async function newRunner(game: "defender" | "stargate" | "robotron" = "defender"): Promise<RealtimeRunner> {
  const rom = await loadROM(game);
  const r = new RealtimeRunner(game, rom, { sampleRate: SAMPLE_RATE });
  r.bootToIdle();
  return r;
}

/**
 * Drive the runner until the engine slot becomes populated.  Returns the
 * first cycle at which the slot was seen, so tests can compare initial
 * values vs. later values.
 */
function driveUntilEngineActive(
  r: RealtimeRunner,
  pick: (s: ReturnType<typeof r.snapshot>) => boolean,
  budget = 500,
): boolean {
  const block = new Float32Array(256);
  for (let i = 0; i < budget; i++) {
    r.fillBlock(block);
    if (pick(r.snapshot())) return true;
  }
  return false;
}

describe("shouldDiscardWrite — pure predicate", () => {
  it("returns false for every addr when no toggle is set", () => {
    for (let a = 0; a < 0x80; a++) {
      expect(shouldDiscardWrite({}, a, "defender", 0xF800)).toBe(false);
    }
  });

  it("lfsrFreeze blocks $09 and $0A but nothing else", () => {
    const t = { lfsrFreeze: true };
    expect(shouldDiscardWrite(t, 0x09, "defender", 0xF89E)).toBe(true);
    expect(shouldDiscardWrite(t, 0x0A, "defender", 0xF89E)).toBe(true);
    expect(shouldDiscardWrite(t, 0x08, "defender", 0xF89E)).toBe(false);
    expect(shouldDiscardWrite(t, 0x0B, "defender", 0xF89E)).toBe(false);
    expect(shouldDiscardWrite(t, 0x21, "defender", 0xF89E)).toBe(false);
  });

  it("variFreezePeriod blocks $13 and $14", () => {
    const t = { variFreezePeriod: true };
    expect(shouldDiscardWrite(t, 0x13, "defender", 0xF844)).toBe(true);
    expect(shouldDiscardWrite(t, 0x14, "defender", 0xF844)).toBe(true);
    expect(shouldDiscardWrite(t, 0x12, "defender", 0xF844)).toBe(false);
    expect(shouldDiscardWrite(t, 0x15, "defender", 0xF844)).toBe(false);
  });

  it("gwaveFreezePattern blocks $21 only", () => {
    const t = { gwaveFreezePattern: true };
    expect(shouldDiscardWrite(t, 0x21, "defender", 0xFBEF)).toBe(true);
    expect(shouldDiscardWrite(t, 0x20, "defender", 0xFBEF)).toBe(false);
    expect(shouldDiscardWrite(t, 0x22, "defender", 0xFBEF)).toBe(false);
  });

  it("gwaveSkipDecay blocks $24..$6B only while PC is inside the WVDECA range", () => {
    const t = { gwaveSkipDecay: true };
    // Inside WVDECA (Defender [FC87, FCB5)) — blocked.
    expect(shouldDiscardWrite(t, 0x24, "defender", 0xFC90)).toBe(true);
    expect(shouldDiscardWrite(t, 0x6B, "defender", 0xFCB4)).toBe(true);
    // Outside WVDECA — passes (so GWLD initial load isn't gated).
    expect(shouldDiscardWrite(t, 0x24, "defender", 0xFBA0)).toBe(false);
    expect(shouldDiscardWrite(t, 0x6B, "defender", 0xF800)).toBe(false);
    // Address outside wavetable — passes regardless of PC.
    expect(shouldDiscardWrite(t, 0x23, "defender", 0xFC90)).toBe(false);
    expect(shouldDiscardWrite(t, 0x6C, "defender", 0xFC90)).toBe(false);
  });

  it("gwaveSkipDecay uses Stargate's WVDECA range when game=stargate", () => {
    const t = { gwaveSkipDecay: true };
    // Defender WVDECA addr would not be inside Stargate's range.
    expect(shouldDiscardWrite(t, 0x24, "stargate", 0xFC90)).toBe(false);
    // Stargate WVDECA @ FC5D..FC8B.
    expect(shouldDiscardWrite(t, 0x24, "stargate", 0xFC70)).toBe(true);
  });
});

describe("lfsrFreeze — LITE freezes the shift register", () => {
  it("LO and HI never advance when the toggle is on", async () => {
    const r = await newRunner();
    r.setToggle("lfsrFreeze", true);
    r.fire(0x11);
    expect(driveUntilEngineActive(r, (s) => s.lfsr !== undefined)).toBe(true);
    const firstState = r.snapshot().lfsr!.state;
    // Drive many more blocks and re-check.
    const block = new Float32Array(512);
    let stillActive = false;
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.lfsr) {
        stillActive = true;
        expect(s.lfsr.state).toBe(firstState);
      }
    }
    expect(stillActive).toBe(true);
  });

  it("without the toggle, LO/HI DO advance (sanity check)", async () => {
    const r = await newRunner();
    r.fire(0x11);
    expect(driveUntilEngineActive(r, (s) => s.lfsr !== undefined)).toBe(true);
    const initial = r.snapshot().lfsr!.state;
    let changed = false;
    const block = new Float32Array(512);
    for (let i = 0; i < 100 && !changed; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.lfsr && s.lfsr.state !== initial) changed = true;
    }
    expect(changed).toBe(true);
  });
});

describe("variFreezePeriod — SAW pins LOPER/HIPER", () => {
  it("LOPER stays at its post-fire value across the whole sweep", async () => {
    const r = await newRunner();
    r.setToggle("variFreezePeriod", true);
    r.fire(0x1D);
    expect(driveUntilEngineActive(r, (s) => s.vari !== undefined)).toBe(true);
    const baseline = r.snapshot().vari!.loper;
    const block = new Float32Array(512);
    let stillActive = false;
    for (let i = 0; i < 80; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.vari) {
        stillActive = true;
        expect(s.vari.loper).toBe(baseline);
      }
    }
    expect(stillActive).toBe(true);
  });

  it("without the toggle, LOPER drifts (sanity check)", async () => {
    const r = await newRunner();
    r.fire(0x1D);
    expect(driveUntilEngineActive(r, (s) => s.vari !== undefined)).toBe(true);
    const initial = r.snapshot().vari!.loper;
    const block = new Float32Array(512);
    let drifted = false;
    for (let i = 0; i < 200 && !drifted; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.vari && s.vari.loper !== initial) drifted = true;
    }
    expect(drifted).toBe(true);
  });
});

describe("gwaveFreezePattern — HBDV pins GPER", () => {
  it("GPER stays constant when the toggle is on", async () => {
    const r = await newRunner();
    r.setToggle("gwaveFreezePattern", true);
    r.fire(0x01);
    // With the toggle on the first STAA GPER is gated, so GPER never gets
    // its run-time value — it sits at whatever RAM had at fire time.
    // The meaningful assertion is "GPER doesn't move", not "GPER > 0".
    expect(driveUntilEngineActive(r, (s) => s.gwave !== undefined)).toBe(true);
    const baseline = r.snapshot().gwave!.gper;
    const block = new Float32Array(512);
    let stillActive = false;
    for (let i = 0; i < 100; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.gwave) {
        stillActive = true;
        expect(s.gwave.gper).toBe(baseline);
      }
    }
    expect(stillActive).toBe(true);
  });

  it("without the toggle, GPER varies (sanity check)", async () => {
    const r = await newRunner();
    r.fire(0x01);
    // Wait until GPER has actually been written by GPLAY (i.e. non-zero).
    expect(driveUntilEngineActive(r, (s) => s.gwave !== undefined && s.gwave.gper > 0)).toBe(true);
    const initial = r.snapshot().gwave!.gper;
    const block = new Float32Array(512);
    let changed = false;
    for (let i = 0; i < 200 && !changed; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.gwave && s.gwave.gper !== initial) changed = true;
    }
    expect(changed).toBe(true);
  });
});

describe("screamMuteVoice — SCREAM voice mute pins TIMER writes (Pattern 4)", () => {
  it("voice-mute toggle is PC-gated to the SCREAM range", () => {
    const t = { screamMuteVoice0: true };
    // Inside SCREAM (Robotron F87A..F8CB): voice-0 TIMER ($13) is discarded.
    expect(shouldDiscardWrite(t, 0x13, "robotron", 0xF8A0)).toBe(true);
    // Outside SCREAM (e.g. VARI block): same cell passes through.
    expect(shouldDiscardWrite(t, 0x13, "robotron", 0xF510)).toBe(false);
    // Only TIMER cell — FREQ ($12) is NOT muted (the cascade depends on it).
    expect(shouldDiscardWrite(t, 0x12, "robotron", 0xF8A0)).toBe(false);
    // Neighboring voice's TIMER ($15) is independent.
    expect(shouldDiscardWrite(t, 0x15, "robotron", 0xF8A0)).toBe(false);
  });

  it("each voice toggle targets exactly its own TIMER cell", () => {
    const pc = 0xF8A0; // inside SCREAM
    expect(shouldDiscardWrite({ screamMuteVoice0: true }, 0x13, "robotron", pc)).toBe(true);
    expect(shouldDiscardWrite({ screamMuteVoice1: true }, 0x15, "robotron", pc)).toBe(true);
    expect(shouldDiscardWrite({ screamMuteVoice2: true }, 0x17, "robotron", pc)).toBe(true);
    expect(shouldDiscardWrite({ screamMuteVoice3: true }, 0x19, "robotron", pc)).toBe(true);
    // Voice 0 toggle doesn't bleed into voice 1's cell.
    expect(shouldDiscardWrite({ screamMuteVoice0: true }, 0x15, "robotron", pc)).toBe(false);
  });

  it("voice mute also works on Defender / Stargate (SCREAM is cross-game)", () => {
    const t = { screamMuteVoice0: true };
    // D/S SCREAM range [F9F3, FA44), STABLE=$13 → voice-0 TIMER=$14.
    expect(shouldDiscardWrite(t, 0x14, "defender", 0xFA00)).toBe(true);
    expect(shouldDiscardWrite(t, 0x14, "stargate", 0xFA00)).toBe(true);
    expect(shouldDiscardWrite({ screamMuteVoice3: true }, 0x1A, "defender", 0xFA00)).toBe(true);
    // FREQ ($13) isn't muted; outside the SCREAM range the cell passes through.
    expect(shouldDiscardWrite(t, 0x13, "defender", 0xFA00)).toBe(false);
    expect(shouldDiscardWrite(t, 0x14, "defender", 0xF510)).toBe(false);
  });

  it("Robotron $1A — muted voice 0's TIMER stays at 0 even while SCREAM iterates", async () => {
    const r = await newRunner("robotron");
    r.setToggle("screamMuteVoice0", true);
    r.fire(0x1A);
    // Wait for the engine to populate the slot.
    expect(driveUntilEngineActive(r, (s) => s.scream !== undefined, 400)).toBe(true);
    const block = new Float32Array(512);
    let sawIterations = 0;
    for (let i = 0; i < 200; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.scream) {
        sawIterations++;
        // Voice 0's TIMER ($13) should remain 0 — CLR ,X at startup zeroed
        // it; the subsequent STAA TIMER,X writes are suppressed by the
        // toggle, so the TIMER cell can never wander to a value that would
        // make the ADDA result negative (= contribution).
        expect(s.scream.voices[0]!.timer).toBe(0);
      }
    }
    expect(sawIterations).toBeGreaterThan(10);
  });

  it("without the toggle, voice 0's TIMER does vary (sanity check)", async () => {
    const r = await newRunner("robotron");
    r.fire(0x1A);
    expect(driveUntilEngineActive(r, (s) => s.scream !== undefined, 400)).toBe(true);
    const block = new Float32Array(512);
    let timerMoved = false;
    for (let i = 0; i < 400 && !timerMoved; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.scream && s.scream.voices[0]!.timer !== 0) timerMoved = true;
    }
    expect(timerMoved).toBe(true);
  });
});

describe("transformWriteValue — ORGAN voice mute (Pattern 4 expansion)", () => {
  // Robotron ORGAN range from engineState.ts ORGAN_SPECS: [0xF8CB, 0xF967).
  const ORGAN_PC = 0xF900;
  const OSCIL = 0x14;

  it("returns value unchanged when no organ-mute toggles are set", () => {
    expect(transformWriteValue({}, OSCIL, "robotron", ORGAN_PC, 0xFF)).toBe(0xFF);
  });

  it("clears bit 0 of OSCIL when organMuteVoice0 is set (inside ORGAN range)", () => {
    const r = transformWriteValue({ organMuteVoice0: true }, OSCIL, "robotron", ORGAN_PC, 0xFF);
    expect(r).toBe(0xFE);
  });

  it("clears multiple bits when several voice-mute toggles are set", () => {
    const r = transformWriteValue(
      { organMuteVoice0: true, organMuteVoice3: true, organMuteVoice7: true },
      OSCIL, "robotron", ORGAN_PC, 0xFF,
    );
    expect(r).toBe(0xFF & ~0b10001001);
  });

  it("only masks the OSCIL cell — other addresses pass through", () => {
    expect(transformWriteValue({ organMuteVoice0: true }, 0x12, "robotron", ORGAN_PC, 0xFF)).toBe(0xFF);
    expect(transformWriteValue({ organMuteVoice0: true }, 0x15, "robotron", ORGAN_PC, 0xFF)).toBe(0xFF);
  });

  it("only masks when PC is inside the ORGAN range", () => {
    // PC outside ORGAN (e.g. SCREAM range) — toggle is set but transform is inert.
    expect(transformWriteValue({ organMuteVoice0: true }, OSCIL, "robotron", 0xF8A0, 0xFF)).toBe(0xFF);
    // PC inside ORGAN range — transform fires.
    expect(transformWriteValue({ organMuteVoice0: true }, OSCIL, "robotron", 0xF900, 0xFF)).toBe(0xFE);
  });

  it("organMuteVoice also masks on Defender / Stargate (ORGAN is cross-game)", () => {
    // D/S OSCIL=$15; ORGAN range Defender [FA44, FB0A), Stargate [FA44, FAE0).
    expect(transformWriteValue({ organMuteVoice0: true }, 0x15, "defender", 0xFADD, 0xFF)).toBe(0xFE);
    expect(transformWriteValue({ organMuteVoice0: true }, 0x15, "stargate", 0xFAB2, 0xFF)).toBe(0xFE);
    // Robotron's OSCIL cell ($14) isn't D/S's — passes through on Defender.
    expect(transformWriteValue({ organMuteVoice0: true }, 0x14, "defender", 0xFADD, 0xFF)).toBe(0xFF);
    // Outside the ORGAN range, inert.
    expect(transformWriteValue({ organMuteVoice0: true }, 0x15, "defender", 0xF800, 0xFF)).toBe(0xFF);
  });

  it("RealtimeRunner.setToggle stomps OSCIL immediately on toggle change", async () => {
    const rom = await loadROM("robotron");
    const r = new RealtimeRunner("robotron", rom, { sampleRate: SAMPLE_RATE });
    r.bootToIdle();
    // Pre-seed OSCIL to all-bits-set so we can see the mask effect.
    r.board.ram[0x14] = 0xFF;
    r.setToggle("organMuteVoice0", true);
    expect(r.board.ram[0x14]).toBe(0xFE);
    r.setToggle("organMuteVoice7", true);
    expect(r.board.ram[0x14]).toBe(0x7E); // bit 0 + bit 7 cleared
    r.setToggle("organMuteVoice0", false);
    // Clearing one toggle re-computes the mask: only bit 7 still cleared.
    // (The stomp re-applies the active mask to current RAM; bit 0 stays 0
    // because we can't un-clear it without knowing the original — that's
    // by design.  The CPU's next OSCIL write will set bit 0 if the tune
    // wants it.)
    expect(r.board.ram[0x14] & 0x80).toBe(0); // bit 7 still cleared
  });

  it("RealtimeRunner.setToggle stomps the Defender OSCIL cell ($15), not $14", async () => {
    const rom = await loadROM("defender");
    const r = new RealtimeRunner("defender", rom, { sampleRate: SAMPLE_RATE });
    r.bootToIdle();
    r.board.ram[0x15] = 0xFF; // Defender's OSCIL
    r.board.ram[0x14] = 0xFF; // a different cell — must be left alone
    r.setToggle("organMuteVoice0", true);
    expect(r.board.ram[0x15]).toBe(0xFE); // bit 0 cleared on the right cell
    expect(r.board.ram[0x14]).toBe(0xFF); // Robotron's cell untouched on Defender
  });
});

describe("gwaveSkipDecay — HBDV wavetable RAM stays intact", () => {
  it("waveTable bytes don't change across echoes when the toggle is on", async () => {
    const r = await newRunner();
    r.setToggle("gwaveSkipDecay", true);
    r.fire(0x01);
    // Wait for the engine + a fully-loaded wavetable.
    expect(driveUntilEngineActive(r, (s) => s.gwave !== undefined && s.gwave.waveTable.some((v) => v !== 0))).toBe(true);
    const baseline = Array.from(r.snapshot().gwave!.waveTable);
    const block = new Float32Array(512);
    // Drive long enough that an echo would normally trigger a WVDECA pass.
    for (let i = 0; i < 400; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.gwave) {
        // Compare element-wise — the live RAM should still match baseline
        // because every WVDECA writeback was suppressed.
        for (let j = 0; j < baseline.length; j++) {
          expect(s.gwave.waveTable[j], `byte $${(0x24 + j).toString(16)} drifted at iteration ${i}`)
            .toBe(baseline[j]);
        }
      }
    }
  });

  it("without the toggle, the wavetable DOES change across echoes (sanity)", async () => {
    const r = await newRunner();
    r.fire(0x01);
    expect(driveUntilEngineActive(r, (s) => s.gwave !== undefined && s.gwave.waveTable.some((v) => v !== 0))).toBe(true);
    const baseline = Array.from(r.snapshot().gwave!.waveTable);
    const block = new Float32Array(512);
    let diverged = false;
    for (let i = 0; i < 1500 && !diverged; i++) {
      r.fillBlock(block);
      const s = r.snapshot();
      if (s.gwave) {
        for (let j = 0; j < baseline.length; j++) {
          if (s.gwave.waveTable[j] !== baseline[j]) { diverged = true; break; }
        }
      }
    }
    expect(diverged).toBe(true);
  });
});
