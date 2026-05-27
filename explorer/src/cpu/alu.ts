/**
 * 6800 ALU primitives — pure functions used by the opcode table.
 *
 * Each helper returns `{ result, ccr }` so opcode handlers stay tiny:
 *
 *   const r = aluAdd(cpu.a, m, 0, cpu.ccr);
 *   cpu.a = r.result;
 *   cpu.ccr = r.ccr;
 *
 * Flag semantics follow the Motorola 6800 datasheet exactly.  Tested
 * independently in `tests/alu.test.ts`.
 */
import { CCR_BITS, ccrSet, setNZ8 } from "./flags.ts";

interface AluResult {
  /** 8-bit result (0..255). */
  result: number;
  /** Updated CCR. */
  ccr: number;
}

/**
 * 8-bit add: A + M + C0.  Used by ADDA/ADDB (C0=0) and ADCA/ADCB (C0=C-flag).
 *
 * Flag effects:
 *   H = carry from bit 3
 *   N = result bit 7
 *   Z = result == 0
 *   V = signed overflow (operands same sign, result opposite)
 *   C = carry from bit 7
 */
export function aluAdd(a8: number, m8: number, c0: number, ccr: number): AluResult {
  const a = a8 & 0xFF;
  const m = m8 & 0xFF;
  const sum = a + m + (c0 ? 1 : 0);
  const result = sum & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  // half-carry: carry out of bit 3
  const halfCarry = ((a & 0x0F) + (m & 0x0F) + (c0 ? 1 : 0)) > 0x0F;
  nextCcr = ccrSet(nextCcr, CCR_BITS.H, halfCarry);
  // overflow: signed overflow occurs when operands have same sign but result differs
  const overflow = (((a ^ m) & 0x80) === 0) && (((a ^ result) & 0x80) !== 0);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, overflow);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, sum > 0xFF);
  return { result, ccr: nextCcr };
}

/**
 * 8-bit subtract: A - M - C0.  Used by SUBA/SUBB (C0=0), SBCA/SBCB (C0=C),
 * and CMPA/CMPB (which discards the result but updates flags).
 *
 * Flag effects (H unaffected):
 *   N = result bit 7
 *   Z = result == 0
 *   V = signed overflow
 *   C = borrow from bit 7
 */
export function aluSub(a8: number, m8: number, c0: number, ccr: number): AluResult {
  const a = a8 & 0xFF;
  const m = m8 & 0xFF;
  const raw = a - m - (c0 ? 1 : 0);
  const result = raw & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  // overflow: operands have different signs and result sign differs from A
  const overflow = (((a ^ m) & 0x80) !== 0) && (((a ^ result) & 0x80) !== 0);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, overflow);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, raw < 0);
  return { result, ccr: nextCcr };
}

/** Bitwise AND.  N/Z set, V cleared, C/H unchanged. */
export function aluAnd(a8: number, m8: number, ccr: number): AluResult {
  const result = (a8 & m8) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, false);
  return { result, ccr: nextCcr };
}

/** Bitwise OR.  N/Z set, V cleared. */
export function aluOr(a8: number, m8: number, ccr: number): AluResult {
  const result = (a8 | m8) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, false);
  return { result, ccr: nextCcr };
}

/** Bitwise XOR.  N/Z set, V cleared. */
export function aluEor(a8: number, m8: number, ccr: number): AluResult {
  const result = (a8 ^ m8) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, false);
  return { result, ccr: nextCcr };
}

/** Logical shift right.  Bit 0 → C, 0 → bit 7.  N always cleared. */
export function aluLsr(m8: number, ccr: number): AluResult {
  const carry = (m8 & 0x01) !== 0;
  const result = (m8 >>> 1) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, carry);
  // V = N XOR C  (per 6800 datasheet for LSR)
  const nFlag = (result & 0x80) !== 0;
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, nFlag !== carry);
  return { result, ccr: nextCcr };
}

/** Arithmetic shift left (= LSL).  Bit 7 → C, 0 → bit 0. */
export function aluAsl(m8: number, ccr: number): AluResult {
  const carry = (m8 & 0x80) !== 0;
  const result = (m8 << 1) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, carry);
  const nFlag = (result & 0x80) !== 0;
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, nFlag !== carry);
  return { result, ccr: nextCcr };
}

/** Arithmetic shift right.  Bit 0 → C, bit 7 preserved. */
export function aluAsr(m8: number, ccr: number): AluResult {
  const carry = (m8 & 0x01) !== 0;
  const result = ((m8 >>> 1) | (m8 & 0x80)) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, carry);
  const nFlag = (result & 0x80) !== 0;
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, nFlag !== carry);
  return { result, ccr: nextCcr };
}

/** Rotate right through carry. */
export function aluRor(m8: number, ccr: number): AluResult {
  const carryIn = (ccr & CCR_BITS.C) !== 0;
  const carryOut = (m8 & 0x01) !== 0;
  const result = ((m8 >>> 1) | (carryIn ? 0x80 : 0)) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, carryOut);
  const nFlag = (result & 0x80) !== 0;
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, nFlag !== carryOut);
  return { result, ccr: nextCcr };
}

/** Rotate left through carry. */
export function aluRol(m8: number, ccr: number): AluResult {
  const carryIn = (ccr & CCR_BITS.C) !== 0;
  const carryOut = (m8 & 0x80) !== 0;
  const result = ((m8 << 1) | (carryIn ? 0x01 : 0)) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, carryOut);
  const nFlag = (result & 0x80) !== 0;
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, nFlag !== carryOut);
  return { result, ccr: nextCcr };
}

/** Complement (one's complement).  N/Z set, V=0, C=1 (per 6800 datasheet). */
export function aluCom(m8: number, ccr: number): AluResult {
  const result = (~m8) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, false);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, true);
  return { result, ccr: nextCcr };
}

/** Negate (two's complement).  Flags per 6800 datasheet. */
export function aluNeg(m8: number, ccr: number): AluResult {
  const m = m8 & 0xFF;
  const result = (0x100 - m) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, m === 0x80);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, m !== 0x00);
  return { result, ccr: nextCcr };
}

/** Increment.  N/Z set, V set if result is $80 (overflow), C unaffected. */
export function aluInc(m8: number, ccr: number): AluResult {
  const result = (m8 + 1) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, result === 0x80);
  return { result, ccr: nextCcr };
}

/** Decrement.  N/Z set, V set if input was $80 (overflow), C unaffected. */
export function aluDec(m8: number, ccr: number): AluResult {
  const result = (m8 - 1) & 0xFF;
  let nextCcr = setNZ8(ccr, result);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, (m8 & 0xFF) === 0x80);
  return { result, ccr: nextCcr };
}

/** Test (used by TST mem/A/B): N/Z set, V/C cleared, no result emitted. */
export function aluTst(m8: number, ccr: number): number {
  let nextCcr = setNZ8(ccr, m8 & 0xFF);
  nextCcr = ccrSet(nextCcr, CCR_BITS.V, false);
  nextCcr = ccrSet(nextCcr, CCR_BITS.C, false);
  return nextCcr;
}
