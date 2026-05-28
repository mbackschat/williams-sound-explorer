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
 */
import type { GameKind } from "../board/soundboard.ts";
import { VVECT_BASE, VVECT_STRIDE } from "./variEdit.ts";
import {
  patchGWaveRecord, gwaveCommandsFor, SVTAB_STRIDE,
  patchWaveform, STOCK_WAVE_LENGTHS,
  patchPattern, gfrtabMaxEnd,
  GWVTAB_BASE, LDX_GWVTAB_LOC, buildExtendedGwvtab,
} from "./gwaveEdit.ts";

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

export type CustomSlot = VariSlot | GwaveSlot;

/** Max number of VARI slots a custom ROM can hold on this base (throws if unsupported). */
export function maxSlots(game: GameKind): number {
  const spec = VARI_SUPPORTED[game];
  if (!spec) throw new Error(`Custom VARI slots are only supported on Defender/Stargate (got ${game})`);
  return spec.capacityRows;
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
  const seenVari = new Set<number>();
  const seenGwave = new Set<number>();
  for (const s of slots) {
    if (s.kind === "vari") { validateVariSlot(s, game, seenVari); variSlots.push(s); }
    else                  { validateGwaveSlot(s, game, seenGwave); gwaveSlots.push(s); }
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
    const fill = variSlots[0]!.record; // benign default for any unassigned in-between row
    for (let row = 0; row <= maxRow; row++) {
      out.set(byRow.get(row) ?? fill, vvOff + row * VVECT_STRIDE);
    }
  }

  // ── GWAVE: override SVTAB rows in place (any game; no dispatcher patch) ──
  for (const s of gwaveSlots) {
    out = patchGWaveRecord(out, game, s.cmd, s.record);
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
