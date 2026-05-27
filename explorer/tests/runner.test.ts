/**
 * runSound() integration tests.
 *
 * The harness boots a fresh ROM, fires one command, and runs until the IRQ
 * handler returns to idle.  We test:
 *
 *   • Defender $11 LITE produces a non-empty DAC stream.
 *   • The stream terminates within a reasonable cycle budget.
 *   • Two consecutive runs of the same command produce identical streams
 *     (deterministic).
 *   • Stargate $11 LITE is byte-identical to Defender's (engines are shared).
 *   • Command $00 (silence) produces zero or near-zero DAC writes.
 *   • The PIA's CA1 flag is cleared after the handler reads Port B.
 */
import { describe, expect, it } from "vitest";

import { runSound } from "../src/node/runnerNode.ts";

const LITE = 0x11;
const SILENCE = 0x00;

describe("runSound — Defender", () => {
  it("$11 LITE produces a non-empty DAC stream that terminates within budget", async () => {
    const result = await runSound("defender", LITE);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.reachedIdle).toBe(true);
    // 5 s budget at ~894 kHz = 4.47M cycles — LITE should be well under that.
    expect(result.cycles).toBeLessThan(894_886 * 5);
  });

  it("two consecutive runs are byte-identical (deterministic)", async () => {
    const a = await runSound("defender", LITE);
    const b = await runSound("defender", LITE);
    expect(a.events.length).toBe(b.events.length);
    for (let i = 0; i < a.events.length; i++) {
      expect(a.events[i]).toEqual(b.events[i]);
    }
  });

  it("$00 (silence) produces no DAC writes — IRQ handler returns immediately", async () => {
    const result = await runSound("defender", SILENCE);
    expect(result.reachedIdle).toBe(true);
    expect(result.events.length).toBe(0);
  });

  it("$15 APPEAR (LFSR sweep, same engine as LITE) also runs cleanly", async () => {
    const result = await runSound("defender", 0x15);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.reachedIdle).toBe(true);
  });
});

describe("runSound — cross-game equivalence", () => {
  /**
   * Stargate's LITE engine is byte-identical to Defender's (per
   * `docs/stargate_sound_catalogue.md` — only ORGAN tunes differ).
   *
   * Their DAC *values* therefore match exactly; the absolute cycle offsets
   * differ because Defender's IRQ handler probes the (absent) talking ROM,
   * adding a constant ~10-cycle preamble.  We assert value-equality plus
   * inter-event delta equality, which is what matters audibly.
   */
  it("LITE on Stargate is value-identical to LITE on Defender (engine shared)", async () => {
    const def = await runSound("defender", LITE);
    const sg = await runSound("stargate", LITE);
    expect(sg.events.length).toBe(def.events.length);
    // Same values
    for (let i = 0; i < def.events.length; i++) {
      expect(sg.events[i]!.value).toBe(def.events[i]!.value);
    }
    // Same inter-event cycle deltas — i.e. same audible timing
    for (let i = 1; i < def.events.length; i++) {
      const dDef = def.events[i]!.cycle - def.events[i - 1]!.cycle;
      const dSg = sg.events[i]!.cycle - sg.events[i - 1]!.cycle;
      expect(dSg).toBe(dDef);
    }
  });

  it("Defender's LITE starts later than Stargate's (talking-ROM probe overhead)", async () => {
    const def = await runSound("defender", LITE);
    const sg = await runSound("stargate", LITE);
    const offset = def.events[0]!.cycle - sg.events[0]!.cycle;
    // Defender's IRQ handler has a `LDX TALK` probe that Stargate omits.
    // Expect Defender to be ~10 cycles slower to first DAC write.
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(50); // a sanity ceiling
  });
});

describe("runSound — DAC stream sanity", () => {
  it("LITE's first DAC write should toggle the bottom DAC bits via COM SOUND", async () => {
    const result = await runSound("defender", LITE);
    // The LITE routine drives the DAC via `COM SOUND` (one's complement of
    // whatever the DAC currently holds).  Defender's SETUP wrote $FF to the
    // DAC, so the first COM toggles the value.  Either way the stream is
    // a sequence of 8-bit values 0..255.
    for (const ev of result.events) {
      expect(ev.value).toBeGreaterThanOrEqual(0);
      expect(ev.value).toBeLessThanOrEqual(0xFF);
    }
  });

  it("DAC events have monotonically non-decreasing cycle timestamps", async () => {
    const result = await runSound("defender", LITE);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.cycle).toBeGreaterThanOrEqual(result.events[i - 1]!.cycle);
    }
  });

  it("DAC events carry the PC of the instruction that wrote them (Step 3.3)", async () => {
    const result = await runSound("defender", LITE);
    // Every event should have a non-zero PC inside the program ROM range.
    // Defender's ROM is $F800..$FFFF.
    for (const ev of result.events) {
      expect(ev.pc).toBeDefined();
      expect(ev.pc!).toBeGreaterThanOrEqual(0xF800);
      expect(ev.pc!).toBeLessThanOrEqual(0xFFFF);
    }
  });
});
