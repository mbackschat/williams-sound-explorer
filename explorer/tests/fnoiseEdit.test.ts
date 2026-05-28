/**
 * FNOISE sound-editor core (Designer mode, Phase 8).
 *
 * FNOISE has a **split personality** across games:
 *  - **Robotron** stores its parameters in a clean 6-byte `FNTAB` data table
 *    at `$F785` (stride 6) — fully data-driven, like VARI's `VVECT`.
 *  - **Defender / Stargate** bake the same parameters into the caller routine's
 *    immediate operands (the LFSR shape) — and only *partially*: CANNON is
 *    fully editable, THRUST exposes only FMAX, and BG1 has no patchable
 *    immediate (its DSFLG is a `CLRA`), so BG1 is omitted on D/S.
 *
 * Offsets are verified here against the real ROMs, so these tests double as a
 * regression gate on the ROM facts the editor depends on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import {
  FNTAB_BASE, FNTAB_STRIDE,
  fnoiseCommandsFor, fnoiseFieldsFor,
  readFnoiseRecord, patchFnoiseRecord,
} from "../src/engine/fnoiseEdit.ts";

const REPO = pathResolve(__dirname, "..");
const romBaseFor = (size: number): number => 0x10000 - size;
const blankRom = (game: GameKind): Uint8Array =>
  new Uint8Array(game === "robotron" ? 0x1000 : 0x800).fill(0xAA);

/** Real ROM byte sequences (operands in place), decoded from the binaries. */
// Robotron FNTAB rows (6 bytes each) at $F785.
const FNTAB_ROWS: Record<number, number[]> = {
  0x0F: [0x00, 0x00, 0x00, 0x01, 0x00, 0x00], // BG1
  0x16: [0x00, 0x00, 0x00, 0x03, 0x00, 0x00], // THRUST
  0x17: [0x01, 0x00, 0x01, 0xFF, 0x03, 0xE8], // CANNON
  0x3E: [0x01, 0x01, 0x01, 0x40, 0x10, 0x00], // HBOMB
};
// Defender/Stargate inline caller byte sequences.
const DS_CALLER_ADDR: Record<number, number> = { 0x16: 0xF91C, 0x17: 0xF923 };
const DS_CALLER_BYTES: Record<number, number[]> = {
  0x16: [0x4F, 0x97, 0x19, 0xC6, 0x03, 0x20, 0x0D],                               // THRUST: FMAX @+4
  0x17: [0x86, 0x01, 0x97, 0x19, 0xCE, 0x03, 0xE8, 0x86, 0x01, 0xC6, 0xFF, 0x20], // CANNON: DSFLG@+1 SAMPC@+5 FDFLG@+8 FMAX@+10
};

function placeRobotron(rom: Uint8Array, cmd: number): void {
  const row = { 0x0F: 0, 0x16: 1, 0x17: 2, 0x3E: 3 }[cmd]!;
  rom.set(FNTAB_ROWS[cmd]!, (FNTAB_BASE.robotron! + row * FNTAB_STRIDE) - romBaseFor(rom.length));
}
function placeDs(rom: Uint8Array, cmd: number): void {
  rom.set(DS_CALLER_BYTES[cmd]!, DS_CALLER_ADDR[cmd]! - romBaseFor(rom.length));
}

describe("FNOISE addresses match the generated label-map JSON", () => {
  it("Robotron FNTAB base", () => {
    const p = pathResolve(REPO, "public/data/robotron_labelmap.json");
    if (!existsSync(p)) return;
    const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
    expect(map.labels.find((l) => l.label === "FNTAB")!.addr).toBe(FNTAB_BASE.robotron);
  });
  for (const game of ["defender", "stargate"] as GameKind[]) {
    it(`${game} inline caller addresses (THRUST / CANNON)`, () => {
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      if (!existsSync(p)) return;
      const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
      expect(map.labels.find((l) => l.label === "THRUST")!.addr).toBe(0xF91C);
      expect(map.labels.find((l) => l.label === "CANNON")!.addr).toBe(0xF923);
    });
  }
});

describe("fnoiseCommandsFor", () => {
  it("Robotron exposes all 4 (BG1 / THRUST / CANNON / HBOMB) via the FNTAB table", () => {
    expect(fnoiseCommandsFor("robotron").map((c) => c.cmd)).toEqual([0x0F, 0x16, 0x17, 0x3E]);
    expect(fnoiseCommandsFor("robotron").every((c) => c.recordKind === "table")).toBe(true);
  });
  it("Defender/Stargate expose THRUST + CANNON inline (BG1 omitted — no patchable immediate)", () => {
    for (const game of ["defender", "stargate"] as GameKind[]) {
      expect(fnoiseCommandsFor(game).map((c) => c.cmd)).toEqual([0x16, 0x17]);
      expect(fnoiseCommandsFor(game).every((c) => c.recordKind === "inline")).toBe(true);
    }
  });
});

describe("fnoiseFieldsFor", () => {
  it("Robotron has 5 logical fields incl. 16-bit SAMPC", () => {
    const f = fnoiseFieldsFor("robotron", 0x17);
    expect(f.map((x) => x.key)).toEqual(["dsflg", "lofrq", "fdflg", "fmax", "sampc"]);
    expect(f.find((x) => x.key === "sampc")!.width).toBe(2);
  });
  it("Defender CANNON has 4 fields (no LOFRQ)", () => {
    expect(fnoiseFieldsFor("defender", 0x17).map((x) => x.key)).toEqual(["dsflg", "fdflg", "fmax", "sampc"]);
  });
  it("Defender THRUST has only FMAX", () => {
    expect(fnoiseFieldsFor("defender", 0x16).map((x) => x.key)).toEqual(["fmax"]);
  });
  it("throws for BG1 on Defender (omitted) + any non-FNOISE command", () => {
    expect(() => fnoiseFieldsFor("defender", 0x0F)).toThrow();
    expect(() => fnoiseFieldsFor("robotron", 0x12)).toThrow();
  });
});

describe("readFnoiseRecord / patchFnoiseRecord — synthetic ROM", () => {
  it("Robotron reads FNTAB rows as logical records", () => {
    const rom = blankRom("robotron");
    placeRobotron(rom, 0x17);
    expect(readFnoiseRecord(rom, "robotron", 0x17)).toEqual([1, 0, 1, 255, 0x03E8]);
    placeRobotron(rom, 0x3E);
    expect(readFnoiseRecord(rom, "robotron", 0x3E)).toEqual([1, 1, 1, 0x40, 0x1000]);
  });
  it("Defender CANNON reads its inline immediates", () => {
    const rom = blankRom("defender");
    placeDs(rom, 0x17);
    // order: dsflg, fdflg, fmax, sampc
    expect(readFnoiseRecord(rom, "defender", 0x17)).toEqual([1, 1, 255, 0x03E8]);
  });
  it("Defender THRUST reads just FMAX", () => {
    const rom = blankRom("defender");
    placeDs(rom, 0x16);
    expect(readFnoiseRecord(rom, "defender", 0x16)).toEqual([3]);
  });
  it("round-trips a Robotron patch (16-bit SAMPC big-endian)", () => {
    const rom = blankRom("robotron");
    placeRobotron(rom, 0x17);
    const out = patchFnoiseRecord(rom, "robotron", 0x17, [0, 0x12, 1, 0x80, 0x1234]);
    expect(readFnoiseRecord(out, "robotron", 0x17)).toEqual([0, 0x12, 1, 0x80, 0x1234]);
    const off = (FNTAB_BASE.robotron! + 2 * FNTAB_STRIDE) - romBaseFor(rom.length);
    expect(out[off + 4]).toBe(0x12); // SAMPC hi
    expect(out[off + 5]).toBe(0x34); // SAMPC lo
  });
  it("round-trips a Defender CANNON patch (operands change, opcodes don't)", () => {
    const rom = blankRom("defender");
    placeDs(rom, 0x17);
    const before = rom.slice();
    const out = patchFnoiseRecord(rom, "defender", 0x17, [0, 0, 0x20, 0x0100]);
    expect(readFnoiseRecord(out, "defender", 0x17)).toEqual([0, 0, 0x20, 0x0100]);
    expect(rom).toEqual(before); // input not mutated
    const base = DS_CALLER_ADDR[0x17]! - romBaseFor(rom.length);
    expect(out[base]).toBe(0x86);     // LDAA opcode unchanged
    expect(out[base + 4]).toBe(0xCE); // LDX opcode unchanged
    expect(out[base + 5]).toBe(0x01); // SAMPC hi
    expect(out[base + 6]).toBe(0x00); // SAMPC lo
  });
  it("rejects wrong-length + out-of-range records", () => {
    const rom = blankRom("robotron");
    placeRobotron(rom, 0x17);
    expect(() => patchFnoiseRecord(rom, "robotron", 0x17, [1, 2, 3])).toThrow();
    expect(() => patchFnoiseRecord(rom, "robotron", 0x17, [256, 0, 0, 0, 0])).toThrow();
    expect(() => patchFnoiseRecord(rom, "robotron", 0x17, [0, 0, 0, 0, 0x10000])).toThrow();
  });
});

describe("cross-game equivalence", () => {
  it("Defender CANNON's logical record matches Robotron CANNON's shared fields", () => {
    // The Robotron source comment literally says CANTB = 'DEFENDER SND #$17'.
    const dr = blankRom("defender"); placeDs(dr, 0x17);
    const rr = blankRom("robotron"); placeRobotron(rr, 0x17);
    const ds = readFnoiseRecord(dr, "defender", 0x17);     // [dsflg, fdflg, fmax, sampc]
    const ro = readFnoiseRecord(rr, "robotron", 0x17);     // [dsflg, lofrq, fdflg, fmax, sampc]
    expect(ds).toEqual([ro[0], ro[2], ro[3], ro[4]]);      // shared fields agree
  });
});

describe("real ROM (golden)", () => {
  it("reads CANNON from the real Defender ROM", () => {
    const p = pathResolve(REPO, "public/roms/defender_sound.bin");
    if (!existsSync(p)) return;
    const rom = new Uint8Array(readFileSync(p));
    expect(readFnoiseRecord(rom, "defender", 0x17)).toEqual([1, 1, 255, 0x03E8]);
    expect(readFnoiseRecord(rom, "defender", 0x16)).toEqual([3]);
  });
  it("reads the FNTAB table from the real Robotron ROM", () => {
    const p = pathResolve(REPO, "public/roms/robotron_sound.bin");
    if (!existsSync(p)) return;
    const rom = new Uint8Array(readFileSync(p));
    expect(readFnoiseRecord(rom, "robotron", 0x0F)).toEqual([0, 0, 0, 1, 0]);
    expect(readFnoiseRecord(rom, "robotron", 0x17)).toEqual([1, 0, 1, 255, 0x03E8]);
    expect(readFnoiseRecord(rom, "robotron", 0x3E)).toEqual([1, 1, 1, 0x40, 0x1000]);
  });
});
