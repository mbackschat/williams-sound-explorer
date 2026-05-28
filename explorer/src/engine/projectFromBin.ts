/**
 * Phase 6.2: reverse-engineer a Designer **CustomProject** from a built
 * custom-ROM `.bin` by diffing it against the user's base ROM.  Headless,
 * DOM-free — the host (`web/designer/designerMode.ts`) opens the file,
 * looks up the base ROM in IndexedDB, calls this, and feeds the result
 * to its existing `openProject` path.
 *
 * Full-fidelity: every patch path `buildCustomRom` can produce is detectable
 * and reconstructable:
 *
 *  - **GWAVE row edits** ($01..$0D) — per-cmd SVTAB byte diff.
 *  - **LFSR overrides** ($11 / $14 / $15; $39 on Robotron) — per-cmd virtual-record diff over the caller-immediate operands.
 *  - **Stock VARI row edits** ($1D..$1F) — VVECT row 0..2 diff.
 *  - **User-added VARI** ($20+) — mask-widen byte at `$FCBD+2`; walk rows 3+ for bytes that diverge from the base ROM's RADIO/ORGAN data.
 *  - **Stock waveform overrides** (idx 0..6) — resolve `LDX #GWVTAB` operand → read effective GWVTAB → per-idx byte diff.
 *  - **Added waveforms** (idx 7+) — if LDX operand differs from base, walk the relocated GWVTAB past the 7 stock entries (stops cleanly at the zero-byte tail `buildCustomRom` writes).
 *  - **Pattern overrides** — per editable GWAVE cmd, walk its (PATOFF, PATLEN) range and diff.
 *
 * The diff direction is *bin minus base*: when `bin[X] !== base[X]`, the
 * user changed it.  The reconstructed project's `start` bytes always come
 * from the base ROM — so opening an uploaded project and clicking ↻ Reset
 * record on a row reverts it to the **base** stock, not the bin's pre-edit
 * (which is what users expect: "reset to the game's original").
 *
 * **The base ROM must be the same image the user originally edited against**
 * — different ROM revisions would produce false-positive diffs.  The host
 * is responsible for loading the right base ROM from IndexedDB (validated
 * the same way Explore validates uploads).
 */
import type { GameKind } from "../board/soundboard.ts";
import { VVECT_BASE, VVECT_STRIDE, variCommandsFor, readVariRecord } from "./variEdit.ts";
import {
  GWVTAB_BASE, LDX_GWVTAB_LOC, SVTAB_STRIDE,
  STOCK_WAVE_LENGTHS, STOCK_WAVE_SAMPLE_OFFSETS,
  gwaveCommandsFor, readGWaveRecord, readWaveform, readPattern,
} from "./gwaveEdit.ts";
import { lfsrCommandsFor, readLfsrRecord } from "./lfsrEdit.ts";
import { VARI_CMD_BASE, maxSlots } from "./customRom.ts";

/** The reconstructed shape — identical to `web/designer/designerStore.ts`'s `CustomProject`. */
export interface ReconstructedProject {
  engineBase: GameKind;
  slots: ReconstructedSlot[];
  waveformOverrides?: Record<number, number[]>;
  patternOverrides?: Record<number, number[]>;
  addedWaveforms?: number[][];
}

export type ReconstructedSlot =
  | { kind: "vari"; name: string; record: number[]; start: number[] }
  | { kind: "gwave"; name: string; record: number[]; start: number[]; targetCmd: number }
  | { kind: "lfsr"; name: string; record: number[]; start: number[]; targetCmd: number };

/** Expected ROM byte count for each game — used for upload size validation. */
export const ROM_SIZE: Record<GameKind, number> = {
  defender: 0x800,
  stargate: 0x800,
  robotron: 0x1000,
};

function romBase(rom: Uint8Array): number {
  return 0x10000 - rom.length;
}

/**
 * Find the file-byte offset of the IRQ command-mask **operand** in the base
 * ROM — the byte that `buildCustomRom` flips from $1F to $3F.  We search the
 * base ROM (where it's always $1F) for the unique `COMA / ANDA #$1F`
 * sequence (`43 84 1F`) and return the operand offset (+2 past the start).
 * Returns `null` if the pattern isn't found uniquely — which is the case on
 * Robotron, whose mask is `$3F` from the start (no widen needed).
 */
function findMaskOperandOffset(baseRom: Uint8Array): number | null {
  const pat = [0x43, 0x84, 0x1F] as const;
  let idx = -1, hits = 0;
  for (let i = 0; i <= baseRom.length - pat.length; i++) {
    let match = true;
    for (let k = 0; k < pat.length; k++) if (baseRom[i + k] !== pat[k]) { match = false; break; }
    if (match) { idx = i; hits++; }
  }
  return hits === 1 ? idx + 2 : null;
}

/** Read the live `LDX #GWVTAB` operand address from `rom`. */
function gwvtabAddressOf(rom: Uint8Array, game: GameKind): number {
  const off = (LDX_GWVTAB_LOC[game] + 1) - romBase(rom);
  return (rom[off]! << 8) | rom[off + 1]!;
}

/** Byte-equal helper. */
function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Read N bytes from `rom` starting at CPU address `addr`. */
function readBytes(rom: Uint8Array, addr: number, n: number): number[] {
  const off = addr - romBase(rom);
  return Array.from(rom.subarray(off, off + n));
}

/**
 * Read a stock waveform's sample bytes from `rom`, *relative to the
 * currently-pointed GWVTAB* — works for both the original base address
 * and a relocated one.  `STOCK_WAVE_SAMPLE_OFFSETS` is layout-relative
 * (skips length bytes), so it composes cleanly with whatever address LDX
 * currently points at.
 */
function readStockWaveformAt(rom: Uint8Array, gwvtabAddr: number, idx: number): number[] {
  const off = (gwvtabAddr + STOCK_WAVE_SAMPLE_OFFSETS[idx]!) - romBase(rom);
  return Array.from(rom.subarray(off, off + STOCK_WAVE_LENGTHS[idx]!));
}

/**
 * Reconstruct a project by diffing `bin` against `baseRom`.  Both ROMs must
 * be the same game and the same size; the caller is responsible for that
 * validation (`ROM_SIZE[game]`).
 */
export function importBinAsProject(
  bin: Uint8Array,
  baseRom: Uint8Array,
  game: GameKind,
): ReconstructedProject {
  if (bin.length !== baseRom.length) {
    throw new Error(`Uploaded .bin is ${bin.length} bytes; expected ${baseRom.length} for ${game}.`);
  }
  if (bin.length !== ROM_SIZE[game]) {
    throw new Error(`Wrong ROM size for ${game}: got ${bin.length}, expected ${ROM_SIZE[game]}.`);
  }

  const slots: ReconstructedSlot[] = [];
  let waveformOverrides: Record<number, number[]> | undefined;
  let patternOverrides: Record<number, number[]> | undefined;
  let addedWaveforms: number[][] | undefined;

  // ── 1) GWAVE row edits ($01..$0D) ────────────────────────────────────────
  // SVTAB sits at its base address in both images (we don't relocate SVTAB
  // — Phase 5b only relocates GWVTAB).  Diff each editable command's 7-byte
  // record; record bytes that differ as an "edited" GWAVE slot.
  for (const c of gwaveCommandsFor(game)) {
    const baseRec = readGWaveRecord(baseRom, game, c.cmd);
    const binRec = readGWaveRecord(bin, game, c.cmd);
    if (!arraysEqual(baseRec, binRec)) {
      slots.push({
        kind: "gwave",
        name: c.name, // keep the canonical name; user's project rename will follow on edit
        record: binRec,
        start: baseRec,
        targetCmd: c.cmd,
      });
    }
  }

  // ── 1b) LFSR overrides (caller-immediate edits) ──────────────────────────
  // Each editable LFSR command's parameters live as immediate operands in its
  // caller routine.  Diff the virtual record (field values) — bin vs base —
  // and record a slot for any command whose parameters changed.  No table, no
  // relocation: the caller addresses are fixed per game.
  for (const c of lfsrCommandsFor(game)) {
    const baseRec = readLfsrRecord(baseRom, game, c.cmd);
    const binRec = readLfsrRecord(bin, game, c.cmd);
    if (!arraysEqual(baseRec, binRec)) {
      slots.push({ kind: "lfsr", name: c.name, record: binRec, start: baseRec, targetCmd: c.cmd });
    }
  }

  // ── 2) VARI rows (stock 0..2 + user-added 3+) ────────────────────────────
  // Mask widen detection (Defender/Stargate): the IRQ handler's `ANDA #$1F`
  // operand flips to $3F when buildCustomRom adds any code > $1F.  Located
  // by scanning the base ROM for the unique `43 84 1F` sequence.  Robotron's
  // mask is always $3F (no widen needed), so the scan returns null there.
  let maxVariRow = -1;
  const maskOff = findMaskOperandOffset(baseRom);
  // Resolve GWVTAB's address from the bin so the VARI walk knows where to
  // stop — when GWVTAB is relocated, it sits in the same free region as
  // VVECT extension, and bytes past the relocated GWVTAB start are *table*
  // bytes, not user-added VARI rows.
  const binGwvtabEarly = (bin[(LDX_GWVTAB_LOC[game] + 1) - romBase(bin)]! << 8)
                       | bin[(LDX_GWVTAB_LOC[game] + 2) - romBase(bin)]!;
  const variRegionEnd = Math.min(GWVTAB_BASE[game], binGwvtabEarly);
  const variMaxRowInRegion = Math.floor((variRegionEnd - VVECT_BASE[game]) / VVECT_STRIDE) - 1;
  if (maskOff !== null) {
    const maskByte = bin[maskOff]!;
    if (maskByte === 0x3F) {
      // Widened: walk VVECT rows 3 up to whatever the free region allows
      // (capped by both the engine's per-game capacity and the relocated
      // GWVTAB position).  Highest diverging row is the user's last
      // user-added VARI; rows above that are either base data (not
      // relocated case) or the relocated GWVTAB itself (skip them).
      const cap = Math.min(maxSlots(game), variMaxRowInRegion + 1);
      for (let row = 3; row < cap; row++) {
        const baseRowBytes = readBytes(baseRom, VVECT_BASE[game] + row * VVECT_STRIDE, VVECT_STRIDE);
        const binRowBytes = readBytes(bin, VVECT_BASE[game] + row * VVECT_STRIDE, VVECT_STRIDE);
        if (!arraysEqual(baseRowBytes, binRowBytes)) maxVariRow = row;
      }
    }
  }

  // Stock VARI rows 0..2 — read regardless of mask state.
  const stockVari = variCommandsFor(game).filter((c) => c.row <= 2);
  for (const c of stockVari) {
    const baseRec = readVariRecord(baseRom, game, c.cmd);
    const binRec = readBytes(bin, VVECT_BASE[game] + c.row * VVECT_STRIDE, VVECT_STRIDE);
    if (!arraysEqual(baseRec, binRec)) {
      slots.push({ kind: "vari", name: c.name, record: binRec, start: baseRec });
    }
  }

  // User-added VARI rows 3..maxVariRow — only on Defender/Stargate.  Each
  // diverging row in the band becomes a slot; identical rows in between are
  // skipped (rare placeholder gap; user can re-add manually if needed).
  if (maxVariRow >= 3) {
    for (let row = 3; row <= maxVariRow; row++) {
      const baseRowBytes = readBytes(baseRom, VVECT_BASE[game] + row * VVECT_STRIDE, VVECT_STRIDE);
      const binRowBytes = readBytes(bin, VVECT_BASE[game] + row * VVECT_STRIDE, VVECT_STRIDE);
      if (arraysEqual(baseRowBytes, binRowBytes)) continue;
      const cmd = VARI_CMD_BASE + row;
      slots.push({
        kind: "vari",
        name: `My $${cmd.toString(16).toUpperCase()}`,
        record: binRowBytes,
        // For user-added slots there's no "stock" — start = the bin's record
        // so ↻ Reset record stays meaningful (revert to whatever was in the
        // .bin) and so the slot doesn't immediately register as "stock"
        // (`isStockSlot` would mis-flag it).
        start: binRowBytes,
      });
    }
  }

  // ── 3) Waveform diffs ────────────────────────────────────────────────────
  // Resolve where GWVTAB actually lives in the bin (may be relocated).
  const baseGwvtab = gwvtabAddressOf(baseRom, game); // == GWVTAB_BASE[game] for a stock ROM
  const binGwvtab = gwvtabAddressOf(bin, game);
  const relocated = binGwvtab !== baseGwvtab;

  // Stock waveforms (idx 0..6) — compare effective bytes (bin from binGwvtab,
  // base from baseGwvtab) per idx.  Diffs become `waveformOverrides[idx]`.
  for (let idx = 0; idx < 7; idx++) {
    const baseBytes = readStockWaveformAt(baseRom, baseGwvtab, idx);
    const binBytes = readStockWaveformAt(bin, binGwvtab, idx);
    if (!arraysEqual(baseBytes, binBytes)) {
      waveformOverrides ??= {};
      waveformOverrides[idx] = binBytes;
    }
  }

  // Added waveforms (idx 7+) — only present if GWVTAB was relocated.  Walk
  // length-prefixed records past the 7 stock entries (each entry stride =
  // 1 length byte + N samples).  Stop when we hit a length-0 byte (the
  // build's tail-fill sentinel — Phase 6.2 prerequisite) or when the table
  // would exceed the free region.
  if (relocated) {
    // Position immediately after the 7 stock entries in the relocated table.
    let cursor = binGwvtab;
    for (let idx = 0; idx < 7; idx++) cursor += 1 + STOCK_WAVE_LENGTHS[idx]!;
    const freeEnd = GWVTAB_BASE[game]; // bytes after this are the original GWVTAB and other data
    const adds: number[][] = [];
    for (let k = 0; k < 9; k++) {
      if (cursor >= freeEnd) break;
      const len = bin[cursor - romBase(bin)]!;
      if (len === 0) break; // tail-fill sentinel reached
      if (cursor + 1 + len > freeEnd) break; // would overrun the free region
      const samples = readBytes(bin, cursor + 1, len);
      adds.push(samples);
      cursor += 1 + len;
    }
    if (adds.length > 0) addedWaveforms = adds;
  }

  // ── 4) Pattern overrides ─────────────────────────────────────────────────
  // Two passes: first walk every editable command to compute the **longest**
  // (PATLEN) seen at each (PATOFF) — multiple commands can share an offset
  // with different lengths, and the longest range is the one we want to
  // diff (a shorter command's bytes are a prefix of the longer one).  Then
  // for each unique offset, diff its longest range vs base and record the
  // override if they differ.  Round-trip consistency: buildCustomRom replays
  // overlapping overrides in iteration order (last write wins), so reading
  // back the longest range captures the final combined state.
  const lenByOff = new Map<number, number>();
  for (const c of gwaveCommandsFor(game)) {
    const binRec = readGWaveRecord(bin, game, c.cmd);
    const patLen = binRec[5]!;
    if (patLen === 0) continue;
    const patOff = binRec[6]!;
    lenByOff.set(patOff, Math.max(lenByOff.get(patOff) ?? 0, patLen));
  }
  for (const [patOff, patLen] of lenByOff) {
    const baseBytes = readPattern(baseRom, game, patOff, patLen);
    const binBytes = readPattern(bin, game, patOff, patLen);
    if (arraysEqual(baseBytes, binBytes)) continue;
    patternOverrides ??= {};
    patternOverrides[patOff] = binBytes;
  }

  return {
    engineBase: game,
    slots,
    ...(waveformOverrides ? { waveformOverrides } : {}),
    ...(patternOverrides ? { patternOverrides } : {}),
    ...(addedWaveforms ? { addedWaveforms } : {}),
  };
}
