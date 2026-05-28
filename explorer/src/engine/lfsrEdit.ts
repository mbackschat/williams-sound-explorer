/**
 * LFSR sound-editor core (Designer mode, Phase 7) — headless, DOM-free.
 *
 * The LFSR noise family — LITE (lightning), APPEAR (enemy-appear descent),
 * TURBO (turbo burst), and Robotron's LAUNCH — is data-driven like VARI and
 * GWAVE, but with one structural twist: **its parameters are immediate operands
 * in the caller's code, not entries in a fixed-stride ROM table.**
 *
 * Each per-sound entry point pre-loads the shared kernel's working registers
 * with a short run of `LDAA/LDAB/LDX #<imm>` writes, then `BRA`s into the
 * kernel (`LITEN` / `NOISE`, renamed `MOISE` on Robotron).  So "editing" a
 * sound = rewriting those operand bytes in place — no assembler, no table
 * relocation, no dispatcher change (the command codes are already wired).
 *
 * The editor's "record" is therefore a *virtual* one: a per-command ordered
 * list of logical field values, each mapped to a specific operand byte (or, for
 * TURBO's 16-bit NFRQ1, a big-endian byte pair) at a known offset from the
 * caller's base address.  Offsets are uniform across all three games — only the
 * caller base addresses differ — and were verified by disassembling the real
 * ROMs (see `research/findings_designer_feasibility.md` § LFSR):
 *
 *   LITE   $11   86 01 | 97 1A | C6 03 | 20 0A
 *                DFREQ@+1            CYCNT@+5
 *   APPEAR $15   86 FE | 97 1A | 86 C0 | C6 10 | 20 00
 *                DFREQ@+1   LFREQ@+5  CYCNT@+7
 *   LAUNCH $39   86 FF | 97 19 | 86 60 | C6 FF | 20 12   (Robotron only)
 *                DFREQ@+1   LFREQ@+5  CYCNT@+7
 *   TURBO  $14   86 20 | 97 .. | 97 .. | 86 01 | CE 00 01 | C6 FF | 20 ..
 *                CYCNT_NFFLG@+1   DECAY@+7  NFRQ1@+9(BE)  NAMP@+12
 *
 * LITE deliberately exposes only DFREQ + CYCNT: its `LFREQ_start` is the *same*
 * operand byte as DFREQ (A falls into LITEN holding $01), so surfacing a third
 * slider would just write the same byte twice — the editor shows each sound's
 * *actual* operands, not a forced superset.
 */
import type { GameKind } from "../board/soundboard.ts";

/**
 * Base address of each per-sound caller routine (from the label-map JSON).
 * Defender + Stargate share addresses; Robotron's are different and add LAUNCH.
 */
export const LFSR_CALLER_BASE: Record<GameKind, Record<number, number>> = {
  defender: { 0x11: 0xF88C, 0x14: 0xF8CD, 0x15: 0xF894 },
  stargate: { 0x11: 0xF88C, 0x14: 0xF8CD, 0x15: 0xF894 },
  robotron: { 0x11: 0xF55A, 0x14: 0xF59B, 0x15: 0xF562, 0x39: 0xF550 },
};

export interface LfsrField {
  /** Stable identifier (lowercase). */
  key: string;
  /** Display label. */
  label: string;
  /** Operand offset within the caller routine, relative to its base address. */
  byteOffset: number;
  /** 1 for a byte immediate, 2 for the 16-bit NFRQ1 (big-endian). */
  width: 1 | 2;
  /** Whether the ROM treats the value as signed (display hint only). */
  signed: boolean;
  min: number;
  max: number;
  /** Tooltip text for the editor. */
  help: string;
}

// Per-command field layouts. Keyed by command code: the operand offsets are
// identical across every game that has the command, so one layout serves all.
export const LFSR_FIELDS: Record<number, readonly LfsrField[]> = {
  // LITE ($11)
  0x11: [
    { key: "dfreq", label: "DFREQ", byteOffset: 1, width: 1, signed: true, min: 0, max: 0xFF,
      help: "Frequency delta added to the LFSR period each cycle (signed). Positive sweeps the pitch up, negative down. Also the kernel's starting frequency for LITE." },
    { key: "cycnt", label: "CYCNT", byteOffset: 5, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Cycle count — how many LFSR steps elapse between frequency updates. Larger = slower sweep." },
  ],
  // TURBO ($14)
  0x14: [
    { key: "cycnt_nfflg", label: "CYCNT/NFFLG", byteOffset: 1, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Shared cycle-count + noise-frequency flag (this one immediate is committed to both CYCNT and NFFLG). Drives how fast TURBO's noise sweeps." },
    { key: "decay", label: "DECAY", byteOffset: 7, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Amplitude decay rate — how quickly the burst fades. Larger = faster fade." },
    { key: "nfrq1", label: "NFRQ1", byteOffset: 9, width: 2, signed: false, min: 0, max: 0xFFFF,
      help: "Initial noise period — the 16-bit starting period of the noise oscillator (big-endian). Smaller = brighter." },
    { key: "namp", label: "NAMP", byteOffset: 12, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Initial amplitude — the burst's starting DAC level before DECAY takes it down." },
  ],
  // APPEAR ($15)
  0x15: [
    { key: "dfreq", label: "DFREQ", byteOffset: 1, width: 1, signed: true, min: 0, max: 0xFF,
      help: "Frequency delta added each cycle (signed). APPEAR uses a negative value for a falling pitch." },
    { key: "lfreq", label: "LFREQ", byteOffset: 5, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Starting LFSR frequency the descent begins from." },
    { key: "cycnt", label: "CYCNT", byteOffset: 7, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Cycle count between frequency updates — sets how long the descent takes." },
  ],
  // LAUNCH ($39, Robotron only) — same shape as APPEAR.
  0x39: [
    { key: "dfreq", label: "DFREQ", byteOffset: 1, width: 1, signed: true, min: 0, max: 0xFF,
      help: "Frequency delta added each cycle (signed)." },
    { key: "lfreq", label: "LFREQ", byteOffset: 5, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Starting LFSR frequency the sweep begins from." },
    { key: "cycnt", label: "CYCNT", byteOffset: 7, width: 1, signed: false, min: 0, max: 0xFF,
      help: "Cycle count between frequency updates — sets the sweep duration." },
  ],
};

export interface LfsrCommand {
  /** Raw command code the game CPU sends. */
  cmd: number;
  /** ROM routine name. */
  name: string;
}

const COMMANDS: Record<GameKind, readonly LfsrCommand[]> = {
  defender: [
    { cmd: 0x11, name: "LITE" },
    { cmd: 0x14, name: "TURBO" },
    { cmd: 0x15, name: "APPEAR" },
  ],
  stargate: [
    { cmd: 0x11, name: "LITE" },
    { cmd: 0x14, name: "TURBO" },
    { cmd: 0x15, name: "APPEAR" },
  ],
  robotron: [
    { cmd: 0x11, name: "LITE" },
    { cmd: 0x14, name: "TURBO" },
    { cmd: 0x15, name: "APPEAR" },
    { cmd: 0x39, name: "LAUNCH" },
  ],
};

export function lfsrCommandsFor(game: GameKind): LfsrCommand[] {
  return COMMANDS[game].map((c) => ({ ...c }));
}

const hex = (n: number): string => `$${n.toString(16).toUpperCase()}`;

/** The editable fields for one command, or throw if it isn't an LFSR command on this game. */
export function lfsrFieldsFor(game: GameKind, cmd: number): readonly LfsrField[] {
  if (LFSR_CALLER_BASE[game][cmd] === undefined) {
    throw new Error(`${hex(cmd)} is not an editable LFSR command on ${game}`);
  }
  return LFSR_FIELDS[cmd]!;
}

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/** Byte offset into the ROM array of a command's caller base, validated in-bounds. */
function callerOffset(rom: Uint8Array, game: GameKind, cmd: number): number {
  const addr = LFSR_CALLER_BASE[game][cmd];
  if (addr === undefined) {
    throw new Error(`${hex(cmd)} is not an editable LFSR command on ${game}`);
  }
  const fields = LFSR_FIELDS[cmd]!;
  const span = Math.max(...fields.map((f) => f.byteOffset + f.width));
  const off = addr - romBase(rom);
  if (off < 0 || off + span > rom.length) {
    throw new Error(`LFSR caller for ${hex(cmd)} falls outside the ${game} ROM`);
  }
  return off;
}

/** Read a command's virtual record (one value per field, in field order). */
export function readLfsrRecord(rom: Uint8Array, game: GameKind, cmd: number): number[] {
  const off = callerOffset(rom, game, cmd);
  return LFSR_FIELDS[cmd]!.map((f) =>
    f.width === 2
      ? ((rom[off + f.byteOffset]! << 8) | rom[off + f.byteOffset + 1]!) & 0xFFFF
      : rom[off + f.byteOffset]! & 0xFF,
  );
}

/** Return a copy of `rom` with the command's operand bytes replaced from `record`. */
export function patchLfsrRecord(
  rom: Uint8Array,
  game: GameKind,
  cmd: number,
  record: readonly number[],
): Uint8Array {
  const off = callerOffset(rom, game, cmd);
  const fields = LFSR_FIELDS[cmd]!;
  if (record.length !== fields.length) {
    throw new Error(`LFSR record for ${hex(cmd)} must be exactly ${fields.length} values, got ${record.length}`);
  }
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const v = record[i]!;
    if (!Number.isInteger(v) || v < f.min || v > f.max) {
      throw new Error(`${f.label} value ${v} out of range ${f.min}..${f.max}`);
    }
  }
  const out = rom.slice();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const v = record[i]!;
    if (f.width === 2) {
      out[off + f.byteOffset] = (v >> 8) & 0xFF;
      out[off + f.byteOffset + 1] = v & 0xFF;
    } else {
      out[off + f.byteOffset] = v & 0xFF;
    }
  }
  return out;
}
