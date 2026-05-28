/**
 * RADIO sound-editor core (Designer mode, Phase 9).
 *
 * RADIO ($18, all three games) is a 16-byte wavetable phase-accumulator with a
 * single tunable scalar (the initial frequency, an `LDX #imm` in the routine).
 * The editable "record" is `[freq, ...16 wavetable bytes]` (length 17):
 *   - record[0]    = FREQ, the 16-bit `LDX #imm` operand at RADIO_BASE + 5 (BE)
 *   - record[1..16] = the 16 RADSND LUT bytes
 *
 * Addresses verified against the real ROMs + label-map JSON (see the RADIO
 * spike in `research/findings_designer_feasibility.md`).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import type { GameKind } from "../src/board/soundboard.ts";
import {
  RADSND_BASE, RADSND_LEN, RADIO_BASE, RADIO_RECORD_LEN,
  radioCommandsFor, readRadioRecord, patchRadioRecord,
} from "../src/engine/radioEdit.ts";

const REPO = pathResolve(__dirname, "..");
const romBaseFor = (size: number): number => 0x10000 - size;
const blankRom = (game: GameKind): Uint8Array =>
  new Uint8Array(game === "robotron" ? 0x1000 : 0x800).fill(0xAA);

const STOCK_LUT = [0x8C, 0x5B, 0xB6, 0x40, 0xBF, 0x49, 0xA4, 0x73, 0x73, 0xA4, 0x49, 0xBF, 0x40, 0xB6, 0x5B, 0x8C];
const STOCK_FREQ = 0x0064;

/** Place a known FREQ (at RADIO_BASE+5) + LUT (at RADSND_BASE) in a synthetic ROM. */
function place(rom: Uint8Array, game: GameKind, freq: number, lut: number[]): void {
  const rb = romBaseFor(rom.length);
  rom[(RADIO_BASE[game] + 5) - rb] = (freq >> 8) & 0xFF;
  rom[(RADIO_BASE[game] + 6) - rb] = freq & 0xFF;
  rom.set(lut, RADSND_BASE[game] - rb);
}

describe("RADIO addresses match the generated label-map JSON", () => {
  for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
    it(game, () => {
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      if (!existsSync(p)) return;
      const map = JSON.parse(readFileSync(p, "utf8")) as { labels: { label: string; addr: number }[] };
      expect(map.labels.find((l) => l.label === "RADIO")!.addr).toBe(RADIO_BASE[game]);
      expect(map.labels.find((l) => l.label === "RADSND")!.addr).toBe(RADSND_BASE[game]);
    });
  }
});

describe("radioCommandsFor", () => {
  it("exposes a single $18 RADIO command on every game", () => {
    for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
      expect(radioCommandsFor(game)).toEqual([{ cmd: 0x18, name: "RADIO" }]);
    }
  });
});

describe("readRadioRecord / patchRadioRecord (synthetic ROM)", () => {
  it("reads [freq, ...16 LUT bytes]", () => {
    for (const game of ["defender", "stargate", "robotron"] as GameKind[]) {
      const rom = blankRom(game);
      place(rom, game, STOCK_FREQ, STOCK_LUT);
      const rec = readRadioRecord(rom, game);
      expect(rec).toHaveLength(RADIO_RECORD_LEN);
      expect(rec[0]).toBe(STOCK_FREQ);
      expect(rec.slice(1)).toEqual(STOCK_LUT);
    }
  });

  it("round-trips a patch (freq 16-bit BE + LUT bytes)", () => {
    const rom = blankRom("defender");
    place(rom, "defender", STOCK_FREQ, STOCK_LUT);
    const before = rom.slice();
    const newLut = STOCK_LUT.map((b) => (b ^ 0x0F) & 0xFF);
    const out = patchRadioRecord(rom, "defender", [0x0140, ...newLut]);
    expect(readRadioRecord(out, "defender")).toEqual([0x0140, ...newLut]);
    expect(rom).toEqual(before); // input untouched
    const rb = romBaseFor(rom.length);
    expect(out[(RADIO_BASE.defender + 5) - rb]).toBe(0x01); // freq hi
    expect(out[(RADIO_BASE.defender + 6) - rb]).toBe(0x40); // freq lo
  });

  it("rejects wrong-length records + out-of-range values", () => {
    const rom = blankRom("defender");
    place(rom, "defender", STOCK_FREQ, STOCK_LUT);
    expect(() => patchRadioRecord(rom, "defender", [0x64, ...STOCK_LUT.slice(0, 15)])).toThrow(); // 16 long
    expect(() => patchRadioRecord(rom, "defender", [0x10000, ...STOCK_LUT])).toThrow(); // freq > 16-bit
    expect(() => patchRadioRecord(rom, "defender", [0x64, 256, ...STOCK_LUT.slice(1)])).toThrow(); // byte > 255
  });

  it("RADSND_LEN is 16", () => {
    expect(RADSND_LEN).toBe(16);
    expect(RADIO_RECORD_LEN).toBe(17);
  });
});

describe("real ROM (golden)", () => {
  for (const game of ["defender", "robotron"] as GameKind[]) {
    it(`reads stock FREQ + LUT from the real ${game} ROM`, () => {
      const p = pathResolve(REPO, `public/roms/${game}_sound.bin`);
      if (!existsSync(p)) return;
      const rom = new Uint8Array(readFileSync(p));
      const rec = readRadioRecord(rom, game);
      expect(rec[0]).toBe(STOCK_FREQ);          // LDX #$0064
      expect(rec.slice(1)).toEqual(STOCK_LUT);  // the mirrored 16-byte LUT
    });
  }
});
