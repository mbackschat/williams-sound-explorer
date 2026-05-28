/**
 * Custom-ROM image builder (Designer v-next, Phase 3 → Phase 5) — headless,
 * DOM-free.
 *
 * Productizes the dispatcher spike (`research/findings_designer_feasibility.md`):
 * given a base game and a set of slots, emit a runnable ROM image where each
 * slot's command plays its parameter record.  The emulator runs the result
 * unchanged — this is the engine behind the "true Custom ROM with its own item
 * list" (VARI) and "GWAVE override in place" (Phase 5 step 1).
 *
 * Two slot kinds coexist in one build:
 *
 * - **VARI slot** — `{ kind: "vari", code, record(9) }`.  After `ANDA #$1F`
 *   (command mask) and `DECA`, the IRQ dispatch routes any value `> $1B` to
 *   VARI with `VVECT row = A − $1C`, so `cmd` selects `VVECT row = cmd − $1D`.
 *   The 5-bit mask is widened to `$3F` (one-byte patch) only when a slot's
 *   code exceeds `$1F`.  `VVECT` is **extended in place** over the disposable
 *   RADIO/ORGAN data tables that follow it, stopping before `GWVTAB` —
 *   `capacityRows` per game.  Defender / Stargate only (Robotron's VARI
 *   dispatch special-cases `$3F` and routes part of the space through a
 *   `JMPTBL`, so the clean linear widening doesn't apply).
 *
 * - **GWAVE slot** — `{ kind: "gwave", cmd, record(7) }`.  Overrides an
 *   existing GWAVE command's 7-byte SVTAB entry **in place** (no table
 *   extension, no dispatcher patch).  Works on every game (Defender / Stargate
 *   / Robotron) — GWAVE dispatch is already wired for the editable codes
 *   ($01..$0D).  Adding *new* GWAVE codes is a v-future item (would need
 *   dispatcher injection — see `plans/designer-mode.md` § Phase 5 deferrals).
 *
 * - **LFSR slot** — `{ kind: "lfsr", cmd, record }`.  Overrides an existing
 *   LFSR command's parameters **in place** by rewriting the caller routine's
 *   immediate operands (LITE / TURBO / APPEAR on every game; LAUNCH on
 *   Robotron).  No table, no dispatcher patch — the record is a per-command
 *   list of logical field values (see `engine/lfsrEdit.ts`).
 *
 * - **FNOISE slot** — `{ kind: "fnoise", cmd, record }`.  Overrides an existing
 *   FNOISE command **in place**: the 6-byte `FNTAB` record on Robotron (all 4
 *   sounds), or the caller's immediate operands on Defender/Stargate (CANNON
 *   full, THRUST FMAX-only; BG1 omitted — no patchable immediate).  Per-command
 *   logical field list (see `engine/fnoiseEdit.ts`).
 *
 * - **RADIO slot** — `{ kind: "radio", cmd, record }`.  Overrides the single
 *   $18 RADIO command **in place**: the FREQ immediate + the 16-byte RADSND
 *   LUT.  `record = [freq, ...16 LUT bytes]` (see `engine/radioEdit.ts`).
 */
import type { GameKind } from "../board/soundboard.ts";
import { VVECT_BASE, VVECT_STRIDE } from "./variEdit.ts";
import {
  patchGWaveRecord, gwaveCommandsFor, SVTAB_STRIDE,
  patchWaveform, STOCK_WAVE_LENGTHS,
  patchPattern, gfrtabMaxEnd,
  GWVTAB_BASE, LDX_GWVTAB_LOC, buildExtendedGwvtab,
} from "./gwaveEdit.ts";
import { lfsrFieldsFor, patchLfsrRecord, LFSR_CALLER_BASE } from "./lfsrEdit.ts";
import { fnoiseFieldsFor, patchFnoiseRecord, fnoiseCommandsFor } from "./fnoiseEdit.ts";
import { patchRadioRecord, radioCommandsFor, RADIO_RECORD_LEN } from "./radioEdit.ts";

/** Lowest VARI command code on a linear-dispatch base; `row = code − VARI_CMD_BASE`. */
export const VARI_CMD_BASE = 0x1D;

/** The command mask in the IRQ handler: `COMA ; ANDA #$1F` → bytes `43 84 1F`. */
const MASK_PATTERN = [0x43, 0x84, 0x1F] as const;
const MASK_WIDE = 0x3F;

interface BaseSpec {
  /**
   * Max VVECT rows writable in place. The table extends over the disposable
   * RADIO/ORGAN tables that follow `VVECT` and stops before the GWAVE tables
   * (`GWVTAB`), so other engines' data stays intact. Verified from the
   * per-game label-map JSON: Defender `$FD76`→`GWVTAB $FE4D` = 23 rows;
   * Stargate `$FD3C`→`GWVTAB $FE4B` = 30 rows.
   */
  capacityRows: number;
}

const VARI_SUPPORTED: Partial<Record<GameKind, BaseSpec>> = {
  defender: { capacityRows: 23 },
  stargate: { capacityRows: 30 },
};

export interface VariSlot {
  kind: "vari";
  /** Command code the sound is reached by ($1D and up). */
  code: number;
  /** 9-byte VVECT record. */
  record: number[];
}

export interface GwaveSlot {
  kind: "gwave";
  /** Override target — an existing GWAVE command ($01..$0D) whose SVTAB entry is replaced. */
  cmd: number;
  /** 7-byte SVTAB record. */
  record: number[];
}

export interface LfsrSlot {
  kind: "lfsr";
  /** Override target — an existing LFSR command ($11 LITE / $14 TURBO / $15 APPEAR; $39 LAUNCH on Robotron). */
  cmd: number;
  /** Virtual record: one value per field (see `lfsrFieldsFor`), in field order. */
  record: number[];
}

export interface FnoiseSlot {
  kind: "fnoise";
  /** Override target — an existing FNOISE command ($16 THRUST / $17 CANNON; + $0F BG1 / $3E HBOMB on Robotron). */
  cmd: number;
  /** Virtual record: one value per field (see `fnoiseFieldsFor`), in field order. */
  record: number[];
}

export interface RadioSlot {
  kind: "radio";
  /** Always $18 (the single RADIO command). */
  cmd: number;
  /** `[freq, ...16 LUT bytes]` (see `radioEdit.ts`). */
  record: number[];
}

export type CustomSlot = VariSlot | GwaveSlot | LfsrSlot | FnoiseSlot | RadioSlot;

/** Max number of VARI slots a custom ROM can hold on this base (throws if unsupported). */
export function maxSlots(game: GameKind): number {
  const spec = VARI_SUPPORTED[game];
  if (!spec) throw new Error(`Custom VARI slots are only supported on Defender/Stargate (got ${game})`);
  return spec.capacityRows;
}

/**
 * The ROM-byte budget the Designer surfaces in its header.  Returns the
 * footprint the project's VVECT extent + (relocated) GWVTAB would consume
 * inside the free region (`GWVTAB_BASE − VVECT_BASE`).
 *
 *  - When `addedWaveforms.length === 0`, GWVTAB stays at its base address and
 *    only the **VVECT extent** lives inside the free region (min 27 = 3 stock
 *    rows; grows to `(maxRow+1)*9` when VARI slots push it).  Pure GWAVE
 *    overrides + stock-waveform overrides don't consume free-region bytes —
 *    they patch in place.
 *  - When `addedWaveforms.length > 0`, the build relocates GWVTAB right after
 *    the VVECT extent; **used = vvectBytes + gwvtabBytes**.  Adding a new
 *    16-byte waveform costs 17 bytes (1 length + 16 samples).
 *
 * Mirrors the exact arithmetic in `buildCustomRom` so the indicator and the
 * "Won't fit" error stay in lockstep.  Pure (no ROM bytes touched, no
 * `baseRom` needed) → cheap to call after every project mutation.
 */
export interface RomBudget {
  /** Bytes from `VVECT_BASE` to the original `GWVTAB_BASE` — the free region a relocated GWVTAB can grow into. */
  freeRegion: number;
  /** Bytes the project's VVECT extent occupies (min 27 = 3 stock rows). */
  vvectBytes: number;
  /** Bytes the relocated GWVTAB occupies (0 when `addedWaveforms` is empty — GWVTAB stays at base). */
  gwvtabBytes: number;
  /** Total free-region bytes the project consumes (`vvectBytes + gwvtabBytes`). */
  used: number;
  /** Whether the build will relocate GWVTAB (i.e. the project added one or more waveforms). */
  relocated: boolean;
  /** Bytes over the free region (`> 0` → "Won't fit"); negative or zero means it fits. */
  overrun: number;
}

export function computeBudget(
  game: GameKind,
  slots: CustomSlot[],
  options: BuildOptions = {},
): RomBudget {
  const addedWaveforms = options.addedWaveforms ?? [];
  const variSlots = slots.filter((s): s is VariSlot => s.kind === "vari");

  // VVECT extent — 27 bytes floor (3 stock rows), grows with VARI slots.
  let vvectBytes = 27;
  if (variSlots.length > 0) {
    const maxRow = Math.max(...variSlots.map((s) => s.code - VARI_CMD_BASE));
    vvectBytes = Math.max(vvectBytes, (maxRow + 1) * VVECT_STRIDE);
  }

  // GWVTAB only consumes free-region bytes when relocated.  Same shape as
  // `buildExtendedGwvtab`: stock 159 + Σ(1 + samples.length) per added wave.
  let gwvtabBytes = 0;
  if (addedWaveforms.length > 0) {
    gwvtabBytes = 159;
    for (const wave of addedWaveforms) gwvtabBytes += 1 + wave.length;
  }

  const freeRegion = GWVTAB_BASE[game] - VVECT_BASE[game];
  const used = vvectBytes + gwvtabBytes;
  return {
    freeRegion,
    vvectBytes,
    gwvtabBytes,
    used,
    relocated: addedWaveforms.length > 0,
    overrun: used - freeRegion,
  };
}

/** ROM occupies the top of the 64K space (vectors at $FFFE/$FFFF). */
function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

function findUnique(rom: Uint8Array, pat: readonly number[]): number {
  let idx = -1, hits = 0;
  for (let i = 0; i <= rom.length - pat.length; i++) {
    let match = true;
    for (let k = 0; k < pat.length; k++) if (rom[i + k] !== pat[k]) { match = false; break; }
    if (match) { idx = i; hits++; }
  }
  if (hits !== 1) throw new Error(`expected exactly one match for the command mask, found ${hits}`);
  return idx;
}

/** Validate one VARI slot against the per-game capacity / range. */
function validateVariSlot(s: VariSlot, game: GameKind, seen: Set<number>): void {
  const spec = VARI_SUPPORTED[game];
  if (!spec) throw new Error(`Custom VARI slots are only supported on Defender/Stargate (got ${game})`);
  const maxCode = VARI_CMD_BASE + spec.capacityRows - 1;
  if (!Number.isInteger(s.code) || s.code < VARI_CMD_BASE || s.code > maxCode) {
    throw new Error(`VARI slot code $${s.code.toString(16).toUpperCase()} out of range $${VARI_CMD_BASE.toString(16).toUpperCase()}..$${maxCode.toString(16).toUpperCase()}`);
  }
  if (seen.has(s.code)) throw new Error(`duplicate VARI slot code $${s.code.toString(16).toUpperCase()}`);
  seen.add(s.code);
  if (s.record.length !== VVECT_STRIDE) throw new Error(`VARI record must be exactly ${VVECT_STRIDE} bytes, got ${s.record.length}`);
  for (const b of s.record) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) throw new Error(`VARI record byte out of range (0..255): ${b}`);
  }
}

/** Validate one GWAVE override against the per-game editable list. */
function validateGwaveSlot(s: GwaveSlot, game: GameKind, seen: Set<number>): void {
  const editable = gwaveCommandsFor(game);
  if (!editable.some((c) => c.cmd === s.cmd)) {
    throw new Error(`GWAVE override $${s.cmd.toString(16).toUpperCase()} is not an editable GWAVE command on ${game}`);
  }
  if (seen.has(s.cmd)) throw new Error(`duplicate GWAVE override $${s.cmd.toString(16).toUpperCase()}`);
  seen.add(s.cmd);
  if (s.record.length !== SVTAB_STRIDE) throw new Error(`GWAVE record must be exactly ${SVTAB_STRIDE} bytes, got ${s.record.length}`);
  for (const b of s.record) {
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) throw new Error(`GWAVE record byte out of range (0..255): ${b}`);
  }
}

/** Validate one LFSR override against the per-game editable list + field layout. */
function validateLfsrSlot(s: LfsrSlot, game: GameKind, seen: Set<number>): void {
  if (LFSR_CALLER_BASE[game][s.cmd] === undefined) {
    throw new Error(`LFSR override $${s.cmd.toString(16).toUpperCase()} is not an editable LFSR command on ${game}`);
  }
  if (seen.has(s.cmd)) throw new Error(`duplicate LFSR override $${s.cmd.toString(16).toUpperCase()}`);
  seen.add(s.cmd);
  const fields = lfsrFieldsFor(game, s.cmd);
  if (s.record.length !== fields.length) {
    throw new Error(`LFSR record for $${s.cmd.toString(16).toUpperCase()} must be exactly ${fields.length} values, got ${s.record.length}`);
  }
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!, v = s.record[i]!;
    if (!Number.isInteger(v) || v < f.min || v > f.max) {
      throw new Error(`LFSR ${f.label} value ${v} out of range ${f.min}..${f.max}`);
    }
  }
}

/** Validate one FNOISE override against the per-game editable list + field layout. */
function validateFnoiseSlot(s: FnoiseSlot, game: GameKind, seen: Set<number>): void {
  if (!fnoiseCommandsFor(game).some((c) => c.cmd === s.cmd)) {
    throw new Error(`FNOISE override $${s.cmd.toString(16).toUpperCase()} is not an editable FNOISE command on ${game}`);
  }
  if (seen.has(s.cmd)) throw new Error(`duplicate FNOISE override $${s.cmd.toString(16).toUpperCase()}`);
  seen.add(s.cmd);
  const fields = fnoiseFieldsFor(game, s.cmd);
  if (s.record.length !== fields.length) {
    throw new Error(`FNOISE record for $${s.cmd.toString(16).toUpperCase()} must be exactly ${fields.length} value(s), got ${s.record.length}`);
  }
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!, v = s.record[i]!;
    if (!Number.isInteger(v) || v < f.min || v > f.max) {
      throw new Error(`FNOISE ${f.label} value ${v} out of range ${f.min}..${f.max}`);
    }
  }
}

/** Validate one RADIO override (single $18 command; record = freq + 16 LUT bytes). */
function validateRadioSlot(s: RadioSlot, game: GameKind, seen: Set<number>): void {
  if (!radioCommandsFor(game).some((c) => c.cmd === s.cmd)) {
    throw new Error(`RADIO override $${s.cmd.toString(16).toUpperCase()} is not an editable RADIO command on ${game}`);
  }
  if (seen.has(s.cmd)) throw new Error(`duplicate RADIO override $${s.cmd.toString(16).toUpperCase()}`);
  seen.add(s.cmd);
  if (s.record.length !== RADIO_RECORD_LEN) {
    throw new Error(`RADIO record must be exactly ${RADIO_RECORD_LEN} values (freq + 16 LUT bytes), got ${s.record.length}`);
  }
  const freq = s.record[0]!;
  if (!Number.isInteger(freq) || freq < 0 || freq > 0xFFFF) throw new Error(`RADIO FREQ ${freq} out of range 0..65535`);
  for (let i = 1; i < s.record.length; i++) {
    const b = s.record[i]!;
    if (!Number.isInteger(b) || b < 0 || b > 0xFF) throw new Error(`RADIO LUT byte out of range (0..255): ${b}`);
  }
}

/**
 * Optional build extras alongside the per-sound slot list.  Carries:
 *
 *  - **`waveformOverrides`** (Phase 5 step 2) — a map from stock waveform
 *    index (0..6) to its replacement sample bytes.  Each replacement MUST be
 *    exactly the stock waveform's length; lengths don't change, so GWLD
 *    walking and SVTAB byte-6 pattern offsets stay valid.
 *  - **`patternOverrides`** (Phase 5 step 3) — a map from GFRTAB offset
 *    (0..255) to replacement pitch-modulation bytes.  Patterns address bytes
 *    by raw offset+length and may overlap; multiple overrides whose ranges
 *    overlap are applied in iteration order (last write wins).  Length is
 *    `bytes.length`; SVTAB byte-5 (`PATLEN`) is *not* modified here, so the
 *    kernel still reads whatever PATLEN was set in the SVTAB record.
 */
export interface BuildOptions {
  waveformOverrides?: Record<number, number[]>;
  patternOverrides?: Record<number, number[]>;
  /**
   * User-added waveforms (Phase 5 step 4) appended after the 7 stock entries
   * in a *relocated* GWVTAB.  Indexed in order: `addedWaveforms[0]` → idx 7,
   * `addedWaveforms[1]` → idx 8, etc.  Each entry is 1..255 sample bytes.
   * When `addedWaveforms` is empty/absent, GWVTAB stays at its original
   * location and `waveformOverrides` patch the stock bytes in place
   * (backward-compatible with Step 2 projects).
   *
   * Layout when relocation is needed: VVECT occupies its usual slot from
   * `VVECT_BASE[game]` up to `max((maxRow+1)*9, 27)` bytes; the relocated
   * GWVTAB follows immediately, and `LDX #GWVTAB` in GWLD is repointed at
   * that fresh address.  The builder throws if VVECT + new GWVTAB exceeds
   * the free region (the RADIO/ORGAN block up to the original GWVTAB base).
   */
  addedWaveforms?: number[][];
}

/**
 * Build a runnable custom ROM image from a base game + slots (mixed VARI +
 * GWAVE) + optional waveform-byte overrides. Returns a copy of `baseRom`;
 * the original is untouched.
 */
export function buildCustomRom(
  baseRom: Uint8Array,
  game: GameKind,
  slots: CustomSlot[],
  options: BuildOptions = {},
): Uint8Array {
  // ── Partition + validate up front (before touching the ROM) ──────────────
  const waveformOverrides = options.waveformOverrides ?? {};
  const waveformKeys = Object.keys(waveformOverrides);
  const patternOverrides = options.patternOverrides ?? {};
  const patternKeys = Object.keys(patternOverrides);
  const addedWaveforms = options.addedWaveforms ?? [];
  if (slots.length === 0 && waveformKeys.length === 0 && patternKeys.length === 0 && addedWaveforms.length === 0) {
    throw new Error("a custom ROM needs at least one slot, waveform override, pattern override, or added waveform");
  }
  if (addedWaveforms.length > 9) {
    // WAVE# is a 4-bit nybble (0..15); stock waves occupy 0..6, so the
    // 9 remaining indices (7..15) are the hard ceiling for additions.
    throw new Error(`at most 9 added waveforms (got ${addedWaveforms.length}); WAVE# is a 4-bit nybble`);
  }
  // Per-byte validation of added waveforms is delegated to `buildExtendedGwvtab`
  // below — keep the validator a single source of truth.
  const variSlots: VariSlot[] = [];
  const gwaveSlots: GwaveSlot[] = [];
  const lfsrSlots: LfsrSlot[] = [];
  const fnoiseSlots: FnoiseSlot[] = [];
  const radioSlots: RadioSlot[] = [];
  const seenVari = new Set<number>();
  const seenGwave = new Set<number>();
  const seenLfsr = new Set<number>();
  const seenFnoise = new Set<number>();
  const seenRadio = new Set<number>();
  for (const s of slots) {
    if (s.kind === "vari")        { validateVariSlot(s, game, seenVari); variSlots.push(s); }
    else if (s.kind === "gwave")  { validateGwaveSlot(s, game, seenGwave); gwaveSlots.push(s); }
    else if (s.kind === "lfsr")   { validateLfsrSlot(s, game, seenLfsr); lfsrSlots.push(s); }
    else if (s.kind === "fnoise") { validateFnoiseSlot(s, game, seenFnoise); fnoiseSlots.push(s); }
    else                          { validateRadioSlot(s, game, seenRadio); radioSlots.push(s); }
  }
  for (const k of waveformKeys) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx > 6) {
      throw new Error(`waveformOverrides key out of range 0..6: ${k}`);
    }
    const bytes = (waveformOverrides as Record<number, number[]>)[idx];
    if (!Array.isArray(bytes) || bytes.length !== STOCK_WAVE_LENGTHS[idx]) {
      throw new Error(`waveformOverrides[${idx}] must be exactly ${STOCK_WAVE_LENGTHS[idx]} bytes, got ${bytes?.length}`);
    }
    for (const b of bytes) {
      if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
        throw new Error(`waveformOverrides[${idx}] byte out of range (0..255): ${b}`);
      }
    }
  }
  const gfrtabEnd = gfrtabMaxEnd(game);
  for (const k of patternKeys) {
    const offset = Number(k);
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xFF) {
      throw new Error(`patternOverrides key out of range 0..255: ${k}`);
    }
    const bytes = (patternOverrides as Record<number, number[]>)[offset];
    if (!Array.isArray(bytes) || bytes.length < 1 || bytes.length > 0xFF) {
      throw new Error(`patternOverrides[${offset}] must be 1..255 bytes, got ${bytes?.length}`);
    }
    if (offset + bytes.length > gfrtabEnd) {
      throw new Error(`patternOverrides[${offset}] (length ${bytes.length}) runs past the ${game} GFRTAB end (${gfrtabEnd})`);
    }
    for (const b of bytes) {
      if (!Number.isInteger(b) || b < 0 || b > 0xFF) {
        throw new Error(`patternOverrides[${offset}] byte out of range (0..255): ${b}`);
      }
    }
  }

  let out: Uint8Array = baseRom.slice();

  // ── VARI: widen mask (if needed) + extend VVECT in place ─────────────────
  if (variSlots.length > 0) {
    // The per-slot validator already guards Defender/Stargate, but reassert
    // here so the code is self-evident.
    const spec = VARI_SUPPORTED[game];
    if (!spec) throw new Error(`Custom VARI slots are only supported on Defender/Stargate (got ${game})`);

    if (variSlots.some((s) => s.code > 0x1F)) {
      out[findUnique(out, MASK_PATTERN) + 2] = MASK_WIDE;
    }
    const vvOff = VVECT_BASE[game]! - romBase(out);
    const byRow = new Map(variSlots.map((s) => [s.code - VARI_CMD_BASE, s.record]));
    const maxRow = Math.max(...byRow.keys());
    // Phase 6.2: write *only* user-supplied rows; leave gaps as the base
    // ROM's bytes.  Previously gaps were filled with the first slot's
    // record (benign default), but that made an upload-side .bin → project
    // reconstruction ambiguous — fill placeholders looked indistinguishable
    // from real user-added rows.  Since Phase 6.1 always pre-populates stock
    // rows 0..2, gaps are effectively impossible in practice; the fall-back
    // behaviour for the rare programmatic gap (firing a code that maps to an
    // unfilled row) is "play whatever the base ROM had at those bytes",
    // which is non-crashing and arguably more intuitive than the old fill.
    for (let row = 0; row <= maxRow; row++) {
      const rec = byRow.get(row);
      if (rec) out.set(rec, vvOff + row * VVECT_STRIDE);
    }
  }

  // ── GWAVE: override SVTAB rows in place (any game; no dispatcher patch) ──
  for (const s of gwaveSlots) {
    out = patchGWaveRecord(out, game, s.cmd, s.record);
  }

  // ── LFSR: rewrite caller-routine immediate operands in place ─────────────
  for (const s of lfsrSlots) {
    out = patchLfsrRecord(out, game, s.cmd, s.record);
  }

  // ── FNOISE: patch the FNTAB record (Robotron) or caller immediates (D/S) ─
  for (const s of fnoiseSlots) {
    out = patchFnoiseRecord(out, game, s.cmd, s.record);
  }

  // ── RADIO: patch the FREQ immediate + the 16-byte RADSND LUT in place ────
  for (const s of radioSlots) {
    out = patchRadioRecord(out, game, s.record);
  }

  // ── GWAVE waveform bytes: in-place patch OR relocated GWVTAB ─────────────
  // No added waves → patch stock bytes in place (Step 2 behaviour, preserved).
  // Any added waves → rebuild the whole GWVTAB (stock + added) in a fresh
  // region of free ROM and repoint `LDX #GWVTAB` to it (Step 4 behaviour).
  // The two paths are mutually exclusive: when relocating, `waveformOverrides`
  // for idx 0..6 are folded into the rebuilt table via `buildExtendedGwvtab`,
  // so the in-place loop would double-write the same bytes.
  if (addedWaveforms.length === 0) {
    for (const k of waveformKeys) {
      const idx = Number(k);
      out = patchWaveform(out, game, idx, (waveformOverrides as Record<number, number[]>)[idx]!);
    }
  } else {
    // Build the new GWVTAB byte sequence (stock 7 with overrides applied +
    // added waves appended).  Note: stock-idx overrides must match stock
    // lengths; idx ≥ 7 entries in `waveformOverrides` are NOT consulted here
    // — the host plumbs added waves through `addedWaveforms` as an ordered list.
    const stockOverrides: Record<number, number[]> = {};
    for (const k of waveformKeys) {
      const idx = Number(k);
      if (idx >= 0 && idx <= 6) stockOverrides[idx] = (waveformOverrides as Record<number, number[]>)[idx]!;
    }
    const newGwvtabBytes = buildExtendedGwvtab(out, game, stockOverrides, addedWaveforms);

    // VVECT footprint within the free region — preserve stock 3 rows as a
    // floor so existing GWAVE-only projects (no VARI slots) still have a
    // valid table at $FD76.  When there are VARI slots they occupy rows
    // 0..maxRow (filled in the loop above).
    let vvectExtent = 27; // stock 3 rows × 9 bytes
    if (variSlots.length > 0) {
      const maxRow = Math.max(...variSlots.map((s) => s.code - VARI_CMD_BASE));
      vvectExtent = Math.max(vvectExtent, (maxRow + 1) * VVECT_STRIDE);
    }
    const freeRegion = GWVTAB_BASE[game] - VVECT_BASE[game];
    const newGwvtabSize = newGwvtabBytes.length;
    if (vvectExtent + newGwvtabSize > freeRegion) {
      const overrun = vvectExtent + newGwvtabSize - freeRegion;
      throw new Error(
        `Won't fit on ${game}: VVECT ${vvectExtent} bytes + relocated GWVTAB ${newGwvtabSize} bytes ` +
        `> ${freeRegion} bytes free (over by ${overrun} bytes). ` +
        `Reduce VARI slots, shorten added waveforms, or remove one.`,
      );
    }
    // Write the relocated GWVTAB right after the VVECT extent.
    const newGwvtabAddr = VVECT_BASE[game] + vvectExtent;
    out.set(newGwvtabBytes, newGwvtabAddr - romBase(out));
    // Phase 6.2: zero-fill the tail of the free region after the relocated
    // GWVTAB so a future .bin upload can walk added waveforms (length-prefixed
    // records) and stop cleanly at the first `length = 0` byte.  Without
    // this, the tail still carries the base ROM's RADIO/ORGAN data, whose
    // first byte could look like a valid length and confuse reconstruction.
    // The dispatcher never reads past the relocated GWVTAB (GWLD walks by
    // wave index, not to a sentinel), so zeroing the tail is safe.
    const tailStart = (newGwvtabAddr + newGwvtabBytes.length) - romBase(out);
    const tailEnd = GWVTAB_BASE[game] - romBase(out);
    for (let off = tailStart; off < tailEnd; off++) out[off] = 0;
    // Patch `LDX #GWVTAB` operand (2 bytes, big-endian) at +1 past the CE opcode.
    const ldxOperandOff = (LDX_GWVTAB_LOC[game] + 1) - romBase(out);
    out[ldxOperandOff] = (newGwvtabAddr >> 8) & 0xFF;
    out[ldxOperandOff + 1] = newGwvtabAddr & 0xFF;
  }

  // ── GWAVE pitch-pattern bytes: patch GFRTAB in place (Phase 5 step 3) ─────
  // Each override writes `bytes.length` bytes starting at GFRTAB+offset.
  // Patterns may overlap (commands address GFRTAB by raw offset+length), so
  // overlapping overrides apply in iteration order — last write wins.
  // The Designer UI's "Shared by" surfaces which editable commands read into
  // the same byte range.
  for (const k of patternKeys) {
    const offset = Number(k);
    out = patchPattern(out, game, offset, (patternOverrides as Record<number, number[]>)[offset]!);
  }

  return out;
}
