/**
 * The Williams sound-board memory bus.
 *
 * Memory map (`docs/sound_hardware_model.md`):
 *
 *   $0000-$007F   internal RAM (128 B, on-chip)
 *   $0080-$00FF   external RAM (MC6810; **Robotron/Joust only**, 128 B)
 *   $0400-$0403   PIA (DAC + command port)
 *   $8400-$8403   PIA mirror (same chip, address bit 15 ignored by decoder)
 *   $F000-$FFFF   program ROM (4 KB Robotron; 2 KB at $F800 for Defender / Stargate)
 *
 * Any other read returns 0; any other write is silently dropped.
 *
 * The bus implements the `Bus` interface the CPU expects.  Reads that fall on
 * a PIA register update the PIA's internal state (e.g. clearing the CA1
 * interrupt flag when Port B data is read).
 */
import type { Bus, CPUState } from "../cpu/types.ts";
import { PIA } from "./pia.ts";
import {
  shouldDiscardWrite,
  transformWriteValue,
  type EngineToggles,
} from "../engine/engineToggles.ts";

/** Which Williams sound ROM family is loaded. */
export type GameKind = "defender" | "stargate" | "robotron";

/** Per-game memory-map parameters. */
const GAMES: Record<GameKind, { romBase: number; romSize: number; hasExtRam: boolean }> = {
  defender: { romBase: 0xF800, romSize: 0x0800, hasExtRam: false },
  stargate: { romBase: 0xF800, romSize: 0x0800, hasExtRam: false },
  robotron: { romBase: 0xF000, romSize: 0x1000, hasExtRam: true },
};

export class SoundBoard implements Bus {
  readonly pia = new PIA();
  readonly ram = new Uint8Array(256); // 128 B internal + (optional) 128 B external
  /**
   * Per-cell last-write cycle stamp (Step 6.6 / Pattern adjacent — RAM
   * heatmap).  Each RAM write updates `lastWriteCycle[addr]` with the CPU
   * cycle of the write.  Reads don't touch it.  Writes suppressed by
   * Pattern 3 freeze toggles also don't stamp (consistent with the cell's
   * value not changing).  Pattern 5 overrides DO stamp — the override is
   * an active rewrite to the cell.
   */
  readonly lastWriteCycle = new Uint32Array(256);
  readonly rom: Uint8Array;
  readonly romBase: number;
  readonly hasExtRam: boolean;
  readonly game: GameKind;
  /** Reference to the CPU state so we can timestamp DAC events. */
  cpu: CPUState | undefined;
  /** Engine-toggle flags consulted by `write()` (Pattern 3 / Step 4.4). */
  toggles: EngineToggles = {};
  /**
   * Zero-page address → forced value overrides (Pattern 5 / Step 6.2).
   * When an override is set for `addr`, every CPU write to `addr` is replaced
   * with the override value, and the cell is kept pinned across IRQs.  Takes
   * precedence over `toggles.*Freeze*` discards (override = active rewrite,
   * freeze = passive drop; rewrite wins).
   */
  paramOverrides = new Map<number, number>();

  constructor(game: GameKind, rom: Uint8Array) {
    const meta = GAMES[game];
    if (rom.length !== meta.romSize) {
      throw new Error(
        `ROM size mismatch for ${game}: got ${rom.length} bytes, want ${meta.romSize}`,
      );
    }
    this.game = game;
    this.romBase = meta.romBase;
    this.hasExtRam = meta.hasExtRam;
    this.rom = rom;
  }

  read(addr: number): number {
    const a = addr & 0xFFFF;
    // Internal RAM
    if (a <= 0x007F) return this.ram[a]!;
    // External RAM (Robotron only)
    if (this.hasExtRam && a >= 0x0080 && a <= 0x00FF) return this.ram[a]!;
    // PIA (with $8000 mirror)
    const piaA = a & 0x7FFF;
    if (piaA >= 0x0400 && piaA <= 0x0403) return this.pia.read(piaA - 0x0400);
    // ROM
    if (a >= this.romBase && a < this.romBase + this.rom.length) {
      return this.rom[a - this.romBase]!;
    }
    return 0;
  }

  write(addr: number, value: number): void {
    const a = addr & 0xFFFF;
    const v = value & 0xFF;
    // Pattern 3 engine toggles — gate RAM writes only.  PIA writes (DAC +
    // command latch) are never gated; they're externally observable hardware
    // behaviour, not engine state.
    if (a <= 0x007F) {
      // Pattern 5 parameter overrides win over Pattern 3 freezes — overrides
      // actively rewrite the cell, freezes passively drop the write.  The
      // user expects "drag the slider, see the value pinned" to take effect
      // even if the freeze toggle was previously enabled on the same cell.
      const ov = this.paramOverrides.get(a);
      if (ov !== undefined) {
        this.ram[a] = ov & 0xFF;
        this.lastWriteCycle[a] = this.cpu?.cycles ?? 0;
        return;
      }
      const pc = this.cpu?.pc ?? 0;
      if (shouldDiscardWrite(this.toggles, a, this.game, pc)) return;
      // Pattern 4 expansion — ORGAN voice-mute AND-mask transform on
      // OSCIL writes.  Returns `v` unchanged for any other cell or PC.
      this.ram[a] = transformWriteValue(this.toggles, a, this.game, pc, v);
      this.lastWriteCycle[a] = this.cpu?.cycles ?? 0;
      return;
    }
    if (this.hasExtRam && a >= 0x0080 && a <= 0x00FF) {
      const ov = this.paramOverrides.get(a);
      if (ov !== undefined) {
        this.ram[a] = ov & 0xFF;
        this.lastWriteCycle[a] = this.cpu?.cycles ?? 0;
        return;
      }
      const pc = this.cpu?.pc ?? 0;
      if (shouldDiscardWrite(this.toggles, a, this.game, pc)) return;
      this.ram[a] = transformWriteValue(this.toggles, a, this.game, pc, v);
      this.lastWriteCycle[a] = this.cpu?.cycles ?? 0;
      return;
    }
    const piaA = a & 0x7FFF;
    if (piaA >= 0x0400 && piaA <= 0x0403) {
      this.pia.write(piaA - 0x0400, v, this.cpu?.cycles ?? 0, this.cpu?.pc ?? 0);
      return;
    }
    // ROM writes silently ignored (real hardware has no write-back path).
  }

  /**
   * Propagate the PIA's CA1-IRQ line into the CPU's pending-IRQ flag.
   *
   * Call this immediately before `step(cpu, this)` in any host run loop.
   * Conceptually it's the wire from the PIA's IRQA pin to the 6808's /IRQ pin.
   * The PIA clears its own internal CA1 flag when Port-B data is read, so
   * once the IRQ handler has read the command byte the line drops naturally.
   */
  syncInterrupts(cpu: CPUState): void {
    cpu.irqPending = this.pia.isIRQPending();
  }
}
