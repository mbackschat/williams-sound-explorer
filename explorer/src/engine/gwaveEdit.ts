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
 * Start address of each game's `GFRTAB` (the freely-laid-out byte arrays the
 * GWAVE kernel reads as **pitch contours**).  Each SVTAB record's byte 6 is
 * the low byte of an offset *into* this table, and byte 5 is the number of
 * bytes to read — so patterns are not "indexed" like waveforms; they're
 * located by raw offset+length and may overlap.  See `readPattern`.
 *
 * The table extends from `GFRTAB_BASE[game]` to just before the 6802 reset
 * vector at `$FFFE`, so the largest usable `(offset, length)` end is
 * `0xFFFE - GFRTAB_BASE[game]`.
 */
export const GFRTAB_BASE: Record<GameKind, number> = {
  defender: 0xFF55,
  stargate: 0xFF53,
  robotron: 0xFF02,
};

/** Last byte index inside `GFRTAB` that's safe to read/write (before the 6802 vectors at $FFFE). */
export function gfrtabMaxEnd(game: GameKind): number {
  return 0xFFFE - GFRTAB_BASE[game];
}

/**
 * CPU address of the `LDX #GWVTAB` immediate-load instruction in `GWLD` —
 * the byte at `[addr]` is the `CE` opcode and `[addr+1..addr+2]` is the
 * big-endian operand pointing at GWVTAB.  Patching the operand to point
 * at a relocated GWVTAB unlocks v-future Step 4 ("new waveforms"): we
 * build a fresh GWVTAB with extra entries appended in the free RADIO/ORGAN
 * region and repoint this one instruction to find it.  Found by scanning
 * each ROM for `CE <GWVTAB hi> <GWVTAB lo>`; exactly one match per game.
 */
export const LDX_GWVTAB_LOC: Record<GameKind, number> = {
  defender: 0xFBA8,
  stargate: 0xFB7E,
  robotron: 0xFA03,
};

/**
 * Default length (sample bytes) used when the user adds a new waveform.
 * 16 matches the most-used stock size (GS1, GS12, GSQ22, GS1.7) and gives
 * a reasonable drawing resolution at the current canvas width.
 */
export const DEFAULT_NEW_WAVE_LENGTH = 16;

/**
 * `WAVE#` (the low nybble of SVTAB byte 1) is a 4-bit field, so a custom
 * ROM can reference up to 16 waveform indices.  The stock 7 occupy idx
 * 0..6; user-added waveforms occupy idx 7..15.
 */
export const MAX_WAVE_IDX = 15;

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
  { key: "wave", label: "WAVE#", byteOffset: 1, packing: "lo-nybble", signed: false, min: 0, max: 15,
    help: "Waveform index — picks the wave the GWAVE kernel reads (0..6 = stock GS2 / GSSQ2 / GS1 / GS12 / GSQ22 / GS72 / GS1.7; 7..15 = user-added waveforms when present). Indices past the table's actual length read garbage; the Designer's '+ New waveform' button only enables values you've populated." },
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

/** Throw if `idx` is outside the WAVE# nybble range (0..15). */
function assertWaveIdx(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > MAX_WAVE_IDX) {
    throw new Error(`waveform idx out of range 0..${MAX_WAVE_IDX}: ${idx}`);
  }
}

/** Throw if `idx` doesn't address a stock waveform (0..6). */
function assertStockIdx(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx > 6) {
    throw new Error(`stock waveform idx out of range 0..6: ${idx} (user-added waveforms live in the project, not the ROM)`);
  }
}

/** Byte offset into the ROM array of stock waveform `idx`'s first sample byte. */
function waveformOffset(rom: Uint8Array, game: GameKind, idx: number): number {
  assertStockIdx(idx);
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
  assertStockIdx(idx);
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

// ─── Pitch-pattern bytes (GFRTAB) — Phase 5 step 3 ────────────────────────

/** Validate a pattern (offset, length) range; throw if out of GFRTAB. */
function patternRange(rom: Uint8Array, game: GameKind, offset: number, length: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xFF) {
    throw new Error(`pattern offset out of range 0..255: ${offset}`);
  }
  if (!Number.isInteger(length) || length < 1 || length > 0xFF) {
    throw new Error(`pattern length out of range 1..255: ${length}`);
  }
  if (offset + length > gfrtabMaxEnd(game)) {
    throw new Error(`pattern at offset ${offset} length ${length} runs past the ${game} GFRTAB end (max end ${gfrtabMaxEnd(game)})`);
  }
  const off = (GFRTAB_BASE[game] + offset) - romBase(rom);
  if (off < 0 || off + length > rom.length) {
    throw new Error(`pattern range falls outside the ${game} ROM`);
  }
  return off;
}

/** Read `length` pitch-modulation bytes starting at GFRTAB+offset. */
export function readPattern(rom: Uint8Array, game: GameKind, offset: number, length: number): number[] {
  const off = patternRange(rom, game, offset, length);
  return Array.from(rom.subarray(off, off + length));
}

/**
 * Return a copy of `rom` with `bytes.length` pitch-modulation bytes written
 * at GFRTAB+offset.  Length is whatever the caller passes (the kernel reads
 * `PATLEN` bytes per SVTAB record, so write whatever the user has drawn);
 * Step 3 does not change any SVTAB byte-5/6 fields, so existing pointers
 * into GFRTAB stay valid.
 */
export function patchPattern(rom: Uint8Array, game: GameKind, offset: number, bytes: readonly number[]): Uint8Array {
  const off = patternRange(rom, game, offset, bytes.length);
  for (const b of bytes) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
      throw new Error(`pattern byte out of range (0..255): ${b}`);
    }
  }
  const out = rom.slice();
  out.set(bytes, off);
  return out;
}

/**
 * Which editable GWAVE commands ($01..$0D) on `game` have a pitch-pattern
 * range that overlaps `[offset, offset+length-1]`.  Drives the "Shared by"
 * warning in the Designer pitch-pattern canvas — patterns address bytes by
 * raw offset+length and may overlap, so editing one byte can affect more
 * than one command.  Commands with `PATLEN = 0` are skipped (no pattern).
 */
export function patternUsers(rom: Uint8Array, game: GameKind, offset: number, length: number): GWaveCommand[] {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xFF) return [];
  if (!Number.isInteger(length) || length < 1) return [];
  const end = offset + length;
  const out: GWaveCommand[] = [];
  for (const c of COMMANDS[game]) {
    const rec = readGWaveRecord(rom, game, c.cmd);
    const cmdLen = rec[5]! & 0xFF;
    const cmdOff = rec[6]! & 0xFF;
    if (cmdLen === 0) continue;
    if (cmdOff < end && cmdOff + cmdLen > offset) out.push({ ...c });
  }
  return out;
}

// ─── Added waveforms (Phase 5 step 4) — extending GWVTAB ──────────────────

/**
 * Build a fresh GWVTAB byte sequence containing the 7 stock waveforms
 * (with any byte overrides applied to idx 0..6) plus the user's added
 * waveforms (`addedWaves`, indexed in order from idx 7 onward).  Format
 * is the same length-prefixed walking layout the kernel expects:
 * `[length, …samples]` records back-to-back.
 *
 * The host (`engine/customRom.ts`) writes the result into the relocated
 * GWVTAB position and patches `LDX #GWVTAB` to point at it.  Stock-idx
 * overrides replace those samples; new waveforms get appended.  Lengths
 * never change for stock idx 0..6 (Step 2's invariant), so the walking
 * positions of those entries are unaffected.
 */
export function buildExtendedGwvtab(
  rom: Uint8Array,
  game: GameKind,
  stockOverrides: Record<number, number[]>,
  addedWaves: number[][],
): number[] {
  const out: number[] = [];
  // Stock 7 entries (with overrides applied).
  for (let idx = 0; idx < 7; idx++) {
    const len = STOCK_WAVE_LENGTHS[idx]!;
    const overridden = stockOverrides[idx];
    const samples = overridden ?? readWaveform(rom, game, idx);
    if (samples.length !== len) {
      throw new Error(`stockOverrides[${idx}] must be exactly ${len} bytes for stock waveform, got ${samples.length}`);
    }
    out.push(len, ...samples);
  }
  // Added entries (idx 7..15).  Length is whatever the user picked
  // (1..255), validated up-front.
  for (let k = 0; k < addedWaves.length; k++) {
    const samples = addedWaves[k]!;
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 0xFF) {
      throw new Error(`addedWaves[${k}] (idx ${7 + k}) must be 1..255 bytes, got ${samples?.length}`);
    }
    for (const b of samples) {
      if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
        throw new Error(`addedWaves[${k}] byte out of range (0..255): ${b}`);
      }
    }
    out.push(samples.length, ...samples);
  }
  return out;
}

/** Byte count of the new GWVTAB given `addedWaves` (stock 159 + 1+len per new). */
export function extendedGwvtabSize(addedWaves: number[][]): number {
  let size = 159; // stock GWVTAB span (verified against the real Defender ROM)
  for (const w of addedWaves) size += 1 + w.length;
  return size;
}

/**
 * Adjust a GWAVE SVTAB record's `WAVE#` low-nybble after removing the
 * user-added waveform at `removedIdx` (must be ≥ 7).
 *
 *   pointed AT `removedIdx` → reset to stock $06 (last stock; safe default).
 *   pointed ABOVE           → decrement by 1 (entries above shifted down).
 *   pointed BELOW           → untouched.
 *
 * Returns a new record (does not mutate input).  Caller is responsible for
 * splicing `addedWaveforms` and re-applying this to every GWAVE slot in
 * the project; the Designer's removal handler is the only call site today.
 */
export function reclampWaveformIdxAfterRemoval(record: number[], removedIdx: number): number[] {
  if (removedIdx < 7) throw new Error(`reclampWaveformIdxAfterRemoval: removedIdx must be ≥ 7 (got ${removedIdx})`);
  if (record.length !== SVTAB_STRIDE) throw new Error(`SVTAB record must be ${SVTAB_STRIDE} bytes (got ${record.length})`);
  const b1 = record[1]!;
  const w = b1 & 0x0F;
  const hi = b1 & 0xF0;
  let newW = w;
  if (w === removedIdx) newW = 6;
  else if (w > removedIdx) newW = w - 1;
  if (newW === w) return [...record];
  const out = [...record];
  out[1] = hi | (newW & 0x0F);
  return out;
}
