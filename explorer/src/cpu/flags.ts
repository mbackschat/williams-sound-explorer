/**
 * Motorola 6800 Condition Code Register (CCR / status register).
 *
 * Layout (bit 7 -> 0):
 *   1 1 H I N Z V C
 * Bits 7 and 6 always read as 1 on the 6800.  Lower 6 bits are flags:
 *   H  Half-carry  — set on carry from bit 3 in ADD/ADC (BCD support)
 *   I  Interrupt mask — set => IRQ ignored
 *   N  Negative   — set when result bit 7 is 1
 *   Z  Zero       — set when result is 0
 *   V  Overflow   — set on signed-overflow
 *   C  Carry      — set on unsigned carry/borrow
 *
 * Tested independently from the CPU so the helpers can be reused freely.
 */
export const CCR_BITS = {
  H: 1 << 5,
  I: 1 << 4,
  N: 1 << 3,
  Z: 1 << 2,
  V: 1 << 1,
  C: 1 << 0,
} as const;

/** The two reserved top bits always read as 1. */
export const CCR_RESERVED_MASK = 0xC0;

/** Initial CCR after reset: I=1, reserved bits set, others clear. */
export const CCR_RESET = CCR_RESERVED_MASK | CCR_BITS.I;

/** Test whether `ccr` has the bit `bit` set. */
export function ccrHas(ccr: number, bit: number): boolean {
  return (ccr & bit) !== 0;
}

/** Return `ccr` with `bit` set to `value`. */
export function ccrSet(ccr: number, bit: number, value: boolean): number {
  return value ? (ccr | bit) | CCR_RESERVED_MASK : (ccr & ~bit) | CCR_RESERVED_MASK;
}

/** Set the N (negative) and Z (zero) flags from an 8-bit result. */
export function setNZ8(ccr: number, result8: number): number {
  let next = ccr;
  next = ccrSet(next, CCR_BITS.N, (result8 & 0x80) !== 0);
  next = ccrSet(next, CCR_BITS.Z, (result8 & 0xFF) === 0);
  return next;
}

/** Set the N (negative) and Z (zero) flags from a 16-bit result. */
export function setNZ16(ccr: number, result16: number): number {
  let next = ccr;
  next = ccrSet(next, CCR_BITS.N, (result16 & 0x8000) !== 0);
  next = ccrSet(next, CCR_BITS.Z, (result16 & 0xFFFF) === 0);
  return next;
}
