/**
 * Golden-stream regression test for LITE.
 *
 * The first time this runs (or when the fixture is missing), it writes the
 * current Defender LITE DAC event log to `tests/golden/defender_11_lite.json`.
 * Subsequent runs compare against that snapshot.  Any change in the emulator,
 * the opcode table, the PIA model, or the dialect preprocessor that shifts
 * even one cycle or one byte will break this test loudly.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runSound } from "../src/runnerNode.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, "golden");

interface GoldenSnapshot {
  game: string;
  cmd: number;
  cycles: number;
  events: { cycle: number; value: number; pc?: number }[];
}

async function checkGolden(
  game: "defender" | "stargate" | "robotron",
  cmd: number,
  fileName: string,
  opts: { requireIdle?: boolean; maxCycles?: number } = {},
): Promise<void> {
  const goldenFile = resolve(GOLDEN_DIR, fileName);
  const result = await runSound(game, cmd, { maxCycles: opts.maxCycles });
  if (opts.requireIdle !== false) {
    expect(result.reachedIdle).toBe(true);
  }

  const current: GoldenSnapshot = {
    game,
    cmd,
    cycles: result.cycles,
    events: result.events,
  };

  if (!existsSync(goldenFile)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenFile, JSON.stringify(current, null, 2));
    console.log(`[golden] seeded ${goldenFile} (${current.events.length} events)`);
    return;
  }

  const golden: GoldenSnapshot = JSON.parse(readFileSync(goldenFile, "utf-8"));
  expect(current.cycles).toBe(golden.cycles);
  expect(current.events.length).toBe(golden.events.length);
  for (let i = 0; i < golden.events.length; i++) {
    expect(current.events[i]).toEqual(golden.events[i]);
  }
}

describe("golden DAC capture", () => {
  it("Defender $11 LITE matches checked-in regression fixture", async () => {
    await checkGolden("defender", 0x11, "defender_11_lite.json");
  });

  it("Defender $1D SAW matches checked-in regression fixture", async () => {
    await checkGolden("defender", 0x1D, "defender_1D_saw.json");
  });

  it("Defender $01 HBDV matches checked-in regression fixture", async () => {
    await checkGolden("defender", 0x01, "defender_01_hbdv.json");
  });

  // Defender $17 CANNON exercises the FNOISE engine end-to-end (distortion
  // ON, slope DOWN).  Long-ish but terminates cleanly at the BRA-self idle.
  it("Defender $17 CANNON matches checked-in regression fixture", async () => {
    await checkGolden("defender", 0x17, "defender_17_cannon.json");
  });

  // Robotron's SCREAM is the canonical 4-voice engine — and is long enough
  // to exhaust the 5 s budget without ever reaching the BRA-self idle.  Cap
  // the run to 1 s so the fixture is a manageable size; skip the idle check.
  it("Robotron $1A SCREAM (first 1 s) matches checked-in regression fixture", async () => {
    await checkGolden("robotron", 0x1A, "robotron_1A_scream.json", {
      requireIdle: false,
      maxCycles: 894_886,
    });
  });
});
