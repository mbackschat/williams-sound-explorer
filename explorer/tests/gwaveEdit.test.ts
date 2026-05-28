/**
 * GWAVE sound-editor core (Designer mode, Phase 5 step 1).
 *
 * `engine/gwaveEdit.ts` is the headless, DOM-free ROM-patch logic the GWAVE
 * editor builds on: it reads/writes a command's 7-byte SVTAB parameter record
 * in a raw ROM image.  Nybble-packed fields (GECHO/GCCNT, GECDEC/WAVE#) are
 * surfaced through `getField`/`setField`, so the editor UI can show 9 logical
 * sliders backed by 7 raw bytes.
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
  SVTAB_BASE,
  SVTAB_STRIDE,
  GWAVE_FIELDS,
  gwaveCommandsFor,
  readGWaveRecord,
  patchGWaveRecord,
  getField,
  setField,
} from "../src/engine/gwaveEdit.ts";

const REPO = pathResolve(__dirname, "..");

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
const romBaseFor = (size: number): number => 0x10000 - size;

/** A blank ROM of the right size for a game, with a recognisable fill. */
function blankRom(game: GameKind): Uint8Array {
  const size = game === "robotron" ? 0x1000 : 0x800;
  return new Uint8Array(size).fill(0xAA);
}

/** Write a 7-byte record into a synthetic ROM at the given command's slot. */
function placeRecord(rom: Uint8Array, game: GameKind, cmd: number, rec: number[]): void {
  const row = gwaveCommandsFor(game).find((c) => c.cmd === cmd)!.row;
  const off = (SVTAB_BASE[game] + row * SVTAB_STRIDE) - romBaseFor(rom.length);
  rom.set(rec, off);
}

// Known SVTAB bytes for Defender's HBDV ($01, row 0), verified against the
// real ROM and the `research/findings_defender_sound.md` decoding:
//   GECHO=8, GCCNT=1, GECDEC=2, WAVE#=4 (GSQ22), PRDECA=0, GDFINC=0, GDCNT=0,
//   PATLEN=22, PATOFF=$31.
const HBDV = [0x81, 0x24, 0x00, 0x00, 0x00, 0x16, 0x31];

describe("SVTAB addresses match the generated label-map JSON", () => {
  for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
    it(game, () => {
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      if (!existsSync(p)) return; // pre-build state — skip
      const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
      const svtab = map.labels.find((l) => l.label === "SVTAB");
      expect(svtab, `${game} labelmap has SVTAB`).toBeDefined();
      expect(svtab!.addr).toBe(SVTAB_BASE[game]);
    });
  }
});

describe("gwaveCommandsFor", () => {
  it("lists 13 GWAVE commands ($01–$0D) in row order on every game", () => {
    for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
      const cmds = gwaveCommandsFor(game);
      expect(cmds).toHaveLength(13);
      expect(cmds[0]).toEqual({ cmd: 0x01, row: 0, name: "HBDV" });
      expect(cmds[12]).toEqual({ cmd: 0x0D, row: 12, name: "ED17" });
      // row monotonically = cmd − 1 for the editable band
      for (const c of cmds) expect(c.row).toBe(c.cmd - 1);
    }
  });

  it("excludes BON2/BONV ($12) — bespoke handler, not pure-data-authorable", () => {
    for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
      expect(gwaveCommandsFor(game).some((c) => c.cmd === 0x12)).toBe(false);
    }
  });

  it("excludes Robotron's $20+ extras — out of scope for v1", () => {
    expect(gwaveCommandsFor("robotron").some((c) => c.cmd >= 0x20)).toBe(false);
  });
});

describe("GWAVE_FIELDS", () => {
  it("has 9 logical fields spanning the 7 SVTAB bytes (bytes 0 and 1 packed)", () => {
    expect(GWAVE_FIELDS).toHaveLength(9);
    const covered = new Set<number>();
    for (const f of GWAVE_FIELDS) covered.add(f.byteOffset);
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("packs GECHO/GCCNT into byte 0 (hi/lo nybble) and GECDEC/WAVE# into byte 1", () => {
    const f = (label: string) => GWAVE_FIELDS.find((x) => x.label === label)!;
    expect(f("GECHO")).toMatchObject({ byteOffset: 0, packing: "hi-nybble", min: 0, max: 15 });
    expect(f("GCCNT")).toMatchObject({ byteOffset: 0, packing: "lo-nybble", min: 0, max: 15 });
    expect(f("GECDEC")).toMatchObject({ byteOffset: 1, packing: "hi-nybble", min: 0, max: 15 });
    expect(f("WAVE#")).toMatchObject({ byteOffset: 1, packing: "lo-nybble", min: 0, max: 6 });
  });

  it("every field has help text for tooltips", () => {
    for (const f of GWAVE_FIELDS) expect(f.help.length).toBeGreaterThan(0);
  });
});

describe("readGWaveRecord / patchGWaveRecord (synthetic ROM)", () => {
  it("reads the 7 bytes at base + row*stride", () => {
    const rom = blankRom("defender");
    placeRecord(rom, "defender", 0x05, HBDV); // put HBDV bytes in BBSV's slot
    expect(readGWaveRecord(rom, "defender", 0x05)).toEqual(HBDV);
  });

  it("patch returns a copy: original ROM is untouched", () => {
    const rom = blankRom("defender");
    placeRecord(rom, "defender", 0x01, HBDV);
    const edited = patchGWaveRecord(rom, "defender", 0x01, [1, 2, 3, 4, 5, 6, 7]);
    expect(edited).not.toBe(rom);
    expect(readGWaveRecord(rom, "defender", 0x01)).toEqual(HBDV);                  // original intact
    expect(readGWaveRecord(edited, "defender", 0x01)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("patch rewrites only the 7 target bytes", () => {
    const rom = blankRom("defender");
    const edited = patchGWaveRecord(rom, "defender", 0x0A, HBDV);
    let diff = 0;
    for (let i = 0; i < rom.length; i++) if (rom[i] !== edited[i]) diff++;
    expect(diff).toBe(7);
  });

  it("round-trips: patching with the bytes just read is a no-op", () => {
    const rom = blankRom("robotron");
    placeRecord(rom, "robotron", 0x0D, [9, 8, 7, 6, 5, 4, 3]);
    const same = patchGWaveRecord(rom, "robotron", 0x0D, readGWaveRecord(rom, "robotron", 0x0D));
    expect([...same]).toEqual([...rom]);
  });

  it("rejects an unknown / excluded GWAVE command", () => {
    const rom = blankRom("defender");
    expect(() => readGWaveRecord(rom, "defender", 0x1D)).toThrow(); // VARI code
    expect(() => readGWaveRecord(rom, "defender", 0x12)).toThrow(); // BON2 excluded
    expect(() => readGWaveRecord(rom, "robotron", 0x20)).toThrow(); // Robotron extras out of scope
  });

  it("rejects a record that is not exactly 7 bytes or has out-of-range values", () => {
    const rom = blankRom("defender");
    expect(() => patchGWaveRecord(rom, "defender", 0x01, [1, 2, 3])).toThrow();
    expect(() => patchGWaveRecord(rom, "defender", 0x01, [...HBDV.slice(0, 6), 256])).toThrow();
    expect(() => patchGWaveRecord(rom, "defender", 0x01, [...HBDV.slice(0, 6), -1])).toThrow();
  });
});

describe("getField / setField (nybble-aware)", () => {
  it("reads packed nybbles from byte 0 of HBDV: GECHO=8, GCCNT=1", () => {
    const gecho = GWAVE_FIELDS.find((f) => f.label === "GECHO")!;
    const gccnt = GWAVE_FIELDS.find((f) => f.label === "GCCNT")!;
    expect(getField(HBDV, gecho)).toBe(8);
    expect(getField(HBDV, gccnt)).toBe(1);
  });

  it("reads packed nybbles from byte 1 of HBDV: GECDEC=2, WAVE#=4", () => {
    const gecdec = GWAVE_FIELDS.find((f) => f.label === "GECDEC")!;
    const wave = GWAVE_FIELDS.find((f) => f.label === "WAVE#")!;
    expect(getField(HBDV, gecdec)).toBe(2);
    expect(getField(HBDV, wave)).toBe(4);
  });

  it("reads whole-byte fields straight through", () => {
    const patlen = GWAVE_FIELDS.find((f) => f.label === "PATLEN")!;
    const patoff = GWAVE_FIELDS.find((f) => f.label === "PATOFF")!;
    expect(getField(HBDV, patlen)).toBe(0x16);
    expect(getField(HBDV, patoff)).toBe(0x31);
  });

  it("writing a nybble preserves the other nybble in the same byte", () => {
    const gecho = GWAVE_FIELDS.find((f) => f.label === "GECHO")!;
    const r = setField([...HBDV], gecho, 0xF);
    expect(r[0]).toBe(0xF1); // hi=F (new), lo=1 (kept from HBDV's $81)
    // changing one nybble leaves every other byte untouched
    expect(r.slice(1)).toEqual(HBDV.slice(1));
  });

  it("writing the lo nybble preserves the hi nybble", () => {
    const wave = GWAVE_FIELDS.find((f) => f.label === "WAVE#")!;
    const r = setField([...HBDV], wave, 5);
    expect(r[1]).toBe(0x25); // hi=2 (kept), lo=5 (new)
  });

  it("writing a whole-byte field replaces only that byte", () => {
    const patlen = GWAVE_FIELDS.find((f) => f.label === "PATLEN")!;
    const r = setField([...HBDV], patlen, 0x08);
    expect(r[5]).toBe(0x08);
    expect(r.filter((_, i) => i !== 5)).toEqual(HBDV.filter((_, i) => i !== 5));
  });

  it("rejects out-of-range values per field", () => {
    const wave = GWAVE_FIELDS.find((f) => f.label === "WAVE#")!;
    expect(() => setField(HBDV, wave, 7)).toThrow(); // WAVE# max is 6 (7 stock waves: 0..6)
    const gecho = GWAVE_FIELDS.find((f) => f.label === "GECHO")!;
    expect(() => setField(HBDV, gecho, 16)).toThrow(); // nybble max is 15
  });
});

describe("real ROM (golden) — when a dev fallback ROM is present", () => {
  it("reads HBDV's known bytes from the real Defender sound ROM", () => {
    const p = pathResolve(REPO, "public/roms/defender_sound.bin");
    if (!existsSync(p)) return; // ROMs are user-supplied / gitignored — skip if absent
    const rom = new Uint8Array(readFileSync(p));
    expect(rom.length).toBe(0x800);
    expect(readGWaveRecord(rom, "defender", 0x01)).toEqual(HBDV);
  });
});
