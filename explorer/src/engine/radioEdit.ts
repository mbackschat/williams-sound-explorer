/**
 * RADIO sound-editor core (Designer mode, Phase 9) — headless, DOM-free.
 *
 * RADIO ($18, all three games) is a 16-byte wavetable phase-accumulator — the
 * cleanest of the inline-immediate engines. Each iteration adds a running
 * "freq" to a 16-bit accumulator; the accumulator's high-byte low nybble
 * indexes a 16-entry LUT (`RADSND`); when the high byte carries, the freq
 * climbs (rising pitch). Defender's "credit accepted" / hyperspace whoosh.
 *
 * Two things are editable, both pure in-place byte patches (no relocation, no
 * dispatcher change — $18 is already wired):
 *   - the **16 RADSND LUT bytes** (a click-to-draw wavetable), and
 *   - **FREQ** — the initial frequency, a 16-bit `LDX #imm` operand at
 *     `RADIO_BASE + 5` (big-endian; $0064 = 100 stock on every game).
 *
 * The editable "record" bundles both as `[freq, ...16 LUT bytes]` (length 17),
 * so a RADIO slot is the same shape the other engines use (a `number[]` record
 * with `start`/A-B, JSON round-trip, and `.bin` reconstruction all uniform).
 * Addresses verified against the real ROMs + label-map JSON — see the RADIO
 * spike in `research/findings_designer_feasibility.md`.
 */
import type { GameKind } from "../board/soundboard.ts";

/** Start of the 16-byte `RADSND` wavetable LUT (from the label-map JSON). */
export const RADSND_BASE: Record<GameKind, number> = {
  defender: 0xFD9A,
  stargate: 0xFD60,
  robotron: 0xFC47,
};
export const RADSND_LEN = 16;

/** Start of the RADIO routine; the FREQ immediate (`LDX #imm`) sits at +5 (BE). */
export const RADIO_BASE: Record<GameKind, number> = {
  defender: 0xF9A6,
  stargate: 0xF9A6,
  robotron: 0xF82B,
};
/** Offset of the FREQ operand (the `LDX #imm` value) from `RADIO_BASE`. */
const FREQ_OFFSET = 5;

/** Record = `[freq, ...16 LUT bytes]`. */
export const RADIO_RECORD_LEN = 1 + RADSND_LEN; // 17

export interface RadioCommand {
  cmd: number;
  name: string;
}

export function radioCommandsFor(_game: GameKind): RadioCommand[] {
  return [{ cmd: 0x18, name: "RADIO" }];
}

function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/** Validate that both the FREQ operand and the LUT fall inside the ROM image. */
function checkBounds(rom: Uint8Array, game: GameKind): void {
  const rb = romBase(rom);
  const freqOff = (RADIO_BASE[game] + FREQ_OFFSET) - rb;
  const lutOff = RADSND_BASE[game] - rb;
  if (freqOff < 0 || freqOff + 2 > rom.length || lutOff < 0 || lutOff + RADSND_LEN > rom.length) {
    throw new Error(`RADIO record falls outside the ${game} ROM`);
  }
}

/** Read RADIO's editable record: `[freq, ...16 LUT bytes]`. */
export function readRadioRecord(rom: Uint8Array, game: GameKind): number[] {
  checkBounds(rom, game);
  const rb = romBase(rom);
  const freqOff = (RADIO_BASE[game] + FREQ_OFFSET) - rb;
  const lutOff = RADSND_BASE[game] - rb;
  const freq = ((rom[freqOff]! << 8) | rom[freqOff + 1]!) & 0xFFFF;
  return [freq, ...Array.from(rom.subarray(lutOff, lutOff + RADSND_LEN))];
}

/** Return a copy of `rom` with RADIO's FREQ operand + LUT bytes replaced. */
export function patchRadioRecord(rom: Uint8Array, game: GameKind, record: readonly number[]): Uint8Array {
  if (record.length !== RADIO_RECORD_LEN) {
    throw new Error(`RADIO record must be exactly ${RADIO_RECORD_LEN} values (freq + 16 LUT bytes), got ${record.length}`);
  }
  const freq = record[0]!;
  if (!Number.isInteger(freq) || freq < 0 || freq > 0xFFFF) {
    throw new Error(`RADIO FREQ ${freq} out of range 0..65535`);
  }
  for (let i = 1; i < record.length; i++) {
    const b = record[i]!;
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
      throw new Error(`RADIO LUT byte out of range (0..255): ${b}`);
    }
  }
  checkBounds(rom, game);
  const rb = romBase(rom);
  const out = rom.slice();
  const freqOff = (RADIO_BASE[game] + FREQ_OFFSET) - rb;
  out[freqOff] = (freq >> 8) & 0xFF;
  out[freqOff + 1] = freq & 0xFF;
  out.set(record.slice(1), RADSND_BASE[game] - rb);
  return out;
}
