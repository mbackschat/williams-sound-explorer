/**
 * Custom-ROM image builder (Designer v-next, Phase 3 step 1) — headless,
 * DOM-free.
 *
 * Productizes the dispatcher spike (`research/findings_designer_feasibility.md`):
 * given a base game and a set of VARI slots `{ code, record }`, emit a runnable
 * ROM image where each slot's command code plays its 9-byte VARI record. The
 * emulator runs the result unchanged — this is the engine behind the "true
 * Custom ROM with its own item list".
 *
 * Mechanics (Defender / Stargate — their VARI dispatch is a clean linear band):
 *   - The IRQ dispatch, after `ANDA #$1F` (command mask) and `DECA`, routes any
 *     value `> $1B` to VARI with `VVECT row = A − $1C`. So command code `cmd`
 *     (post-DECA `cmd−1`) selects `VVECT row = cmd − $1D`.
 *   - The *only* cap on reachable rows is the 5-bit mask. Widening the mask
 *     operand `$1F → $3F` (a single byte) unlocks codes `$20–$3F`.
 *   - The base ROMs are densely packed (no free region to relocate `VVECT`), so
 *     we extend `VVECT` **in place** over the disposable RADIO/ORGAN data tables
 *     that follow it, stopping before the GWAVE tables (`GWVTAB`) — `capacityRows`.
 *     `VVECT` stays at its base, so `VARILD`'s `LDX #VVECT` needs no repoint.
 *
 * Robotron is unsupported here: its VARI dispatch special-cases `$3F`
 * (`SUBA #$39`) and routes part of the space through a `JMPTBL` pointer table,
 * so the clean linear widening doesn't apply.
 */
import type { GameKind } from "../board/soundboard.ts";
import { VVECT_BASE, VVECT_STRIDE } from "./variEdit.ts";

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

const SUPPORTED: Partial<Record<GameKind, BaseSpec>> = {
  defender: { capacityRows: 23 },
  stargate: { capacityRows: 30 },
};

export interface CustomSlot {
  /** Command code the sound is reached by ($1D and up). */
  code: number;
  /** Its 9-byte VVECT record. */
  record: number[];
}

/** Max number of VARI slots a custom ROM can hold on this base (throws if unsupported). */
export function maxSlots(game: GameKind): number {
  const spec = SUPPORTED[game];
  if (!spec) throw new Error(`Custom ROM build is only supported on Defender/Stargate (got ${game})`);
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

/**
 * Build a runnable custom ROM image from a base game + VARI slots. Returns a
 * copy of `baseRom`; the original is untouched.
 */
export function buildCustomRom(baseRom: Uint8Array, game: GameKind, slots: CustomSlot[]): Uint8Array {
  const spec = SUPPORTED[game];
  if (!spec) throw new Error(`Custom ROM build is only supported on Defender/Stargate (got ${game})`);

  // ── Validate up front (before touching the ROM) ──────────────────────────
  if (slots.length === 0) throw new Error("a custom ROM needs at least one slot");
  const maxCode = VARI_CMD_BASE + spec.capacityRows - 1;
  const seen = new Set<number>();
  for (const s of slots) {
    if (!Number.isInteger(s.code) || s.code < VARI_CMD_BASE || s.code > maxCode) {
      throw new Error(`slot code $${s.code.toString(16).toUpperCase()} out of range $${VARI_CMD_BASE.toString(16).toUpperCase()}..$${maxCode.toString(16).toUpperCase()}`);
    }
    if (seen.has(s.code)) throw new Error(`duplicate slot code $${s.code.toString(16).toUpperCase()}`);
    seen.add(s.code);
    if (s.record.length !== VVECT_STRIDE) throw new Error(`record must be exactly ${VVECT_STRIDE} bytes, got ${s.record.length}`);
    for (const b of s.record) {
      if (!Number.isInteger(b) || b < 0 || b > 0xFF) throw new Error(`record byte out of range (0..255): ${b}`);
    }
  }

  const out = baseRom.slice();

  // ── 1. Widen the command mask only if a code needs it (> $1F) ─────────────
  if (slots.some((s) => s.code > 0x1F)) {
    out[findUnique(out, MASK_PATTERN) + 2] = MASK_WIDE;
  }

  // ── 2. Write the custom VVECT in place (row = code − $1D) ─────────────────
  const vvOff = VVECT_BASE[game]! - romBase(out);
  const byRow = new Map(slots.map((s) => [s.code - VARI_CMD_BASE, s.record]));
  const maxRow = Math.max(...byRow.keys());
  const fill = slots[0]!.record; // benign default for any unassigned in-between row
  for (let row = 0; row <= maxRow; row++) {
    out.set(byRow.get(row) ?? fill, vvOff + row * VVECT_STRIDE);
  }
  return out;
}
