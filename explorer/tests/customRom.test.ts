/**
 * Custom-ROM image builder (Designer v-next, Phase 3 + Phase 5 step 1) —
 * headless.
 *
 * Two slot kinds:
 *
 *  - VARI: `{ kind: "vari", code, record(9) }` — widens the command mask if
 *    needed and extends `VVECT` in place. Defender / Stargate only.
 *  - GWAVE: `{ kind: "gwave", cmd, record(7) }` — overrides an existing
 *    GWAVE command's SVTAB entry in place. Defender / Stargate / Robotron.
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
import { readGWaveRecord, patchGWaveRecord } from "../src/engine/gwaveEdit.ts";
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
  it("rejects unsupported base games for VARI slots", () => {
    expect(() => buildCustomRom(synth("robotron"), "robotron", [{ kind: "vari", code: 0x1D, record: REC }])).toThrow(/support/i);
  });
  it("requires at least one slot", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [])).toThrow();
  });
  it("rejects a VARI code below the base or beyond capacity", () => {
    const max = maxSlots("defender");
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "vari", code: 0x11, record: REC }])).toThrow(/range/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "vari", code: VARI_CMD_BASE + max, record: REC }])).toThrow(/range/i);
  });
  it("rejects duplicate VARI codes and malformed records", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "vari", code: 0x1D, record: REC }, { kind: "vari", code: 0x1D, record: REC }])).toThrow(/duplicate/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "vari", code: 0x1D, record: [1, 2, 3] }])).toThrow(/bytes|9/i);
  });
  it("rejects a GWAVE override at a code that isn't editable", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "gwave", cmd: 0x12, record: [0,0,0,0,0,0,0] }])).toThrow(/editable/i);
    expect(() => buildCustomRom(synth("robotron"), "robotron", [{ kind: "gwave", cmd: 0x20, record: [0,0,0,0,0,0,0] }])).toThrow(/editable/i);
  });
  it("rejects malformed GWAVE records", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "gwave", cmd: 0x01, record: [0,0,0,0,0] }])).toThrow(/bytes|7/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "gwave", cmd: 0x01, record: [0,0,0,0,0,0,256] }])).toThrow(/range/i);
  });
  it("exposes a positive VARI capacity for supported games", () => {
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
    const slots: { kind: "vari"; code: number; record: number[] }[] = [
      { kind: "vari", code: 0x1D, record: saw },     // no mask needed
      { kind: "vari", code: 0x1F, record: foshit },  // still ≤ $1F
      { kind: "vari", code: 0x21, record: quasar },  // > $1F → requires the mask widening
      { kind: "vari", code: 0x30, record: saw },     // high code, well past the original 3 slots
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
    const custom = buildCustomRom(base, "defender", [{ kind: "vari", code: 0x21, record: quasar }]);
    expect(eqSeq(dacValues(custom, "defender", 0x21), dacValues(base, "defender", 0x21))).toBe(false);
  });

  it("does not touch the command mask when every code is ≤ $1F", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const custom = buildCustomRom(base, "defender", [{ kind: "vari", code: 0x1D, record: REC }]);
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
    const custom = buildCustomRom(base, "stargate", [{ kind: "vari", code: 0x2A, record: quasar }]);
    const truth = dacValues(patchVariRecord(base, "stargate", 0x1D, quasar), "stargate", 0x1D);
    expect(eqSeq(dacValues(custom, "stargate", 0x2A), truth)).toBe(true);
  });
});

describe("GWAVE override behaviour (Phase 5 step 1)", () => {
  // The ground-truth for a GWAVE override at $05 with record R is: take the
  // base ROM, manually patch SVTAB[$05] = R, and render $05. buildCustomRom
  // should produce a ROM whose $05 plays the same DAC sequence.
  const truthGwave = (base: Uint8Array, game: GameKind, cmd: number, rec: number[]): number[] =>
    dacValues(patchGWaveRecord(base, game, cmd, rec), game, cmd);

  it("Defender: overriding BBSV ($05) with HBDV's record plays HBDV when $05 fires", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const hbdv = readGWaveRecord(base, "defender", 0x01);
    const custom = buildCustomRom(base, "defender", [{ kind: "gwave", cmd: 0x05, record: hbdv }]);
    expect(eqSeq(dacValues(custom, "defender", 0x05), truthGwave(base, "defender", 0x05, hbdv))).toBe(true);
  });

  it("Robotron: GWAVE override works (no dispatcher widen needed)", () => {
    if (!haveRom("robotron")) return;
    const base = loadRom("robotron");
    const hbdv = readGWaveRecord(base, "robotron", 0x01);
    // override DP1V ($03) with HBDV's bytes
    const custom = buildCustomRom(base, "robotron", [{ kind: "gwave", cmd: 0x03, record: hbdv }]);
    expect(eqSeq(dacValues(custom, "robotron", 0x03), truthGwave(base, "robotron", 0x03, hbdv))).toBe(true);
  });

  it("mixed VARI + GWAVE in one build: each kind lands at its target", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const hbdv = readGWaveRecord(base, "defender", 0x01);
    const custom = buildCustomRom(base, "defender", [
      { kind: "vari", code: 0x21, record: saw },    // VARI at new code (mask widens)
      { kind: "gwave", cmd: 0x05, record: hbdv },   // GWAVE override at BBSV
    ]);
    // VARI side: $21 plays SAW (truth via patchVariRecord into native $1D slot).
    const variTruth = dacValues(patchVariRecord(base, "defender", 0x1D, saw), "defender", 0x1D);
    expect(eqSeq(dacValues(custom, "defender", 0x21), variTruth)).toBe(true);
    // GWAVE side: $05 plays HBDV (truth via SVTAB[$05] := hbdv).
    expect(eqSeq(dacValues(custom, "defender", 0x05), truthGwave(base, "defender", 0x05, hbdv))).toBe(true);
  });

  it("does not touch the command mask when only GWAVE slots are present", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const hbdv = readGWaveRecord(base, "defender", 0x01);
    const custom = buildCustomRom(base, "defender", [{ kind: "gwave", cmd: 0x05, record: hbdv }]);
    const maskOperand = (0xFCBD + 2) - 0xF800;
    expect(custom[maskOperand]).toBe(0x1F);
  });
});
