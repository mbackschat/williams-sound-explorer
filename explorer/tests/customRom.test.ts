/**
 * Custom-ROM image builder (Designer v-next, Phase 3 step 1) — headless.
 *
 * Productizes the dispatcher spike: given a base game + VARI slots
 * `{ code, record }`, `buildCustomRom` emits a runnable ROM image where each
 * slot's command code plays its 9-byte VARI record. On a Defender/Stargate
 * base this is a tiny patch — widen the command mask and extend `VVECT` in
 * place over the disposable RADIO/ORGAN tables.
 *
 * The behavioural tests need a real base ROM (the dev fallback in
 * `public/roms/`); they skip if it's absent. The validation/guard tests are
 * hermetic.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import { runSoundWithRom } from "../src/engine/runner.ts";
import { readVariRecord, patchVariRecord } from "../src/engine/variEdit.ts";
import { buildCustomRom, maxSlots, VARI_CMD_BASE } from "../src/engine/customRom.ts";

const REPO = pathResolve(__dirname, "..");
const romPath = (g: string) => pathResolve(REPO, `public/roms/${g}_sound.bin`);
const haveRom = (g: string) => existsSync(romPath(g));
const loadRom = (g: string) => new Uint8Array(readFileSync(romPath(g)));

// The sound's identity is its DAC *value* sequence (record-determined). Absolute
// cycle timing carries a few cycles of dispatch latency that differs by command
// code, so we compare value sequences, not rendered samples.
function dacValues(rom: Uint8Array, game: GameKind, cmd: number): number[] {
  return runSoundWithRom(game, rom, cmd).events.map((e) => e.value);
}
const eqSeq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// A synthetic ROM is enough for the validation guards (they run before any
// ROM-byte patching).
const synth = (game: GameKind) => new Uint8Array(game === "robotron" ? 0x1000 : 0x800).fill(0xAA);
const REC = [0x40, 0x01, 0x00, 0x10, 0xE1, 0x00, 0x80, 0xFF, 0xFF];

describe("validation (hermetic)", () => {
  it("rejects unsupported base games", () => {
    expect(() => buildCustomRom(synth("robotron"), "robotron", [{ code: 0x1D, record: REC }])).toThrow(/support/i);
  });
  it("requires at least one slot", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [])).toThrow();
  });
  it("rejects a code below the VARI base or beyond capacity", () => {
    const max = maxSlots("defender");
    expect(() => buildCustomRom(synth("defender"), "defender", [{ code: 0x11, record: REC }])).toThrow(/range/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ code: VARI_CMD_BASE + max, record: REC }])).toThrow(/range/i);
  });
  it("rejects duplicate codes and malformed records", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ code: 0x1D, record: REC }, { code: 0x1D, record: REC }])).toThrow(/duplicate/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ code: 0x1D, record: [1, 2, 3] }])).toThrow(/bytes|9/i);
  });
  it("exposes a positive capacity for supported games", () => {
    expect(maxSlots("defender")).toBeGreaterThan(3);
    expect(maxSlots("stargate")).toBeGreaterThan(3);
  });
});

describe("behaviour on the real Defender ROM", () => {
  it("each slot's command plays its VARI record (incl. codes that need the mask patch)", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // Ground truth for a record R = play R at the native row-0 slot ($1D).
    const truth = (rec: number[]) => dacValues(patchVariRecord(base, "defender", 0x1D, rec), "defender", 0x1D);

    const saw = readVariRecord(base, "defender", 0x1D);
    const foshit = readVariRecord(base, "defender", 0x1E);
    const quasar = readVariRecord(base, "defender", 0x1F);
    const slots = [
      { code: 0x1D, record: saw },     // no mask needed
      { code: 0x1F, record: foshit },  // still ≤ $1F
      { code: 0x21, record: quasar },  // > $1F → requires the mask widening
      { code: 0x30, record: saw },     // high code, well past the original 3 slots
    ];
    const custom = buildCustomRom(base, "defender", slots);
    for (const s of slots) {
      expect(eqSeq(dacValues(custom, "defender", s.code), truth(s.record)), `code $${s.code.toString(16)}`).toBe(true);
    }
  });

  it("a brand-new high code plays nothing like the unpatched ROM's same code", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const quasar = readVariRecord(base, "defender", 0x1F);
    const custom = buildCustomRom(base, "defender", [{ code: 0x21, record: quasar }]);
    expect(eqSeq(dacValues(custom, "defender", 0x21), dacValues(base, "defender", 0x21))).toBe(false);
  });

  it("does not touch the command mask when every code is ≤ $1F", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const custom = buildCustomRom(base, "defender", [{ code: 0x1D, record: REC }]);
    // $FCBD holds COMA;ANDA #$1F — the operand byte is at $FCBD+2 → ROM offset.
    const maskOperand = (0xFCBD + 2) - 0xF800;
    expect(custom[maskOperand]).toBe(0x1F);
  });
});

describe("behaviour on the real Stargate ROM", () => {
  it("a high VARI code plays its record", () => {
    if (!haveRom("stargate")) return;
    const base = loadRom("stargate");
    const quasar = readVariRecord(base, "stargate", 0x1F);
    const custom = buildCustomRom(base, "stargate", [{ code: 0x2A, record: quasar }]);
    const truth = dacValues(patchVariRecord(base, "stargate", 0x1D, quasar), "stargate", 0x1D);
    expect(eqSeq(dacValues(custom, "stargate", 0x2A), truth)).toBe(true);
  });
});
