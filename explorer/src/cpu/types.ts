/**
 * Shared types for the 6800 emulator.
 *
 * The register state is kept in a small mutable object passed by reference;
 * opcode handlers update it in place.  This is faster than a class with
 * getters/setters and easier to snapshot for visualisation.
 */

/** Live register and cycle state of the CPU. */
export interface CPUState {
  /** Accumulator A (8 bits). */
  a: number;
  /** Accumulator B (8 bits). */
  b: number;
  /** Index register (16 bits). */
  x: number;
  /** Stack pointer (16 bits, descending). */
  sp: number;
  /** Program counter (16 bits). */
  pc: number;
  /** Condition code register (8 bits; top 2 bits always read as 1). */
  ccr: number;
  /** Total instruction-cycle count since reset (monotonic). */
  cycles: number;
  /** True when the IRQ line is asserted by a peripheral. */
  irqPending: boolean;
  /** True when the NMI line was just edge-triggered (auto-cleared after dispatch). */
  nmiPending: boolean;
  /** True when the CPU is halted waiting on an interrupt (WAI). */
  waiting: boolean;
}

/** The memory-bus interface the CPU sees. */
export interface Bus {
  /** Read one byte at `addr`.  Returns 0..255. */
  read(addr: number): number;
  /** Write one byte at `addr`. */
  write(addr: number, value: number): void;
}

/** Convenience: read a big-endian 16-bit word from `addr`. */
export function readWord(bus: Bus, addr: number): number {
  return (bus.read(addr & 0xFFFF) << 8) | bus.read((addr + 1) & 0xFFFF);
}

/** Convenience: write a big-endian 16-bit word at `addr`. */
export function writeWord(bus: Bus, addr: number, value: number): void {
  bus.write(addr & 0xFFFF, (value >>> 8) & 0xFF);
  bus.write((addr + 1) & 0xFFFF, value & 0xFF);
}
