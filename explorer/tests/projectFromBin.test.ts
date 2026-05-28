/**
 * Phase 6.2: round-trip a CustomProject through `buildCustomRom` → `.bin`
 * bytes → `importBinAsProject` and assert the reconstruction matches.
 *
 * Six detection paths to cover — each tested in isolation + together in a
 * "kitchen sink" round-trip.  Behavioural tests need a real base ROM
 * (`public/roms/*_sound.bin`); they skip if the dev fallback is absent.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import { buildCustomRom, VARI_CMD_BASE, type CustomSlot } from "../src/engine/customRom.ts";
import { readVariRecord } from "../src/engine/variEdit.ts";
import { readGWaveRecord, readWaveform } from "../src/engine/gwaveEdit.ts";
import { importBinAsProject, ROM_SIZE } from "../src/engine/projectFromBin.ts";

const REPO = pathResolve(__dirname, "..");
const romPath = (g: string) => pathResolve(REPO, `public/roms/${g}_sound.bin`);
const haveRom = (g: string) => existsSync(romPath(g));
const loadRom = (g: string) => new Uint8Array(readFileSync(romPath(g)));

describe("importBinAsProject — validation", () => {
  it("rejects a bin whose size doesn't match the game's expected size", () => {
    const base = new Uint8Array(ROM_SIZE.defender);
    const wrongSize = new Uint8Array(ROM_SIZE.defender + 1);
    expect(() => importBinAsProject(wrongSize, base, "defender")).toThrow(/bytes/);
  });

  it("rejects a bin/base size mismatch even when both look plausible", () => {
    const base = new Uint8Array(ROM_SIZE.defender);
    const robotronSize = new Uint8Array(ROM_SIZE.robotron);
    expect(() => importBinAsProject(robotronSize, base, "defender")).toThrow();
  });
});

describe("importBinAsProject — round-trips on the real Defender ROM", () => {
  it("a base ROM (no edits) reconstructs as an empty project", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const project = importBinAsProject(base, base, "defender");
    expect(project.engineBase).toBe("defender");
    expect(project.slots).toEqual([]);
    expect(project.waveformOverrides).toBeUndefined();
    expect(project.patternOverrides).toBeUndefined();
    expect(project.addedWaveforms).toBeUndefined();
  });

  it("a single edited GWAVE row round-trips: BBSV ($05) reconstructs with the edited record", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // Edit BBSV's SVTAB record: bump GECHO/GCCNT byte
    const bbsv = readGWaveRecord(base, "defender", 0x05);
    const edited = [...bbsv];
    edited[0] = (edited[0]! ^ 0x10) & 0xFF; // flip a bit so it diverges
    const slot: CustomSlot = { kind: "gwave", cmd: 0x05, record: edited };
    const bin = buildCustomRom(base, "defender", [slot]);

    const project = importBinAsProject(bin, base, "defender");
    expect(project.slots).toHaveLength(1);
    const got = project.slots[0]!;
    expect(got.kind).toBe("gwave");
    if (got.kind !== "gwave") throw new Error("expected gwave kind");
    expect(got.targetCmd).toBe(0x05);
    expect(got.record).toEqual(edited);
    expect(got.start).toEqual(bbsv); // start = base ROM's stock, not the edit
  });

  it("an edited stock VARI row round-trips: $1D SAW reconstructs with the edited record", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const saw = readVariRecord(base, "defender", 0x1D);
    const edited = [...saw];
    edited[0] = (edited[0]! + 1) & 0xFF;
    const slot: CustomSlot = { kind: "vari", code: 0x1D, record: edited };
    const bin = buildCustomRom(base, "defender", [slot]);

    const project = importBinAsProject(bin, base, "defender");
    expect(project.slots).toHaveLength(1);
    const got = project.slots[0]!;
    if (got.kind !== "vari") throw new Error("expected vari kind");
    expect(got.record).toEqual(edited);
    expect(got.start).toEqual(saw);
  });

  it("a user-added VARI slot (code $20) is reconstructed via mask-widen detection", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const newRec = readVariRecord(base, "defender", 0x1F).map((b) => (b ^ 0x01) & 0xFF);
    const slot: CustomSlot = { kind: "vari", code: 0x20, record: newRec };
    const bin = buildCustomRom(base, "defender", [slot]);

    const project = importBinAsProject(bin, base, "defender");
    // Should see one user-added VARI (row 3 → code $20).  Stock rows $1D..$1F
    // didn't change, so they don't appear in the reconstructed slots.
    expect(project.slots.filter((s) => s.kind === "vari")).toHaveLength(1);
    const v = project.slots[0]!;
    if (v.kind !== "vari") throw new Error("expected vari kind");
    expect(v.record).toEqual(newRec);
    expect(v.name).toMatch(/\$20/);
  });

  it("a stock waveform override (idx 4) round-trips via byte-level diff", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const stock = readWaveform(base, "defender", 4); // GSQ22, 16 bytes
    const edited = stock.map((v) => (v ^ 0x20) & 0xFF);

    // A project with only a waveform override (no slots).
    const bin = buildCustomRom(base, "defender", [], {
      waveformOverrides: { 4: edited },
    });

    const project = importBinAsProject(bin, base, "defender");
    expect(project.waveformOverrides).toBeDefined();
    expect(project.waveformOverrides![4]).toEqual(edited);
  });

  it("an added waveform (idx 7) round-trips via LDX-patch detection + tail-fill stop", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    const addedWave = Array.from({ length: 16 }, (_, i) => (i * 8) & 0xFF);
    const bin = buildCustomRom(base, "defender", [], {
      addedWaveforms: [addedWave],
    });

    const project = importBinAsProject(bin, base, "defender");
    expect(project.addedWaveforms).toBeDefined();
    expect(project.addedWaveforms).toHaveLength(1);
    expect(project.addedWaveforms![0]).toEqual(addedWave);
  });

  it("a pattern override at PATOFF round-trips via SVTAB walk", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");
    // BBSV's SVTAB row points at PATOFF $47 / PATLEN $20 — use exact bytes
    // from the row so we know the offset / length.
    const bbsv = readGWaveRecord(base, "defender", 0x05);
    const patOff = bbsv[6]!;
    const patLen = bbsv[5]!;
    const editedPattern = Array.from({ length: patLen }, (_, i) => (i * 4) & 0xFF);
    const bin = buildCustomRom(base, "defender", [], {
      patternOverrides: { [patOff]: editedPattern },
    });

    const project = importBinAsProject(bin, base, "defender");
    expect(project.patternOverrides).toBeDefined();
    expect(project.patternOverrides![patOff]).toEqual(editedPattern);
  });

  it("kitchen sink — every patch path together round-trips", () => {
    if (!haveRom("defender")) return;
    const base = loadRom("defender");

    // 1 edited GWAVE row, 1 edited stock VARI row, 1 user-added VARI,
    // 1 stock waveform override, 1 added waveform, 1 pattern override.
    const bbsv = readGWaveRecord(base, "defender", 0x05);
    const editedBbsv = bbsv.map((b, i) => i === 0 ? (b ^ 0x10) & 0xFF : b);

    const saw = readVariRecord(base, "defender", 0x1D);
    const editedSaw = saw.map((b, i) => i === 0 ? (b + 2) & 0xFF : b);

    const newVari = readVariRecord(base, "defender", 0x1F).map((b) => (b ^ 0x02) & 0xFF);

    const gsq22 = readWaveform(base, "defender", 4);
    const editedGsq22 = gsq22.map((v) => (v ^ 0x10) & 0xFF);

    const newWave = Array.from({ length: 12 }, (_, i) => (0x80 + i) & 0xFF);

    const patOff = bbsv[6]!;
    const patLen = bbsv[5]!;
    const editedPat = Array.from({ length: patLen }, (_, i) => (i * 3) & 0xFF);

    const slots: CustomSlot[] = [
      { kind: "gwave", cmd: 0x05, record: editedBbsv },
      { kind: "vari", code: 0x1D, record: editedSaw },
      { kind: "vari", code: 0x20, record: newVari },
    ];
    const bin = buildCustomRom(base, "defender", slots, {
      waveformOverrides: { 4: editedGsq22 },
      addedWaveforms: [newWave],
      patternOverrides: { [patOff]: editedPat },
    });

    const project = importBinAsProject(bin, base, "defender");

    // GWAVE edit reconstructed
    const gwaveSlots = project.slots.filter((s) => s.kind === "gwave");
    expect(gwaveSlots).toHaveLength(1);
    expect(gwaveSlots[0]!.record).toEqual(editedBbsv);

    // VARI edits + user-added reconstructed
    const variSlots = project.slots.filter((s) => s.kind === "vari");
    expect(variSlots).toHaveLength(2);
    expect(variSlots[0]!.record).toEqual(editedSaw); // stock $1D edit
    expect(variSlots[1]!.record).toEqual(newVari);   // user-added $20

    // Waveform override
    expect(project.waveformOverrides![4]).toEqual(editedGsq22);

    // Added waveform
    expect(project.addedWaveforms![0]).toEqual(newWave);

    // Pattern override (kitchen sink applies pattern over edited BBSV record,
    // so importer's PATOFF comes from the BIN's BBSV record — which is the
    // edited one; patOff/patLen happen to be unchanged from base in this
    // case since we only edited byte 0).
    expect(project.patternOverrides![patOff]).toEqual(editedPat);
  });
});

describe("importBinAsProject — Stargate + Robotron sanity", () => {
  it("Stargate base ROM (no edits) reconstructs as empty", () => {
    if (!haveRom("stargate")) return;
    const base = loadRom("stargate");
    const project = importBinAsProject(base, base, "stargate");
    expect(project.slots).toEqual([]);
  });

  it("Robotron base ROM (no edits) reconstructs as empty — no mask-widen attempted", () => {
    if (!haveRom("robotron")) return;
    const base = loadRom("robotron");
    const project = importBinAsProject(base, base, "robotron");
    expect(project.slots).toEqual([]);
    // Robotron's mask is $3F at rest — there's no `43 84 1F` pattern to find,
    // so the VARI-extended walk is skipped (which is correct; Robotron's VARI
    // dispatch is non-linear and not supported by buildCustomRom anyway).
  });

  it("Robotron GWAVE override round-trips (no dispatcher widen needed)", () => {
    if (!haveRom("robotron")) return;
    const base = loadRom("robotron");
    const bbsv = readGWaveRecord(base, "robotron", 0x05);
    const edited = [...bbsv];
    edited[0] = (edited[0]! ^ 0x10) & 0xFF;
    const bin = buildCustomRom(base, "robotron", [{ kind: "gwave", cmd: 0x05, record: edited }]);

    const project = importBinAsProject(bin, base, "robotron");
    expect(project.slots).toHaveLength(1);
    if (project.slots[0]!.kind !== "gwave") throw new Error("expected gwave");
    expect(project.slots[0]!.record).toEqual(edited);
  });
});
