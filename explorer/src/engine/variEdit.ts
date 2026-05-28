/**
 * VARI sound-editor core (Designer mode, v1) — headless, DOM-free.
 *
 * A Williams sound is *data*, not bespoke code: a VARI command is just a
 * 9-byte parameter record in the ROM's `VVECT` table that the shared VARI
 * engine kernel consumes (see `research/findings_designer_feasibility.md`).
 * So "designing" a VARI sound = rewriting those 9 bytes — no assembler.
 *
 * This module is the pure layer the Designer builds on:
 *   - read / patch a command's VVECT record in a raw ROM image,
 *   - apply a saved recipe (per-command edits) to a base ROM → custom image.
 * The browser layer (`web/designer/*`) handles UI, audition, and persistence.
 *
 * Record layout (verified against `VSNDRM*.SRC`; SAW = $40 01 00 10 E1 00 80
 * FF FF, whose SWPDT value $0080 proves the 16-bit field is big-endian):
 *
 *   byte 0  LOPER   low-cycle period
 *   byte 1  HIPER   high-cycle period
 *   byte 2  LODT    low-period sweep delta (signed)
 *   byte 3  HIDT    high-period sweep delta (signed)
 *   byte 4  HIEN    high-end threshold
 *   byte 5  SWPDT   sweep-duration countdown, 16-bit big-endian (hi)
 *   byte 6  SWPDT                                              (lo)
 *   byte 7  LOMOD   low-modulation (signed)
 *   byte 8  VAMP    amplitude / DAC output level
 */
import type { GameKind } from "../board/soundboard.ts";

/** Start address of each game's `VVECT` table (from the label-map JSON). */
export const VVECT_BASE: Record<GameKind, number> = {
  defender: 0xFD76,
  stargate: 0xFD3C,
  robotron: 0xFC08,
};

/** Each VARI parameter record is 9 bytes. */
export const VVECT_STRIDE = 9;

export interface VariField {
  /** Stable identifier (lowercase). */
  key: string;
  /** Display label, matching the ROM symbol. */
  label: string;
  /** Offset of this field's first byte within the 9-byte record. */
  byteOffset: number;
  /** 1 for a byte, 2 for the 16-bit SWPDT (big-endian). */
  width: 1 | 2;
  /** Whether the ROM treats the value as signed (display hint only). */
  signed: boolean;
  min: number;
  max: number;
  /** Tooltip text for the editor. */
  help: string;
}

/** The eight editable VARI fields (SWPDT spans bytes 5–6). */
export const VARI_FIELDS: readonly VariField[] = [
  { key: "loper", label: "LOPER", byteOffset: 0, width: 1, signed: false, min: 0, max: 0xFF,
    help: "Low-cycle period — length of the low half of the square wave. With HIPER sets the duty cycle and pitch (larger = lower pitch)." },
  { key: "hiper", label: "HIPER", byteOffset: 1, width: 1, signed: false, min: 0, max: 0xFF,
    help: "High-cycle period — length of the high half of the square wave. With LOPER sets the duty cycle and pitch." },
  { key: "lodt", label: "LODT", byteOffset: 2, width: 1, signed: true, min: 0, max: 0xFF,
    help: "Low-period sweep delta — added to the low period each cycle (signed). Drives the pitch sweep of the low half." },
  { key: "hidt", label: "HIDT", byteOffset: 3, width: 1, signed: true, min: 0, max: 0xFF,
    help: "High-period sweep delta — added to the high period each cycle (signed)." },
  { key: "hien", label: "HIEN", byteOffset: 4, width: 1, signed: false, min: 0, max: 0xFF,
    help: "High-end threshold — the period value at which the sweep stops." },
  { key: "swpdt", label: "SWPDT", byteOffset: 5, width: 2, signed: false, min: 0, max: 0xFFFF,
    help: "Sweep duration — 16-bit countdown (in cycles) before the low-modulation kicks in. Stored big-endian (hi byte first)." },
  { key: "lomod", label: "LOMOD", byteOffset: 7, width: 1, signed: true, min: 0, max: 0xFF,
    help: "Low-modulation — value added to the low period once the sweep completes (signed)." },
  { key: "vamp", label: "VAMP", byteOffset: 8, width: 1, signed: false, min: 0, max: 0xFF,
    help: "Amplitude — the DAC output level for the square wave." },
];

export interface VariCommand {
  /** Raw command code the game CPU sends (as fired in the explorer). */
  cmd: number;
  /** Row index into VVECT (record = base + row*9). */
  row: number;
  /** ROM routine name. */
  name: string;
}

// The user-authorable VARI commands per game, in VVECT row order.  SP1/CABSHK
// ($0E, row 3) is deliberately excluded: it has bespoke caller code that
// recomputes LOPER per trigger, so it is not pure-data-authorable.
const COMMANDS: Record<GameKind, readonly VariCommand[]> = {
  defender: [
    { cmd: 0x1D, row: 0, name: "SAW" },
    { cmd: 0x1E, row: 1, name: "FOSHIT" },
    { cmd: 0x1F, row: 2, name: "QUASAR" },
  ],
  stargate: [
    { cmd: 0x1D, row: 0, name: "SAW" },
    { cmd: 0x1E, row: 1, name: "FOSHIT" },
    { cmd: 0x1F, row: 2, name: "QUASAR" },
  ],
  robotron: [
    { cmd: 0x1D, row: 0, name: "SAW" },
    { cmd: 0x1E, row: 1, name: "FOSHIT" },
    { cmd: 0x1F, row: 2, name: "QUASAR" },
    { cmd: 0x3F, row: 5, name: "MOSQTO" },
  ],
};

export function variCommandsFor(game: GameKind): VariCommand[] {
  return COMMANDS[game].map((c) => ({ ...c }));
}

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/** Byte offset into the ROM array of a command's VVECT record. */
function recordOffset(rom: Uint8Array, game: GameKind, cmd: number): number {
  const entry = COMMANDS[game].find((c) => c.cmd === cmd);
  if (!entry) {
    throw new Error(`$${cmd.toString(16).toUpperCase()} is not an editable VARI command on ${game}`);
  }
  const off = (VVECT_BASE[game] + entry.row * VVECT_STRIDE) - romBase(rom);
  if (off < 0 || off + VVECT_STRIDE > rom.length) {
    throw new Error(`VVECT record for $${cmd.toString(16)} falls outside the ${game} ROM`);
  }
  return off;
}

/** Read a command's 9-byte VVECT record from a raw ROM image. */
export function readVariRecord(rom: Uint8Array, game: GameKind, cmd: number): number[] {
  const off = recordOffset(rom, game, cmd);
  return Array.from(rom.subarray(off, off + VVECT_STRIDE));
}

/** Return a copy of `rom` with the command's VVECT record replaced. */
export function patchVariRecord(
  rom: Uint8Array,
  game: GameKind,
  cmd: number,
  record: readonly number[],
): Uint8Array {
  if (record.length !== VVECT_STRIDE) {
    throw new Error(`VVECT record must be exactly ${VVECT_STRIDE} bytes, got ${record.length}`);
  }
  for (const b of record) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
      throw new Error(`VVECT record byte out of range (0..255): ${b}`);
    }
  }
  const off = recordOffset(rom, game, cmd);
  const out = rom.slice();
  out.set(record, off);
  return out;
}

/** Read a logical field's value from a 9-byte record (SWPDT is big-endian). */
export function getField(record: readonly number[], field: VariField): number {
  if (field.width === 2) {
    return ((record[field.byteOffset]! << 8) | record[field.byteOffset + 1]!) & 0xFFFF;
  }
  return record[field.byteOffset]! & 0xFF;
}

/** Return a copy of `record` with one logical field set (SWPDT big-endian). */
export function setField(record: readonly number[], field: VariField, value: number): number[] {
  const v = Math.round(value);
  if (v < field.min || v > field.max) {
    throw new Error(`${field.label} value ${v} out of range ${field.min}..${field.max}`);
  }
  const out = [...record];
  if (field.width === 2) {
    out[field.byteOffset] = (v >> 8) & 0xFF;
    out[field.byteOffset + 1] = v & 0xFF;
  } else {
    out[field.byteOffset] = v & 0xFF;
  }
  return out;
}

/**
 * A saved Designer project: per-command VVECT edits over a base game.
 * Persisted as JSON — it carries *no* copyrighted ROM bytes, only parameter
 * values, so the runnable image is reconstituted from the user's base ROM.
 */
export interface VariRecipe {
  name: string;
  baseGame: GameKind;
  /** Command code → 9-byte VVECT record. */
  edits: Record<number, number[]>;
  createdAt: number;
  updatedAt: number;
}

/** Apply every edit in a recipe to a copy of `baseRom`, yielding a custom image. */
export function applyRecipe(baseRom: Uint8Array, recipe: VariRecipe): Uint8Array {
  let out: Uint8Array = baseRom.slice();
  for (const [cmd, record] of Object.entries(recipe.edits)) {
    out = patchVariRecord(out, recipe.baseGame, Number(cmd), record);
  }
  return out;
}
