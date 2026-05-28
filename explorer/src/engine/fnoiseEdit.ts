/**
 * FNOISE sound-editor core (Designer mode, Phase 8) — headless, DOM-free.
 *
 * FNOISE (filtered noise / slope-limited DAC walk) has a **split personality**
 * across games — the result of Robotron's source being a later, cleaner rewrite
 * (its `CANTB` record is literally commented "DEFENDER SND #$17"):
 *
 *  - **Robotron** stores each sound's parameters in a clean 6-byte `FNTAB`
 *    record at `$F785` (stride 6) — fully data-driven, like VARI's `VVECT`:
 *    BG1 → row 0, THRUST → row 1, CANNON → row 2, HBOMB → row 3.
 *  - **Defender / Stargate** bake the same parameters into the caller routine's
 *    immediate operands (the LFSR shape), and only *partially*:
 *      - **CANNON** ($17, caller `$F923`) — full: DSFLG@+1, SAMPC@+5 (16-bit BE),
 *        FDFLG@+8, FMAX@+10.
 *      - **THRUST** ($16, caller `$F91C`) — only FMAX@+4 (DSFLG is a `CLRA`).
 *      - **BG1** ($0F) — *no* patchable immediate (DSFLG is `CLRA`, the rest
 *        inherits prior register state), so it is **omitted** on D/S. Editing it
 *        would need to turn a 1-byte `CLRA` into a 2-byte `LDAA #imm` — an
 *        instruction restructure that requires an assembler we don't ship.
 *
 * The editor's "record" is a per-(game, command) ordered list of logical field
 * values (the LFSR pattern). A unified `FnoiseField` descriptor carries a
 * `byteOffset` interpreted relative to the command's *base address*, which is
 * the only thing that differs by game: the FNTAB record on Robotron, the caller
 * routine on Defender/Stargate.
 *
 * Logical fields (canonical order): DSFLG (distortion 0/1), LOFRQ (initial
 * lower-frequency latch — Robotron only), FDFLG (frequency-decay 0/1), FMAX
 * (initial max slope per walk step), SAMPC (16-bit BE sample count between LFSR
 * redraws). D/S inline records expose only the subset their caller sets.
 */
import type { GameKind } from "../board/soundboard.ts";

/** Robotron's `FNTAB` data-table base (Defender/Stargate have no table — inline only). */
export const FNTAB_BASE: Partial<Record<GameKind, number>> = { robotron: 0xF785 };
export const FNTAB_STRIDE = 6;
const FNTAB_ROW: Record<number, number> = { 0x0F: 0, 0x16: 1, 0x17: 2, 0x3E: 3 };

/** Defender/Stargate inline caller addresses (BG1 omitted — no patchable immediate). */
const DS_CALLER_BASE: Record<number, number> = { 0x16: 0xF91C, 0x17: 0xF923 };

export interface FnoiseField {
  key: string;
  label: string;
  /** Offset of this field's first byte relative to the command's base address. */
  byteOffset: number;
  /** 1 for a byte, 2 for the 16-bit SAMPC (big-endian). */
  width: 1 | 2;
  signed: boolean;
  min: number;
  max: number;
  help: string;
}

// Field metadata, shared between the two storage paths.
const DSFLG = (off: number): FnoiseField => ({ key: "dsflg", label: "DSFLG", byteOffset: off, width: 1, signed: false, min: 0, max: 0xFF,
  help: "Distortion flag — 0 = clean slope-walk, 1 = AND the walk with the LFSR's high byte for instantaneous chaos (the 'cannon' grit)." });
const LOFRQ = (off: number): FnoiseField => ({ key: "lofrq", label: "LOFRQ", byteOffset: off, width: 1, signed: false, min: 0, max: 0xFF,
  help: "Initial lower-frequency latch — a side-input to the walker's step rate (Robotron lists this in FNTAB; Defender/Stargate inherit it)." });
const FDFLG = (off: number): FnoiseField => ({ key: "fdflg", label: "FDFLG", byteOffset: off, width: 1, signed: false, min: 0, max: 0xFF,
  help: "Frequency-decay flag — 0 = sustain, 1 = FMAX halves over time so the noise darkens as it fades." });
const FMAX = (off: number): FnoiseField => ({ key: "fmax", label: "FMAX", byteOffset: off, width: 1, signed: false, min: 0, max: 0xFF,
  help: "Initial max slope per walk step — larger = brighter / harsher; smaller = a gentler drone." });
const SAMPC = (off: number): FnoiseField => ({ key: "sampc", label: "SAMPC", byteOffset: off, width: 2, signed: false, min: 0, max: 0xFFFF,
  help: "Sample count between LFSR redraws (16-bit). Larger = the random target updates less often → a coarser, lower texture." });

const ROBOTRON_FIELDS: readonly FnoiseField[] = [DSFLG(0), LOFRQ(1), FDFLG(2), FMAX(3), SAMPC(4)];

// Per-(game, command) field layouts. Robotron: 5 fields into the FNTAB record.
// Defender/Stargate: the subset of immediates their caller actually sets.
const FIELDS: Record<GameKind, Record<number, readonly FnoiseField[]>> = {
  robotron: { 0x0F: ROBOTRON_FIELDS, 0x16: ROBOTRON_FIELDS, 0x17: ROBOTRON_FIELDS, 0x3E: ROBOTRON_FIELDS },
  defender: {
    0x16: [FMAX(4)],
    0x17: [DSFLG(1), FDFLG(8), FMAX(10), SAMPC(5)],
  },
  stargate: {
    0x16: [FMAX(4)],
    0x17: [DSFLG(1), FDFLG(8), FMAX(10), SAMPC(5)],
  },
};

export interface FnoiseCommand {
  cmd: number;
  name: string;
  /** "table" = Robotron FNTAB row; "inline" = Defender/Stargate caller immediates. */
  recordKind: "table" | "inline";
}

const COMMANDS: Record<GameKind, readonly FnoiseCommand[]> = {
  robotron: [
    { cmd: 0x0F, name: "BG1", recordKind: "table" },
    { cmd: 0x16, name: "THRUST", recordKind: "table" },
    { cmd: 0x17, name: "CANNON", recordKind: "table" },
    { cmd: 0x3E, name: "HBOMB", recordKind: "table" },
  ],
  // BG1 ($0F) omitted on Defender/Stargate — it has no patchable immediate.
  defender: [
    { cmd: 0x16, name: "THRUST", recordKind: "inline" },
    { cmd: 0x17, name: "CANNON", recordKind: "inline" },
  ],
  stargate: [
    { cmd: 0x16, name: "THRUST", recordKind: "inline" },
    { cmd: 0x17, name: "CANNON", recordKind: "inline" },
  ],
};

export function fnoiseCommandsFor(game: GameKind): FnoiseCommand[] {
  return COMMANDS[game].map((c) => ({ ...c }));
}

const hex = (n: number): string => `$${n.toString(16).toUpperCase()}`;

/** The editable fields for one command, or throw if it isn't an editable FNOISE command on this game. */
export function fnoiseFieldsFor(game: GameKind, cmd: number): readonly FnoiseField[] {
  const fields = FIELDS[game][cmd];
  if (!fields) throw new Error(`${hex(cmd)} is not an editable FNOISE command on ${game}`);
  return fields;
}

function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/** CPU address of a command's record base: FNTAB row on Robotron, caller routine on D/S. */
function baseAddr(game: GameKind, cmd: number): number {
  if (game === "robotron") {
    const row = FNTAB_ROW[cmd];
    if (row === undefined) throw new Error(`${hex(cmd)} is not an editable FNOISE command on robotron`);
    return FNTAB_BASE.robotron! + row * FNTAB_STRIDE;
  }
  const addr = DS_CALLER_BASE[cmd];
  if (addr === undefined) throw new Error(`${hex(cmd)} is not an editable FNOISE command on ${game}`);
  return addr;
}

/** Byte offset into the ROM array of a command's record base, validated in-bounds. */
function recordOffset(rom: Uint8Array, game: GameKind, cmd: number): number {
  const fields = fnoiseFieldsFor(game, cmd);
  const span = Math.max(...fields.map((f) => f.byteOffset + f.width));
  const off = baseAddr(game, cmd) - romBase(rom);
  if (off < 0 || off + span > rom.length) {
    throw new Error(`FNOISE record for ${hex(cmd)} falls outside the ${game} ROM`);
  }
  return off;
}

/** Read a command's virtual record (one value per field, in field order). */
export function readFnoiseRecord(rom: Uint8Array, game: GameKind, cmd: number): number[] {
  const off = recordOffset(rom, game, cmd);
  return fnoiseFieldsFor(game, cmd).map((f) =>
    f.width === 2
      ? ((rom[off + f.byteOffset]! << 8) | rom[off + f.byteOffset + 1]!) & 0xFFFF
      : rom[off + f.byteOffset]! & 0xFF,
  );
}

/** Return a copy of `rom` with the command's record bytes replaced from `record`. */
export function patchFnoiseRecord(
  rom: Uint8Array,
  game: GameKind,
  cmd: number,
  record: readonly number[],
): Uint8Array {
  const off = recordOffset(rom, game, cmd);
  const fields = fnoiseFieldsFor(game, cmd);
  if (record.length !== fields.length) {
    throw new Error(`FNOISE record for ${hex(cmd)} must be exactly ${fields.length} value(s), got ${record.length}`);
  }
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!, v = record[i]!;
    if (!Number.isInteger(v) || v < f.min || v > f.max) {
      throw new Error(`${f.label} value ${v} out of range ${f.min}..${f.max}`);
    }
  }
  const out = rom.slice();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!, v = record[i]!;
    if (f.width === 2) {
      out[off + f.byteOffset] = (v >> 8) & 0xFF;
      out[off + f.byteOffset + 1] = v & 0xFF;
    } else {
      out[off + f.byteOffset] = v & 0xFF;
    }
  }
  return out;
}
