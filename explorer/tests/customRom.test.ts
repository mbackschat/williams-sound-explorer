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
import {
  readGWaveRecord, patchGWaveRecord, readWaveform, patchWaveform,
  readPattern, patchPattern, STOCK_WAVE_LENGTHS,
  GWVTAB_BASE, LDX_GWVTAB_LOC,
} from "../src/engine/gwaveEdit.ts";
import { VVECT_BASE } from "../src/engine/variEdit.ts";
import { readLfsrRecord, patchLfsrRecord } from "../src/engine/lfsrEdit.ts";
import { readFnoiseRecord, patchFnoiseRecord } from "../src/engine/fnoiseEdit.ts";
import { buildCustomRom, computeBudget, maxSlots, VARI_CMD_BASE } from "../src/engine/customRom.ts";

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

describe("Waveform overrides (Phase 5 step 2)", () => {
  // The ground-truth for a waveform override at idx X with bytes B is: take
  // the base ROM, manually patchWaveform(idx=X, bytes=B), and render any
  // command whose SVTAB row points at X. buildCustomRom with that override
  // should produce a ROM whose command renders the same DAC value sequence.
  const truthWaveform = (base: Uint8Array, game: GameKind, cmd: number, idx: number, bytes: number[]): number[] =>
    dacValues(patchWaveform(base, game, idx, bytes), game, cmd);

  // A flat-line waveform byte buffer for a given idx.
  const flat = (idx: number, value: number) => Array.from({ length: STOCK_WAVE_LENGTHS[idx]! }, () => value);

  it("overriding a waveform changes every command that points at that idx", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // HBDV ($01) byte-1 lo nybble = $4 → it points at WAVE# = 4 (GSQ22).
    // A flat 0x80 wave is audibly very different from GSQ22's stock pulse.
    const replacement = flat(4, 0x80);
    const custom = buildCustomRom(base, "defender", [], { waveformOverrides: { 4: replacement } });
    const heard = dacValues(custom, "defender", 0x01);
    const truth = truthWaveform(base, "defender", 0x01, 4, replacement);
    expect(eqSeq(heard, truth)).toBe(true);
    // And it must differ from the stock command (otherwise the override didn't take).
    expect(eqSeq(heard, dacValues(base, "defender", 0x01))).toBe(false);
  });

  it("a build with only a waveform override (no slots) is allowed", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const custom = buildCustomRom(base, "defender", [], { waveformOverrides: { 2: flat(2, 0xC0) } });
    // Reading the waveform back from the built ROM matches our override.
    expect(readWaveform(custom, "defender", 2)).toEqual(flat(2, 0xC0));
  });

  it("mixed VARI + GWAVE + waveform-override in one build: each lands at its target", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const hbdv = readGWaveRecord(base, "defender", 0x01);
    const wfBytes = flat(4, 0x40);
    const custom = buildCustomRom(
      base, "defender",
      [
        { kind: "vari", code: 0x21, record: saw },   // VARI new slot
        { kind: "gwave", cmd: 0x05, record: hbdv },  // GWAVE SVTAB override at BBSV
      ],
      { waveformOverrides: { 4: wfBytes } },         // and stock GSQ22 redrawn
    );
    // VARI still works at $21.
    const variTruth = dacValues(patchVariRecord(base, "defender", 0x1D, saw), "defender", 0x1D);
    expect(eqSeq(dacValues(custom, "defender", 0x21), variTruth)).toBe(true);
    // The waveform override is visible in the built ROM's GWVTAB.
    expect(readWaveform(custom, "defender", 4)).toEqual(wfBytes);
  });

  it("rejects an out-of-range idx, wrong-length replacement, or out-of-range byte", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // idx out of 0..6
    expect(() => buildCustomRom(base, "defender", [], { waveformOverrides: { 7: flat(0, 0) } })).toThrow(/range/i);
    // wrong length (idx 0 = 8 bytes; passing 3)
    expect(() => buildCustomRom(base, "defender", [], { waveformOverrides: { 0: [1, 2, 3] } })).toThrow(/bytes/i);
    // out-of-range byte
    expect(() => buildCustomRom(base, "defender", [], { waveformOverrides: { 0: [0, 0, 0, 0, 0, 0, 0, 256] } })).toThrow(/range/i);
  });
});

describe("Pitch-pattern overrides (Phase 5 step 3)", () => {
  // The ground-truth for a pattern override at offset O with bytes B is: take
  // the base ROM, manually patchPattern(offset=O, bytes=B), and render any
  // command whose SVTAB pattern range overlaps with [O..O+B.length].
  // buildCustomRom with that override should produce the same DAC value
  // sequence on that command.
  const truthPattern = (base: Uint8Array, game: GameKind, cmd: number, offset: number, bytes: number[]): number[] =>
    dacValues(patchPattern(base, game, offset, bytes), game, cmd);

  it("overriding BBSV's pattern bytes changes its rendered DAC trace", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // BBSV's stock pattern is the alternating 08/40 BBSND at offset $47 length $14.
    // Flatten it to all $20 and the command renders an unmistakably different sound.
    const flatPat = Array.from({ length: 0x14 }, () => 0x20);
    const custom = buildCustomRom(base, "defender", [], { patternOverrides: { 0x47: flatPat } });
    const heard = dacValues(custom, "defender", 0x05);
    const truth = truthPattern(base, "defender", 0x05, 0x47, flatPat);
    expect(eqSeq(heard, truth)).toBe(true);
    // And it must differ from the stock command (otherwise the override didn't take).
    expect(eqSeq(heard, dacValues(base, "defender", 0x05))).toBe(false);
  });

  it("a build with only a pattern override (no slots) is allowed", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8];
    const custom = buildCustomRom(base, "defender", [], { patternOverrides: { 0x60: bytes } });
    // Reading the pattern back from the built ROM matches our override.
    expect(readPattern(custom, "defender", 0x60, bytes.length)).toEqual(bytes);
  });

  it("mixed VARI + GWAVE + waveform + pattern in one build: each lands at its target", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const hbdv = readGWaveRecord(base, "defender", 0x01);
    const wfBytes = Array.from({ length: 16 }, () => 0x40); // override GSQ22
    const patBytes = Array.from({ length: 0x14 }, () => 0xC0); // override BBSND
    const custom = buildCustomRom(
      base, "defender",
      [
        { kind: "vari", code: 0x21, record: saw },
        { kind: "gwave", cmd: 0x05, record: hbdv },
      ],
      { waveformOverrides: { 4: wfBytes }, patternOverrides: { 0x47: patBytes } },
    );
    // All four edits are visible in the built ROM.
    const variTruth = dacValues(patchVariRecord(base, "defender", 0x1D, saw), "defender", 0x1D);
    expect(eqSeq(dacValues(custom, "defender", 0x21), variTruth)).toBe(true);  // VARI slot
    expect(readGWaveRecord(custom, "defender", 0x05)).toEqual(hbdv);            // GWAVE SVTAB override
    expect(readWaveform(custom, "defender", 4)).toEqual(wfBytes);               // waveform override
    expect(readPattern(custom, "defender", 0x47, patBytes.length)).toEqual(patBytes); // pattern override
  });

  it("rejects an out-of-range offset, empty/oversized bytes, or overrun past GFRTAB", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    expect(() => buildCustomRom(base, "defender", [], { patternOverrides: { 256: [1] } })).toThrow(/range/i);
    expect(() => buildCustomRom(base, "defender", [], { patternOverrides: { 0: [] } })).toThrow(/bytes/i);
    // Defender max-end = 169.  Override at offset 100 with 100 bytes would end at 200 > 169.
    expect(() => buildCustomRom(base, "defender", [], { patternOverrides: { 100: Array.from({ length: 100 }, () => 0) } })).toThrow(/GFRTAB|past/i);
    // out-of-range byte
    expect(() => buildCustomRom(base, "defender", [], { patternOverrides: { 0: [256] } })).toThrow(/range/i);
  });
});

describe("Added waveforms (Phase 5 step 4) — GWVTAB relocation", () => {
  // Helper: a 16-byte test waveform with a distinct shape so the kernel's
  // output is unambiguously the user's bytes, not a stock waveform.
  const TEST_WAVE_16 = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
                       0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0, 0xFF];

  it("with no added waveforms, GWVTAB stays at its original address (no LDX patch)", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const custom = buildCustomRom(base, "defender", [{ kind: "vari", code: 0x1D, record: REC }]);
    // The LDX operand at LDX_GWVTAB_LOC + 1 still points at GWVTAB_BASE.
    const opOff = (LDX_GWVTAB_LOC.defender + 1) - 0xF800;
    expect((custom[opOff]! << 8) | custom[opOff + 1]!).toBe(GWVTAB_BASE.defender);
  });

  it("with 1 added waveform, GWVTAB is relocated and LDX is repointed", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const custom = buildCustomRom(base, "defender", [], { addedWaveforms: [TEST_WAVE_16] });
    const opOff = (LDX_GWVTAB_LOC.defender + 1) - 0xF800;
    const newAddr = (custom[opOff]! << 8) | custom[opOff + 1]!;
    // Relocated right after the stock 3-row VVECT (27 bytes).
    expect(newAddr).toBe(VVECT_BASE.defender + 27);
    // The first byte at the new GWVTAB address is the length byte for idx 0 (GS2 = 8).
    expect(custom[newAddr - 0xF800]).toBe(8);
  });

  it("idx 7 reads the user's added waveform bytes — verified via SVTAB+WAVE# nybble", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // Build a project with one added wave at idx 7, and override BBSV ($05)
    // to set WAVE# = 7 so its SVTAB record reads our new wave.
    const bbsvBase = readGWaveRecord(base, "defender", 0x05);
    const bbsv7 = [...bbsvBase];
    bbsv7[1] = (bbsvBase[1]! & 0xF0) | 0x7; // keep GECDEC hi-nybble, set WAVE# = 7
    const custom = buildCustomRom(
      base, "defender",
      [{ kind: "gwave", cmd: 0x05, record: bbsv7 }],
      { addedWaveforms: [TEST_WAVE_16] },
    );
    // Walk to idx 7 in the relocated GWVTAB and confirm the bytes.
    const opOff = (LDX_GWVTAB_LOC.defender + 1) - 0xF800;
    const newAddr = (custom[opOff]! << 8) | custom[opOff + 1]!;
    // Walk: 7 stock entries occupy 159 bytes, idx 7 starts at offset 159.
    const idx7LenAt = newAddr - 0xF800 + 159;
    expect(custom[idx7LenAt]).toBe(16);
    expect(Array.from(custom.slice(idx7LenAt + 1, idx7LenAt + 17))).toEqual(TEST_WAVE_16);
    // And the rendered command produces a non-stock DAC trace.
    expect(eqSeq(dacValues(custom, "defender", 0x05), dacValues(base, "defender", 0x05))).toBe(false);
  });

  it("VARI slots + added waveform: VVECT before the relocated GWVTAB; both work", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // 4 VARI rows (codes $1D..$20) — push maxRow to 3 → VVECT extent = 36 bytes.
    const sawRec = readVariRecord(base, "defender", 0x1D);
    const custom = buildCustomRom(
      base, "defender",
      [
        { kind: "vari", code: 0x1D, record: sawRec },
        { kind: "vari", code: 0x20, record: sawRec }, // requires mask widen
      ],
      { addedWaveforms: [TEST_WAVE_16] },
    );
    const opOff = (LDX_GWVTAB_LOC.defender + 1) - 0xF800;
    const newAddr = (custom[opOff]! << 8) | custom[opOff + 1]!;
    // VVECT now occupies max(27, 4*9) = 36 bytes; new GWVTAB right after.
    expect(newAddr).toBe(VVECT_BASE.defender + 36);
    // Mask was widened ($20 > $1F).
    expect(custom[(0xFCBD + 2) - 0xF800]).toBe(0x3F);
    // VARI at $20 still works (plays SAW).
    const variTruth = dacValues(patchVariRecord(base, "defender", 0x1D, sawRec), "defender", 0x1D);
    expect(eqSeq(dacValues(custom, "defender", 0x20), variTruth)).toBe(true);
  });

  it("throws 'Won't fit' when VVECT + new GWVTAB exceeds the free region", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // Pile on a high VARI code AND multiple added waves to overflow the
    // 215-byte Defender region.  Code $30 → row $13 → VVECT extent 180 bytes;
    // stock GWVTAB 159; 1 added wave 17 → 180 + 159 + 17 = 356, overrun 141.
    const sawRec = readVariRecord(base, "defender", 0x1D);
    expect(() =>
      buildCustomRom(
        base, "defender",
        [{ kind: "vari", code: 0x30, record: sawRec }],
        { addedWaveforms: [TEST_WAVE_16] },
      ),
    ).toThrow(/Won't fit|over by/i);
  });

  it("rejects more than 9 added waveforms (WAVE# is a 4-bit nybble)", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const tenWaves = Array.from({ length: 10 }, () => TEST_WAVE_16);
    expect(() => buildCustomRom(base, "defender", [], { addedWaveforms: tenWaves })).toThrow(/9 added|nybble/i);
  });
});

describe("computeBudget — Designer ROM-space indicator", () => {
  // The free region matches `GWVTAB_BASE - VVECT_BASE` per game; we
  // pin these as documented constants so the Designer's indicator and
  // the builder's "Won't fit" math share one source of truth.
  it("free region matches the documented per-game capacity", () => {
    expect(computeBudget("defender", []).freeRegion).toBe(215);
    expect(computeBudget("stargate", []).freeRegion).toBe(271);
    expect(computeBudget("robotron", []).freeRegion).toBe(298);
  });

  it("empty project = 27-byte VVECT floor, GWVTAB not relocated, fits", () => {
    const b = computeBudget("defender", []);
    expect(b.vvectBytes).toBe(27);
    expect(b.gwvtabBytes).toBe(0);
    expect(b.used).toBe(27);
    expect(b.relocated).toBe(false);
    expect(b.overrun).toBeLessThan(0); // 27 - 215 = -188 free
  });

  it("VARI slots push VVECT extent: code $25 = row $08 → 81 B (3 stock floor only when ≤ 27 B)", () => {
    const dummy = new Array(9).fill(0);
    // Single slot at $25 → row $08 → (8+1)*9 = 81 B
    const b = computeBudget("defender", [
      { kind: "vari", code: 0x25, record: dummy },
    ]);
    expect(b.vvectBytes).toBe(81);
    expect(b.used).toBe(81);
    expect(b.relocated).toBe(false);
  });

  it("added waveforms relocate GWVTAB: 1×16-byte wave = 27 + 159 + 17 = 203 B on Defender", () => {
    const wave16 = new Array(16).fill(0x80);
    const b = computeBudget("defender", [], { addedWaveforms: [wave16] });
    expect(b.vvectBytes).toBe(27);
    expect(b.gwvtabBytes).toBe(159 + 17); // stock 159 + (1 length byte + 16 samples)
    expect(b.used).toBe(203);
    expect(b.relocated).toBe(true);
    expect(b.overrun).toBe(203 - 215); // 12 bytes free
  });

  it("overruns are reported as positive `overrun`: 2×16-byte waves on Defender = 5 B over", () => {
    const wave16 = new Array(16).fill(0x80);
    const b = computeBudget("defender", [], { addedWaveforms: [wave16, wave16] });
    // 27 + 159 + 17 + 17 = 220 vs 215 free region
    expect(b.used).toBe(220);
    expect(b.overrun).toBe(5);
  });

  it("matches buildCustomRom's free-region check: indicator agrees with the 'Won't fit' error", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const sawRec = readVariRecord(base, "defender", 0x1D);
    const wave16 = new Array(16).fill(0x80);
    // Configuration that throws: VARI $30 (row $13, VVECT 180 B) + 1 added wave (17 B) + stock GWVTAB (159 B).
    const slots = [{ kind: "vari" as const, code: 0x30, record: sawRec }];
    const opts = { addedWaveforms: [wave16] };
    const b = computeBudget("defender", slots, opts);
    expect(b.overrun).toBeGreaterThan(0);
    expect(() => buildCustomRom(base, "defender", slots, opts)).toThrow(/over by/i);
  });
});

describe("LFSR slots (Phase 7)", () => {
  it("rejects an LFSR override at a code that isn't editable", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "lfsr", cmd: 0x39, record: [1, 2, 3] }])).toThrow(/editable/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "lfsr", cmd: 0x12, record: [1, 2] }])).toThrow(/editable/i);
  });
  it("rejects duplicate LFSR overrides and malformed records", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [
      { kind: "lfsr", cmd: 0x11, record: [1, 3] }, { kind: "lfsr", cmd: 0x11, record: [1, 3] },
    ])).toThrow(/duplicate/i);
    // LITE has 2 fields; 3 is wrong.
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "lfsr", cmd: 0x11, record: [1, 2, 3] }])).toThrow(/2 values/i);
    // TURBO's NFRQ1 is 16-bit; 0x10000 is out of range.
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "lfsr", cmd: 0x14, record: [32, 1, 0x10000, 255] }])).toThrow(/range/i);
  });
  it("LFSR-only builds don't touch the command mask or VVECT", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const out = buildCustomRom(base, "defender", [{ kind: "lfsr", cmd: 0x11, record: [0x05, 0x08] }]);
    // The mask operand ($1F) and the VVECT table stay exactly as the base ROM.
    const maskOff = (() => { for (let i = 0; i <= base.length - 3; i++) if (base[i] === 0x43 && base[i + 1] === 0x84 && base[i + 2] === 0x1F) return i + 2; return -1; })();
    expect(out[maskOff]).toBe(0x1F);
    const vvOff = VVECT_BASE.defender - (0x10000 - base.length);
    expect(Array.from(out.subarray(vvOff, vvOff + 27))).toEqual(Array.from(base.subarray(vvOff, vvOff + 27)));
  });

  for (const game of ["defender", "robotron"] as GameKind[]) {
    it(`an LFSR slot's command plays its edited record on the real ${game} ROM`, () => {
      if (!haveRom(game)) return;
      const base = loadRom(game);
      // Ground truth: patch the caller operands directly and render.
      const edited = game === "defender" ? [0x05, 0x08] : [0x40, 0x60, 0x80];
      const cmd = game === "defender" ? 0x11 : 0x15;
      const truth = dacValues(patchLfsrRecord(base, game, cmd, edited), game, cmd);
      const built = buildCustomRom(base, game, [{ kind: "lfsr", cmd, record: edited }]);
      expect(eqSeq(dacValues(built, game, cmd), truth)).toBe(true);
      // And it actually differs from the stock sound.
      expect(eqSeq(dacValues(built, game, cmd), dacValues(base, game, cmd))).toBe(false);
    });
  }

  it("LAUNCH ($39) is editable only on Robotron", () => {
    if (haveRom("robotron")) {
      const base = loadRom("robotron");
      const built = buildCustomRom(base, "robotron", [{ kind: "lfsr", cmd: 0x39, record: [0x10, 0x20, 0x30] }]);
      expect(readLfsrRecord(built, "robotron", 0x39)).toEqual([0x10, 0x20, 0x30]);
    }
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "lfsr", cmd: 0x39, record: [1, 2, 3] }])).toThrow(/editable/i);
  });

  it("mixes with VARI + GWAVE slots in one build", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const gw = readGWaveRecord(base, "defender", 0x01);
    const built = buildCustomRom(base, "defender", [
      { kind: "vari", code: 0x20, record: saw },
      { kind: "gwave", cmd: 0x01, record: gw },
      { kind: "lfsr", cmd: 0x14, record: [0x10, 0x02, 0x0040, 0x80] },
    ]);
    expect(readLfsrRecord(built, "defender", 0x14)).toEqual([0x10, 0x02, 0x0040, 0x80]);
    // VARI mask was widened for code $20.
    const maskOff = (() => { for (let i = 0; i <= base.length - 3; i++) if (base[i] === 0x43 && base[i + 1] === 0x84 && base[i + 2] === 0x1F) return i + 2; return -1; })();
    expect(built[maskOff]).toBe(0x3F);
  });
});

describe("FNOISE slots (Phase 8)", () => {
  it("rejects a non-editable FNOISE command (BG1 on Defender) + duplicates + malformed", () => {
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "fnoise", cmd: 0x0F, record: [0] }])).toThrow(/editable/i);
    expect(() => buildCustomRom(synth("defender"), "defender", [
      { kind: "fnoise", cmd: 0x16, record: [3] }, { kind: "fnoise", cmd: 0x16, record: [3] },
    ])).toThrow(/duplicate/i);
    // THRUST on Defender has 1 field; 4 is wrong.
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "fnoise", cmd: 0x16, record: [1, 2, 3, 4] }])).toThrow(/value/i);
  });

  it("Robotron HBOMB ($3E) is editable; Defender has no FNTAB so it isn't", () => {
    if (haveRom("robotron")) {
      const base = loadRom("robotron");
      const built = buildCustomRom(base, "robotron", [{ kind: "fnoise", cmd: 0x3E, record: [0, 0, 0, 0x20, 0x0200] }]);
      expect(readFnoiseRecord(built, "robotron", 0x3E)).toEqual([0, 0, 0, 0x20, 0x0200]);
    }
    expect(() => buildCustomRom(synth("defender"), "defender", [{ kind: "fnoise", cmd: 0x3E, record: [0] }])).toThrow(/editable/i);
  });

  const fnoiseCases: { game: GameKind; cmd: number; rec: number[] }[] = [
    { game: "defender", cmd: 0x17, rec: [0, 0, 0x20, 0x0100] },
    { game: "robotron", cmd: 0x17, rec: [0, 0x10, 0, 0x40, 0x0200] },
  ];
  for (const { game, cmd, rec } of fnoiseCases) {
    it(`an FNOISE slot's command plays its edited record on the real ${game} ROM`, () => {
      if (!haveRom(game)) return;
      const base = loadRom(game);
      const truth = dacValues(patchFnoiseRecord(base, game, cmd, rec), game, cmd);
      const built = buildCustomRom(base, game, [{ kind: "fnoise", cmd, record: rec }]);
      expect(eqSeq(dacValues(built, game, cmd), truth)).toBe(true);
      expect(eqSeq(dacValues(built, game, cmd), dacValues(base, game, cmd))).toBe(false);
    });
  }

  it("mixes with VARI + GWAVE + LFSR slots in one build (Defender)", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const built = buildCustomRom(base, "defender", [
      { kind: "vari", code: 0x20, record: saw },
      { kind: "gwave", cmd: 0x01, record: readGWaveRecord(base, "defender", 0x01) },
      { kind: "lfsr", cmd: 0x14, record: [0x10, 0x02, 0x0040, 0x80] },
      { kind: "fnoise", cmd: 0x17, record: [0, 0, 0x10, 0x0080] },
    ]);
    expect(readFnoiseRecord(built, "defender", 0x17)).toEqual([0, 0, 0x10, 0x0080]);
  });
});
