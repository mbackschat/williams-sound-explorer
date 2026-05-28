/**
 * LFSR sound-editor core (Designer mode, Phase 7).
 *
 * `engine/lfsrEdit.ts` is the headless, DOM-free patch logic for the LFSR
 * noise family (LITE / APPEAR / TURBO / LAUNCH).  Unlike VARI + GWAVE — whose
 * parameters live in a fixed-stride ROM table — the LFSR parameters are
 * *immediate operands in the caller routine's code*: each per-sound entry point
 * pre-loads the shared LITEN/NOISE kernel's working registers with a short run
 * of `LDAA/LDAB/LDX #<imm>` writes before branching in.  The editor's "record"
 * is therefore a *virtual* one: a per-command list of logical field values read
 * from / written to specific operand bytes at known caller addresses.
 *
 * The caller addresses + operand offsets are verified against the real ROMs and
 * the generated label-map JSON, so these tests double as a regression gate on
 * the ROM facts the editor depends on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import {
  LFSR_CALLER_BASE,
  lfsrCommandsFor,
  lfsrFieldsFor,
  readLfsrRecord,
  patchLfsrRecord,
} from "../src/engine/lfsrEdit.ts";

const REPO = pathResolve(__dirname, "..");

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
const romBaseFor = (size: number): number => 0x10000 - size;

const blankRom = (game: GameKind): Uint8Array =>
  new Uint8Array(game === "robotron" ? 0x1000 : 0x800).fill(0xAA);

/** The real caller byte sequences decoded from the ROMs (operand bytes in place). */
const CALLER_BYTES: Record<GameKind, Record<number, number[]>> = {
  defender: {
    0x11: [0x86, 0x01, 0x97, 0x1A, 0xC6, 0x03, 0x20, 0x0A],
    0x15: [0x86, 0xFE, 0x97, 0x1A, 0x86, 0xC0, 0xC6, 0x10, 0x20, 0x00],
    0x14: [0x86, 0x20, 0x97, 0x15, 0x97, 0x18, 0x86, 0x01, 0xCE, 0x00, 0x01, 0xC6, 0xFF, 0x20],
  },
  stargate: {
    0x11: [0x86, 0x01, 0x97, 0x1A, 0xC6, 0x03, 0x20, 0x0A],
    0x15: [0x86, 0xFE, 0x97, 0x1A, 0x86, 0xC0, 0xC6, 0x10, 0x20, 0x00],
    0x14: [0x86, 0x20, 0x97, 0x15, 0x97, 0x18, 0x86, 0x01, 0xCE, 0x00, 0x01, 0xC6, 0xFF, 0x20],
  },
  robotron: {
    0x11: [0x86, 0x01, 0x97, 0x19, 0xC6, 0x03, 0x20, 0x0A],
    0x15: [0x86, 0xFE, 0x97, 0x19, 0x86, 0xC0, 0xC6, 0x10, 0x20, 0x00],
    0x14: [0x86, 0x20, 0x97, 0x14, 0x97, 0x17, 0x86, 0x01, 0xCE, 0x00, 0x01, 0xC6, 0xFF, 0x20],
    0x39: [0x86, 0xFF, 0x97, 0x19, 0x86, 0x60, 0xC6, 0xFF, 0x20, 0x12],
  },
};

/** Write a command's real caller byte sequence into a synthetic ROM. */
function placeCaller(rom: Uint8Array, game: GameKind, cmd: number): void {
  const off = LFSR_CALLER_BASE[game]![cmd]! - romBaseFor(rom.length);
  rom.set(CALLER_BYTES[game]![cmd]!, off);
}

describe("LFSR caller addresses match the generated label-map JSON", () => {
  const SYMBOL: Record<number, string> = { 0x11: "LITE", 0x14: "TURBO", 0x15: "APPEAR", 0x39: "LAUNCH" };
  for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
    it(game, () => {
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      if (!existsSync(p)) return; // pre-build state — skip
      const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
      for (const cmd of Object.keys(LFSR_CALLER_BASE[game]).map(Number)) {
        const sym = map.labels.find((l) => l.label === SYMBOL[cmd]);
        expect(sym, `${game} labelmap has ${SYMBOL[cmd]}`).toBeDefined();
        expect(sym!.addr).toBe(LFSR_CALLER_BASE[game][cmd]);
      }
    });
  }
});

describe("lfsrCommandsFor", () => {
  it("Defender/Stargate expose LITE, TURBO, APPEAR (no LAUNCH)", () => {
    for (const game of ["defender", "stargate"] as GameKind[]) {
      expect(lfsrCommandsFor(game).map((c) => c.cmd)).toEqual([0x11, 0x14, 0x15]);
      expect(lfsrCommandsFor(game).map((c) => c.name)).toEqual(["LITE", "TURBO", "APPEAR"]);
    }
  });
  it("Robotron adds LAUNCH ($39)", () => {
    expect(lfsrCommandsFor("robotron").map((c) => c.cmd)).toEqual([0x11, 0x14, 0x15, 0x39]);
    expect(lfsrCommandsFor("robotron").find((c) => c.cmd === 0x39)!.name).toBe("LAUNCH");
  });
  it("returns copies (mutating the result doesn't leak back)", () => {
    const a = lfsrCommandsFor("defender");
    a[0]!.name = "MUT";
    expect(lfsrCommandsFor("defender")[0]!.name).toBe("LITE");
  });
});

describe("lfsrFieldsFor — per-command virtual record layout", () => {
  it("LITE has 2 fields: DFREQ (signed), CYCNT", () => {
    const f = lfsrFieldsFor("defender", 0x11);
    expect(f.map((x) => x.key)).toEqual(["dfreq", "cycnt"]);
    expect(f[0]!.signed).toBe(true);
    expect(f.every((x) => x.width === 1)).toBe(true);
  });
  it("APPEAR has 3 fields: DFREQ, LFREQ_start, CYCNT", () => {
    expect(lfsrFieldsFor("defender", 0x15).map((x) => x.key)).toEqual(["dfreq", "lfreq", "cycnt"]);
  });
  it("LAUNCH (Robotron) has 3 fields, same shape as APPEAR", () => {
    expect(lfsrFieldsFor("robotron", 0x39).map((x) => x.key)).toEqual(["dfreq", "lfreq", "cycnt"]);
  });
  it("TURBO has 4 fields incl. NFRQ1 as one 16-bit BE field", () => {
    const f = lfsrFieldsFor("defender", 0x14);
    expect(f.map((x) => x.key)).toEqual(["cycnt_nfflg", "decay", "nfrq1", "namp"]);
    const nfrq1 = f.find((x) => x.key === "nfrq1")!;
    expect(nfrq1.width).toBe(2);
    expect(nfrq1.max).toBe(0xFFFF);
  });
  it("throws for a non-editable command (LAUNCH on Defender)", () => {
    expect(() => lfsrFieldsFor("defender", 0x39)).toThrow();
    expect(() => lfsrFieldsFor("defender", 0x12)).toThrow();
  });
});

describe("readLfsrRecord / patchLfsrRecord (synthetic ROM)", () => {
  it("reads field values from the placed caller bytes", () => {
    const rom = blankRom("defender");
    placeCaller(rom, "defender", 0x11);
    expect(readLfsrRecord(rom, "defender", 0x11)).toEqual([1, 3]);
    placeCaller(rom, "defender", 0x15);
    expect(readLfsrRecord(rom, "defender", 0x15)).toEqual([254, 192, 16]);
    placeCaller(rom, "defender", 0x14);
    expect(readLfsrRecord(rom, "defender", 0x14)).toEqual([32, 1, 1, 255]);
  });

  it("round-trips a patch (only the operand bytes change)", () => {
    const rom = blankRom("defender");
    placeCaller(rom, "defender", 0x14);
    const before = rom.slice();
    const out = patchLfsrRecord(rom, "defender", 0x14, [0x10, 0x08, 0x0102, 0x40]);
    expect(readLfsrRecord(out, "defender", 0x14)).toEqual([0x10, 0x08, 0x0102, 0x40]);
    // The opcodes between operands are untouched; the input ROM is not mutated.
    expect(rom).toEqual(before);
    const off = LFSR_CALLER_BASE.defender[0x14]! - romBaseFor(rom.length);
    expect(out[off]).toBe(0x86);       // LDAA opcode unchanged
    expect(out[off + 2]).toBe(0x97);   // STAA opcode unchanged
    expect(out[off + 8]).toBe(0xCE);   // LDX opcode unchanged
    expect(out[off + 9]).toBe(0x01);   // NFRQ1 hi
    expect(out[off + 10]).toBe(0x02);  // NFRQ1 lo
  });

  it("round-trips for every command on Robotron, incl. LAUNCH", () => {
    for (const cmd of [0x11, 0x14, 0x15, 0x39]) {
      const rom = blankRom("robotron");
      placeCaller(rom, "robotron", cmd);
      const rec = readLfsrRecord(rom, "robotron", cmd);
      const bumped = rec.map((v, i) => (lfsrFieldsFor("robotron", cmd)[i]!.width === 2 ? (v + 7) & 0xFFFF : (v + 7) & 0xFF));
      const out = patchLfsrRecord(rom, "robotron", cmd, bumped);
      expect(readLfsrRecord(out, "robotron", cmd)).toEqual(bumped);
    }
  });

  it("rejects a wrong-length record", () => {
    const rom = blankRom("defender");
    placeCaller(rom, "defender", 0x11);
    expect(() => patchLfsrRecord(rom, "defender", 0x11, [1])).toThrow();
    expect(() => patchLfsrRecord(rom, "defender", 0x11, [1, 2, 3])).toThrow();
  });

  it("rejects out-of-range values (byte and 16-bit fields)", () => {
    const rom = blankRom("defender");
    placeCaller(rom, "defender", 0x14);
    expect(() => patchLfsrRecord(rom, "defender", 0x14, [256, 1, 1, 255])).toThrow();
    expect(() => patchLfsrRecord(rom, "defender", 0x14, [32, 1, 0x10000, 255])).toThrow();
    expect(() => patchLfsrRecord(rom, "defender", 0x14, [32, 1, -1, 255])).toThrow();
  });

  it("throws reading/patching a non-editable command", () => {
    const rom = blankRom("defender");
    expect(() => readLfsrRecord(rom, "defender", 0x39)).toThrow();
    expect(() => patchLfsrRecord(rom, "defender", 0x39, [1, 2, 3])).toThrow();
  });
});

describe("real ROM (golden) — when a dev fallback ROM is present", () => {
  it("reads LITE / APPEAR / TURBO from the real Defender sound ROM", () => {
    const p = pathResolve(REPO, "public/roms/defender_sound.bin");
    if (!existsSync(p)) return; // ROMs are user-supplied / gitignored — skip if absent
    const rom = new Uint8Array(readFileSync(p));
    expect(rom.length).toBe(0x800);
    expect(readLfsrRecord(rom, "defender", 0x11)).toEqual([1, 3]);
    expect(readLfsrRecord(rom, "defender", 0x15)).toEqual([254, 192, 16]);
    expect(readLfsrRecord(rom, "defender", 0x14)).toEqual([32, 1, 1, 255]);
  });

  it("reads LAUNCH + the shared sounds from the real Robotron sound ROM", () => {
    const p = pathResolve(REPO, "public/roms/robotron_sound.bin");
    if (!existsSync(p)) return;
    const rom = new Uint8Array(readFileSync(p));
    expect(rom.length).toBe(0x1000);
    expect(readLfsrRecord(rom, "robotron", 0x39)).toEqual([255, 96, 255]);
    expect(readLfsrRecord(rom, "robotron", 0x11)).toEqual([1, 3]);
    expect(readLfsrRecord(rom, "robotron", 0x14)).toEqual([32, 1, 1, 255]);
  });
});
