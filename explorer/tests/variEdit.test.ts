/**
 * VARI sound-editor core (Designer mode, v1).
 *
 * `engine/variEdit.ts` is the headless, DOM-free ROM-patch logic the Designer
 * builds on: it reads/writes a command's 9-byte VVECT parameter record in a
 * raw ROM image, and applies a saved recipe (a set of per-command edits) to a
 * base ROM to produce a runnable custom image.
 *
 * The record layout + table addresses are verified against the real ROM source
 * (`VSNDRM*.SRC`) and the generated label-map JSON, so these tests double as a
 * regression gate on the ROM facts the editor depends on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import {
  VVECT_BASE,
  VVECT_STRIDE,
  VARI_FIELDS,
  variCommandsFor,
  readVariRecord,
  patchVariRecord,
  getField,
  setField,
  applyRecipe,
  type VariRecipe,
} from "../src/engine/variEdit.ts";

const REPO = pathResolve(__dirname, "..");

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
const romBaseFor = (size: number): number => 0x10000 - size;

/** A blank ROM of the right size for a game, with a recognisable fill. */
function blankRom(game: GameKind): Uint8Array {
  const size = game === "robotron" ? 0x1000 : 0x800;
  return new Uint8Array(size).fill(0xAA);
}

/** Write a 9-byte record into a synthetic ROM at the given command's slot. */
function placeRecord(rom: Uint8Array, game: GameKind, cmd: number, rec: number[]): void {
  const row = variCommandsFor(game).find((c) => c.cmd === cmd)!.row;
  const off = (VVECT_BASE[game] + row * VVECT_STRIDE) - romBaseFor(rom.length);
  rom.set(rec, off);
}

const SAW = [0x40, 0x01, 0x00, 0x10, 0xE1, 0x00, 0x80, 0xFF, 0xFF];

describe("VVECT addresses match the generated label-map JSON", () => {
  for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
    it(game, () => {
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      if (!existsSync(p)) return; // pre-build state — skip
      const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
      const vvect = map.labels.find((l) => l.label === "VVECT");
      expect(vvect, `${game} labelmap has VVECT`).toBeDefined();
      expect(vvect!.addr).toBe(VVECT_BASE[game]);
    });
  }
});

describe("variCommandsFor", () => {
  it("lists Defender/Stargate VARI commands in row order", () => {
    for (const game of ["defender", "stargate"] as GameKind[]) {
      expect(variCommandsFor(game)).toEqual([
        { cmd: 0x1D, row: 0, name: "SAW" },
        { cmd: 0x1E, row: 1, name: "FOSHIT" },
        { cmd: 0x1F, row: 2, name: "QUASAR" },
      ]);
    }
  });

  it("adds MOSQTO (row 5) for Robotron", () => {
    const cmds = variCommandsFor("robotron");
    expect(cmds).toContainEqual({ cmd: 0x1D, row: 0, name: "SAW" });
    expect(cmds).toContainEqual({ cmd: 0x3F, row: 5, name: "MOSQTO" });
  });

  it("excludes SP1/CABSHK ($0E) — it has bespoke caller code", () => {
    for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
      expect(variCommandsFor(game).some((c) => c.cmd === 0x0E)).toBe(false);
    }
  });
});

describe("VARI_FIELDS", () => {
  it("covers all 9 record bytes across 8 logical fields (SWPDT spans 2)", () => {
    const covered = new Set<number>();
    for (const f of VARI_FIELDS) {
      for (let i = 0; i < f.width; i++) covered.add(f.byteOffset + i);
    }
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(VARI_FIELDS).toHaveLength(8);
  });

  it("marks SWPDT as the single 16-bit field at offset 5", () => {
    const swpdt = VARI_FIELDS.find((f) => f.label === "SWPDT")!;
    expect(swpdt.byteOffset).toBe(5);
    expect(swpdt.width).toBe(2);
    expect(swpdt.max).toBe(0xFFFF);
  });

  it("every field has help text for tooltips", () => {
    for (const f of VARI_FIELDS) expect(f.help.length).toBeGreaterThan(0);
  });
});

describe("readVariRecord / patchVariRecord (synthetic ROM)", () => {
  it("reads the 9 bytes at base + row*stride", () => {
    const rom = blankRom("defender");
    placeRecord(rom, "defender", 0x1E, SAW); // put SAW bytes in FOSHIT's slot
    expect(readVariRecord(rom, "defender", 0x1E)).toEqual(SAW);
  });

  it("patch returns a copy: original ROM is untouched", () => {
    const rom = blankRom("defender");
    placeRecord(rom, "defender", 0x1D, SAW);
    const edited = patchVariRecord(rom, "defender", 0x1D, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(edited).not.toBe(rom);
    expect(readVariRecord(rom, "defender", 0x1D)).toEqual(SAW);          // original intact
    expect(readVariRecord(edited, "defender", 0x1D)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("patch rewrites only the 9 target bytes", () => {
    const rom = blankRom("defender");
    const edited = patchVariRecord(rom, "defender", 0x1F, SAW);
    let diff = 0;
    for (let i = 0; i < rom.length; i++) if (rom[i] !== edited[i]) diff++;
    expect(diff).toBe(9);
  });

  it("round-trips: patching with the bytes just read is a no-op", () => {
    const rom = blankRom("robotron");
    placeRecord(rom, "robotron", 0x3F, [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const same = patchVariRecord(rom, "robotron", 0x3F, readVariRecord(rom, "robotron", 0x3F));
    expect([...same]).toEqual([...rom]);
  });

  it("rejects an unknown VARI command", () => {
    const rom = blankRom("defender");
    expect(() => readVariRecord(rom, "defender", 0x11)).toThrow();
    expect(() => patchVariRecord(rom, "defender", 0x3F, SAW)).toThrow(); // MOSQTO is Robotron-only
  });

  it("rejects a record that is not exactly 9 bytes or has out-of-range values", () => {
    const rom = blankRom("defender");
    expect(() => patchVariRecord(rom, "defender", 0x1D, [1, 2, 3])).toThrow();
    expect(() => patchVariRecord(rom, "defender", 0x1D, [...SAW.slice(0, 8), 256])).toThrow();
  });
});

describe("getField / setField (SWPDT big-endian)", () => {
  const swpdt = VARI_FIELDS.find((f) => f.label === "SWPDT")!;

  it("reads SWPDT as big-endian hi@5/lo@6", () => {
    expect(getField(SAW, swpdt)).toBe(0x0080); // bytes [5,6] = 00,80
  });

  it("writes SWPDT back as big-endian, leaving other bytes alone", () => {
    const rec = setField([...SAW], swpdt, 0x0200);
    expect(rec[5]).toBe(0x02);
    expect(rec[6]).toBe(0x00);
    expect(rec.filter((_, i) => i !== 5 && i !== 6)).toEqual(SAW.filter((_, i) => i !== 5 && i !== 6));
  });

  it("reads/writes a 1-byte field", () => {
    const loper = VARI_FIELDS.find((f) => f.label === "LOPER")!;
    expect(getField(SAW, loper)).toBe(0x40);
    expect(setField([...SAW], loper, 0x12)[0]).toBe(0x12);
  });
});

describe("applyRecipe", () => {
  const recipe = (edits: Record<number, number[]>): VariRecipe => ({
    name: "t", baseGame: "defender", edits, createdAt: 0, updatedAt: 0,
  });

  it("applies every command's edit to a copy of the base ROM", () => {
    const base = blankRom("defender");
    const out = applyRecipe(base, recipe({ 0x1D: SAW, 0x1F: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    expect(out).not.toBe(base);
    expect(readVariRecord(out, "defender", 0x1D)).toEqual(SAW);
    expect(readVariRecord(out, "defender", 0x1F)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(readVariRecord(out, "defender", 0x1E)).toEqual(readVariRecord(base, "defender", 0x1E)); // untouched
  });

  it("is idempotent and order-independent", () => {
    const base = blankRom("defender");
    const a = applyRecipe(base, recipe({ 0x1D: SAW, 0x1F: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    const b = applyRecipe(base, recipe({ 0x1F: [1, 2, 3, 4, 5, 6, 7, 8, 9], 0x1D: SAW }));
    expect([...a]).toEqual([...b]);
    expect([...applyRecipe(a, recipe({ 0x1D: SAW, 0x1F: [1, 2, 3, 4, 5, 6, 7, 8, 9] }))]).toEqual([...a]);
  });
});

describe("real ROM (golden) — when a dev fallback ROM is present", () => {
  it("reads SAW's known bytes from the real Defender sound ROM", () => {
    const p = pathResolve(REPO, "public/roms/defender_sound.bin");
    if (!existsSync(p)) return; // ROMs are user-supplied / gitignored — skip if absent
    const rom = new Uint8Array(readFileSync(p));
    expect(rom.length).toBe(0x800);
    expect(readVariRecord(rom, "defender", 0x1D)).toEqual(SAW);
  });
});
