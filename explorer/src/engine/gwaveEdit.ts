/**
 * GWAVE sound-editor core (Designer mode, Phase 5 step 1) — headless, DOM-free.
 *
 * GWAVE is a wavetable synth with envelope + pitch-contour player; each command
 * is defined by a **7-byte SVTAB record** + (indexed) GWVTAB waveform bytes +
 * (offset+length) GFRTAB pitch-pattern bytes. This step covers SVTAB record
 * read/patch only — waveform / pattern byte editing land in steps 2 and 3.
 *
 * SVTAB record layout (7 bytes; bytes 0 and 1 are nybble-packed):
 *
 *   byte 0  hi nybble  GECHO    echo count (0..15)
 *           lo nybble  GCCNT    cycles per frequency note (0..15)
 *   byte 1  hi nybble  GECDEC   echo decay (0..15)
 *           lo nybble  WAVE#    waveform index into GWVTAB (0..6 of 7 stock waves)
 *   byte 2             PRDECA   pre-decay factor (unsigned, 0..255)
 *   byte 3             GDFINC   frequency delta increment (signed −128..127)
 *   byte 4             GDCNT    count before freq delta kicks in (unsigned)
 *   byte 5             PATLEN   pitch-pattern length (bytes read from GFRTAB)
 *   byte 6             PATOFF   pattern offset into GFRTAB (low byte)
 *
 * Override-in-place model: a GWAVE slot patches the base game's SVTAB entry for
 * a chosen command code; firing that code in Explore plays the user's edit.
 * Unlike VARI (own-item-list at new codes $1D+), GWAVE has no equivalent of the
 * 5→6-bit mask widen — its dispatcher is a hardcoded branch tree on Defender/
 * Stargate (`JMPTBL` on Robotron), so adding new GWAVE codes is a v-future item
 * (see `plans/designer-mode.md` § Phase 5 deferrals).  This module never
 * extends SVTAB — it only rewrites existing rows.
 */
import type { GameKind } from "../board/soundboard.ts";

/** Start address of each game's `SVTAB` table (from the label-map JSON). */
export const SVTAB_BASE: Record<GameKind, number> = {
  defender: 0xFEEC,
  stargate: 0xFEEA,
  robotron: 0xFE45,
};

/** Each SVTAB parameter record is 7 bytes. */
export const SVTAB_STRIDE = 7;

/**
 * Start address of each game's `GWVTAB` (the table of 7 stock waveforms).
 * Layout in every game is identical — a sequence of `length-byte, …samples`
 * records, walked by `GWLD2`/`GWLD3` to look up a waveform by index.  Each
 * record's sample bytes are exactly `length` long; total table = 159 bytes
 * (verified against the real Defender ROM + the SVTAB-following-GWVTAB span
 * in the label-map JSON).
 */
export const GWVTAB_BASE: Record<GameKind, number> = {
  defender: 0xFE4D,
  stargate: 0xFE4B,
  robotron: 0xFD32,
};

/** Display name of each stock waveform (0..6), in GWVTAB order. */
export const STOCK_WAVE_NAMES: readonly string[] = ["GS2", "GSSQ2", "GS1", "GS12", "GSQ22", "GS72", "GS1.7"];

/** Length (sample bytes) of each stock waveform — fixed; lengths don't change in Step 2. */
export const STOCK_WAVE_LENGTHS: readonly number[] = [8, 8, 16, 16, 16, 72, 16];

/**
 * Offset of each waveform's *sample* bytes within GWVTAB (skipping its
 * leading length byte).  Derived from `STOCK_WAVE_LENGTHS`: each waveform
 * occupies `length+1` bytes starting at the previous waveform's end.
 *
 *   idx | sample-byte offset | sample-byte span
 *    0  |  1                 |  [1..8]    (8 bytes, GS2)
 *    1  | 10                 |  [10..17]  (8 bytes, GSSQ2)
 *    2  | 19                 |  [19..34]  (16 bytes, GS1)
 *    3  | 36                 |  [36..51]  (16 bytes, GS12)
 *    4  | 53                 |  [53..68]  (16 bytes, GSQ22)
 *    5  | 70                 |  [70..141] (72 bytes, GS72)
 *    6  | 143                |  [143..158] (16 bytes, GS1.7)
 */
export const STOCK_WAVE_SAMPLE_OFFSETS: readonly number[] = (() => {
  const out: number[] = [];
  let p = 0;
  for (const len of STOCK_WAVE_LENGTHS) {
    out.push(p + 1); // skip the length byte
    p += 1 + len;
  }
  return out;
})();

export interface GWaveField {
  /** Stable identifier (lowercase). */
  key: string;
  /** Display label, matching the ROM symbol. */
  label: string;
  /** Byte offset within the 7-byte record. */
  byteOffset: number;
  /** "byte" = whole byte; "hi-nybble" / "lo-nybble" = packed half-byte. */
  packing: "byte" | "hi-nybble" | "lo-nybble";
  /** Whether the ROM treats the value as signed (display hint only). */
  signed: boolean;
  min: number;
  max: number;
  /** Tooltip text for the editor. */
  help: string;
}

/** Nine logical fields packed into the seven SVTAB bytes. */
export const GWAVE_FIELDS: readonly GWaveField[] = [
  { key: "gecho", label: "GECHO", byteOffset: 0, packing: "hi-nybble", signed: false, min: 0, max: 15,
    help: "Echo count — how many decayed plays of the waveform after the first. Larger = more echoes." },
  { key: "gccnt", label: "GCCNT", byteOffset: 0, packing: "lo-nybble", signed: false, min: 0, max: 15,
    help: "Cycles per frequency-note — how many wave cycles play before advancing one byte of the pitch pattern. Larger = slower pitch sweep." },
  { key: "gecdec", label: "GECDEC", byteOffset: 1, packing: "hi-nybble", signed: false, min: 0, max: 15,
    help: "Echo decay — how much amplitude drops between echoes (subtracted per sample, in 1/16ths of the original)." },
  { key: "wave", label: "WAVE#", byteOffset: 1, packing: "lo-nybble", signed: false, min: 0, max: 6,
    help: "Waveform index — picks one of the 7 stock waves in GWVTAB (0=GS2, 1=GSSQ2, 2=GS1, 3=GS12, 4=GSQ22, 5=GS72, 6=GS1.7). Higher indices read past the stock waves; usually not what you want." },
  { key: "prdeca", label: "PRDECA", byteOffset: 2, packing: "byte", signed: false, min: 0, max: 0xFF,
    help: "Pre-decay factor — at load, the RAM waveform copy is decayed by (length>>4)·PRDECA per sample. 0 = no decay, larger = harder distortion (wraps mod-256 to produce the characteristic math-error timbre)." },
  { key: "gdfinc", label: "GDFINC", byteOffset: 3, packing: "byte", signed: true, min: 0, max: 0xFF,
    help: "Frequency delta increment (signed) — added to the base frequency every GDCNT samples to glide pitch over time. 0 = constant pitch." },
  { key: "gdcnt", label: "GDCNT", byteOffset: 4, packing: "byte", signed: false, min: 0, max: 0xFF,
    help: "Count between frequency-delta applications. Larger = slower glide." },
  { key: "patlen", label: "PATLEN", byteOffset: 5, packing: "byte", signed: false, min: 0, max: 0xFF,
    help: "Pitch-pattern length — how many bytes of GFRTAB to read as the pitch contour." },
  { key: "patoff", label: "PATOFF", byteOffset: 6, packing: "byte", signed: false, min: 0, max: 0xFF,
    help: "Pattern offset into GFRTAB — low byte of the address where the pattern starts. (High byte is implicit GFRTAB-page.)" },
];

export interface GWaveCommand {
  /** Raw command code the game CPU sends. */
  cmd: number;
  /** Row index into SVTAB (record = base + row*7). */
  row: number;
  /** ROM routine name. */
  name: string;
}

// Editable GWAVE commands per game.  Codes $01–$0D dispatch through GWLD to
// SVTAB row = cmd − 1 on all three games.  Excluded:
//   - $12 (BON2 / BONV): handler jumps mid-routine and re-uses freq-mod only;
//     editing its 7 bytes wouldn't have a clean effect (analogous to VARI
//     excluding SP1/CABSHK $0E).
//   - Robotron extras $20–$2B: route through JMPTBL to specific SVTAB rows we
//     haven't tabulated yet — out of scope for v1 of the GWAVE editor.
const COMMANDS_BASE: readonly GWaveCommand[] = [
  { cmd: 0x01, row: 0,  name: "HBDV" },
  { cmd: 0x02, row: 1,  name: "STDV" },
  { cmd: 0x03, row: 2,  name: "DP1V" },
  { cmd: 0x04, row: 3,  name: "XBV" },
  { cmd: 0x05, row: 4,  name: "BBSV" },
  { cmd: 0x06, row: 5,  name: "HBEV" },
  { cmd: 0x07, row: 6,  name: "PROTV" },
  { cmd: 0x08, row: 7,  name: "SPNRV" },
  { cmd: 0x09, row: 8,  name: "CLDWNV" },
  { cmd: 0x0A, row: 9,  name: "SV3" },
  { cmd: 0x0B, row: 10, name: "ED10" },
  { cmd: 0x0C, row: 11, name: "ED12" },
  { cmd: 0x0D, row: 12, name: "ED17" },
];

const COMMANDS: Record<GameKind, readonly GWaveCommand[]> = {
  defender: COMMANDS_BASE,
  stargate: COMMANDS_BASE,
  robotron: COMMANDS_BASE,
};

export function gwaveCommandsFor(game: GameKind): GWaveCommand[] {
  return COMMANDS[game].map((c) => ({ ...c }));
}

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/** Byte offset into the ROM array of a command's SVTAB record. */
function recordOffset(rom: Uint8Array, game: GameKind, cmd: number): number {
  const entry = COMMANDS[game].find((c) => c.cmd === cmd);
  if (!entry) {
    throw new Error(`$${cmd.toString(16).toUpperCase()} is not an editable GWAVE command on ${game}`);
  }
  const off = (SVTAB_BASE[game] + entry.row * SVTAB_STRIDE) - romBase(rom);
  if (off < 0 || off + SVTAB_STRIDE > rom.length) {
    throw new Error(`SVTAB record for $${cmd.toString(16)} falls outside the ${game} ROM`);
  }
  return off;
}

/** Read a command's 7-byte SVTAB record from a raw ROM image. */
export function readGWaveRecord(rom: Uint8Array, game: GameKind, cmd: number): number[] {
  const off = recordOffset(rom, game, cmd);
  return Array.from(rom.subarray(off, off + SVTAB_STRIDE));
}

/** Return a copy of `rom` with the command's SVTAB record replaced. */
export function patchGWaveRecord(
  rom: Uint8Array,
  game: GameKind,
  cmd: number,
  record: readonly number[],
): Uint8Array {
  if (record.length !== SVTAB_STRIDE) {
    throw new Error(`SVTAB record must be exactly ${SVTAB_STRIDE} bytes, got ${record.length}`);
  }
  for (const b of record) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
      throw new Error(`SVTAB record byte out of range (0..255): ${b}`);
    }
  }
  const off = recordOffset(rom, game, cmd);
  const out = rom.slice();
  out.set(record, off);
  return out;
}

/** Read a logical (possibly nybble-packed) field's value from a 7-byte record. */
export function getField(record: readonly number[], field: GWaveField): number {
  const b = record[field.byteOffset]! & 0xFF;
  if (field.packing === "hi-nybble") return (b >> 4) & 0x0F;
  if (field.packing === "lo-nybble") return b & 0x0F;
  return b;
}

/** Return a copy of `record` with one logical field set (nybble-aware). */
export function setField(record: readonly number[], field: GWaveField, value: number): number[] {
  const v = Math.round(value);
  if (v < field.min || v > field.max) {
    throw new Error(`${field.label} value ${v} out of range ${field.min}..${field.max}`);
  }
  const out = [...record];
  const cur = out[field.byteOffset]! & 0xFF;
  if (field.packing === "hi-nybble") {
    out[field.byteOffset] = (((v & 0x0F) << 4) | (cur & 0x0F)) & 0xFF;
  } else if (field.packing === "lo-nybble") {
    out[field.byteOffset] = ((cur & 0xF0) | (v & 0x0F)) & 0xFF;
  } else {
    out[field.byteOffset] = v & 0xFF;
  }
  return out;
}

// ─── Waveform bytes (GWVTAB) — Phase 5 step 2 ──────────────────────────────

/** Throw on invalid waveform index. */
function assertWaveIdx(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > 6) {
    throw new Error(`waveform idx out of range 0..6: ${idx}`);
  }
}

/** Byte offset into the ROM array of waveform `idx`'s first sample byte. */
function waveformOffset(rom: Uint8Array, game: GameKind, idx: number): number {
  assertWaveIdx(idx);
  const off = (GWVTAB_BASE[game] + STOCK_WAVE_SAMPLE_OFFSETS[idx]!) - romBase(rom);
  const len = STOCK_WAVE_LENGTHS[idx]!;
  if (off < 0 || off + len > rom.length) {
    throw new Error(`Waveform ${idx} (${STOCK_WAVE_NAMES[idx]}) falls outside the ${game} ROM`);
  }
  return off;
}

/** Read one of the 7 stock waveforms' sample bytes from a raw ROM image. */
export function readWaveform(rom: Uint8Array, game: GameKind, idx: number): number[] {
  const off = waveformOffset(rom, game, idx);
  return Array.from(rom.subarray(off, off + STOCK_WAVE_LENGTHS[idx]!));
}

/**
 * Return a copy of `rom` with waveform `idx`'s sample bytes replaced.  The
 * replacement must be exactly the stock waveform's length — Step 2 never
 * changes table lengths, so `length+1`-bytes-per-record walking in GWLD2/3
 * stays valid and SVTAB byte-6 pattern offsets aren't touched.
 */
export function patchWaveform(
  rom: Uint8Array,
  game: GameKind,
  idx: number,
  bytes: readonly number[],
): Uint8Array {
  assertWaveIdx(idx);
  const expected = STOCK_WAVE_LENGTHS[idx]!;
  if (bytes.length !== expected) {
    throw new Error(`Waveform ${idx} (${STOCK_WAVE_NAMES[idx]}) must be exactly ${expected} bytes, got ${bytes.length}`);
  }
  for (const b of bytes) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
      throw new Error(`Waveform byte out of range (0..255): ${b}`);
    }
  }
  const off = waveformOffset(rom, game, idx);
  const out = rom.slice();
  out.set(bytes, off);
  return out;
}

/**
 * Which editable GWAVE commands ($01..$0D) on `game` currently reference
 * waveform `idx` in their SVTAB record's WAVE# nybble.  Drives the
 * "Shared by" warning in the Designer canvas: editing a stock waveform
 * affects *every* command pointing at it, not just the slot the user is
 * currently editing.
 */
export function waveformUsers(rom: Uint8Array, game: GameKind, idx: number): GWaveCommand[] {
  assertWaveIdx(idx);
  const out: GWaveCommand[] = [];
  for (const c of COMMANDS[game]) {
    const rec = readGWaveRecord(rom, game, c.cmd);
    const wave = rec[1]! & 0x0F; // low nybble of byte 1
    if (wave === idx) out.push({ ...c });
  }
  return out;
}
