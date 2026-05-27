/**
 * 6800 ALU primitive tests.  Each helper is tested for flag edge cases
 * (Z=0/Z=1, N=0/N=1, V boundary, C boundary, H boundary) per the
 * "test thoroughly" convention.
 */
import { describe, expect, it } from "vitest";

import {
  aluAdd, aluAnd, aluAsl, aluAsr, aluCom, aluDec, aluEor, aluInc,
  aluLsr, aluNeg, aluOr, aluRol, aluRor, aluSub, aluTst,
} from "../src/cpu/alu.ts";
import { CCR_BITS, ccrHas, CCR_RESET } from "../src/cpu/flags.ts";

const Z = CCR_BITS.Z;
const N = CCR_BITS.N;
const V = CCR_BITS.V;
const C = CCR_BITS.C;
const H = CCR_BITS.H;

describe("aluAdd", () => {
  it("$05 + $03 = $08, flags all clear", () => {
    const r = aluAdd(0x05, 0x03, 0, CCR_RESET);
    expect(r.result).toBe(0x08);
    expect(ccrHas(r.ccr, Z)).toBe(false);
    expect(ccrHas(r.ccr, N)).toBe(false);
    expect(ccrHas(r.ccr, C)).toBe(false);
    expect(ccrHas(r.ccr, V)).toBe(false);
    expect(ccrHas(r.ccr, H)).toBe(false);
  });

  it("$FF + $01 = $00, Z=1 C=1 H=1", () => {
    const r = aluAdd(0xFF, 0x01, 0, CCR_RESET);
    expect(r.result).toBe(0x00);
    expect(ccrHas(r.ccr, Z)).toBe(true);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, H)).toBe(true);
  });

  it("$7F + $01 = $80, V=1 (signed overflow into negative)", () => {
    const r = aluAdd(0x7F, 0x01, 0, CCR_RESET);
    expect(r.result).toBe(0x80);
    expect(ccrHas(r.ccr, V)).toBe(true);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });

  it("$80 + $80 = $00, V=1 C=1 Z=1 (both ops negative, wrap)", () => {
    const r = aluAdd(0x80, 0x80, 0, CCR_RESET);
    expect(r.result).toBe(0x00);
    expect(ccrHas(r.ccr, V)).toBe(true);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });

  it("half-carry: $0F + $01 = $10, H=1", () => {
    const r = aluAdd(0x0F, 0x01, 0, CCR_RESET);
    expect(r.result).toBe(0x10);
    expect(ccrHas(r.ccr, H)).toBe(true);
  });

  it("ADC: $05 + $03 + C=1 = $09", () => {
    const r = aluAdd(0x05, 0x03, 1, CCR_RESET);
    expect(r.result).toBe(0x09);
  });
});

describe("aluSub", () => {
  it("$08 - $03 = $05, no flags", () => {
    const r = aluSub(0x08, 0x03, 0, CCR_RESET);
    expect(r.result).toBe(0x05);
    expect(ccrHas(r.ccr, Z)).toBe(false);
    expect(ccrHas(r.ccr, C)).toBe(false);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });

  it("$03 - $05 = $FE (borrow), C=1 N=1", () => {
    const r = aluSub(0x03, 0x05, 0, CCR_RESET);
    expect(r.result).toBe(0xFE);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });

  it("$05 - $05 = $00, Z=1", () => {
    const r = aluSub(0x05, 0x05, 0, CCR_RESET);
    expect(r.result).toBe(0x00);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });

  it("$80 - $01 = $7F, V=1 (negative-positive overflow)", () => {
    const r = aluSub(0x80, 0x01, 0, CCR_RESET);
    expect(r.result).toBe(0x7F);
    expect(ccrHas(r.ccr, V)).toBe(true);
  });

  it("SBC: $08 - $03 - C=1 = $04", () => {
    const r = aluSub(0x08, 0x03, 1, CCR_RESET);
    expect(r.result).toBe(0x04);
  });
});

describe("aluAnd / aluOr / aluEor", () => {
  it("AND $FF & $0F = $0F", () => {
    const r = aluAnd(0xFF, 0x0F, CCR_RESET);
    expect(r.result).toBe(0x0F);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });
  it("AND result of 0 sets Z", () => {
    const r = aluAnd(0xF0, 0x0F, CCR_RESET);
    expect(r.result).toBe(0);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });
  it("AND result with bit 7 set → N=1", () => {
    const r = aluAnd(0xFF, 0x80, CCR_RESET);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });
  it("OR $0F | $F0 = $FF", () => {
    expect(aluOr(0x0F, 0xF0, CCR_RESET).result).toBe(0xFF);
  });
  it("EOR $AA ^ $55 = $FF", () => {
    expect(aluEor(0xAA, 0x55, CCR_RESET).result).toBe(0xFF);
  });
  it("EOR clears V", () => {
    // Pre-set V
    const ccrWithV = CCR_RESET | V;
    const r = aluEor(0x01, 0x01, ccrWithV);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });
});

describe("aluLsr / aluAsr / aluAsl / aluRor / aluRol", () => {
  it("LSR $81 = $40, C=1, N=0", () => {
    const r = aluLsr(0x81, CCR_RESET);
    expect(r.result).toBe(0x40);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, N)).toBe(false);
  });
  it("LSR $01 = $00, Z=1 C=1", () => {
    const r = aluLsr(0x01, CCR_RESET);
    expect(r.result).toBe(0);
    expect(ccrHas(r.ccr, Z)).toBe(true);
    expect(ccrHas(r.ccr, C)).toBe(true);
  });
  it("ASR preserves bit 7 (sign extend)", () => {
    const r = aluAsr(0x80, CCR_RESET);
    expect(r.result).toBe(0xC0);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });
  it("ASL $80 = $00, C=1", () => {
    const r = aluAsl(0x80, CCR_RESET);
    expect(r.result).toBe(0);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });
  it("ROR rotates through carry", () => {
    const ccrCSet = CCR_RESET | C;
    const r = aluRor(0x00, ccrCSet);
    expect(r.result).toBe(0x80);
    expect(ccrHas(r.ccr, C)).toBe(false);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });
  it("ROL rotates through carry the other way", () => {
    const ccrCSet = CCR_RESET | C;
    const r = aluRol(0x00, ccrCSet);
    expect(r.result).toBe(0x01);
    expect(ccrHas(r.ccr, C)).toBe(false);
  });
});

describe("aluCom / aluNeg", () => {
  it("COM $AA = $55, C always set", () => {
    const r = aluCom(0xAA, CCR_RESET);
    expect(r.result).toBe(0x55);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });
  it("NEG $01 = $FF, C=1", () => {
    const r = aluNeg(0x01, CCR_RESET);
    expect(r.result).toBe(0xFF);
    expect(ccrHas(r.ccr, C)).toBe(true);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });
  it("NEG $00 = $00, C=0", () => {
    const r = aluNeg(0x00, CCR_RESET);
    expect(r.result).toBe(0x00);
    expect(ccrHas(r.ccr, C)).toBe(false);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });
  it("NEG $80 = $80, V=1 (only V-setting input)", () => {
    const r = aluNeg(0x80, CCR_RESET);
    expect(r.result).toBe(0x80);
    expect(ccrHas(r.ccr, V)).toBe(true);
  });
});

describe("aluInc / aluDec / aluTst", () => {
  it("INC $7F = $80, V=1, N=1", () => {
    const r = aluInc(0x7F, CCR_RESET);
    expect(r.result).toBe(0x80);
    expect(ccrHas(r.ccr, V)).toBe(true);
    expect(ccrHas(r.ccr, N)).toBe(true);
  });
  it("INC $FF = $00, Z=1, V=0", () => {
    const r = aluInc(0xFF, CCR_RESET);
    expect(r.result).toBe(0);
    expect(ccrHas(r.ccr, Z)).toBe(true);
    expect(ccrHas(r.ccr, V)).toBe(false);
  });
  it("DEC $80 = $7F, V=1", () => {
    const r = aluDec(0x80, CCR_RESET);
    expect(r.result).toBe(0x7F);
    expect(ccrHas(r.ccr, V)).toBe(true);
  });
  it("DEC $01 = $00, Z=1", () => {
    const r = aluDec(0x01, CCR_RESET);
    expect(r.result).toBe(0);
    expect(ccrHas(r.ccr, Z)).toBe(true);
  });
  it("TST $80 sets N, clears V and C", () => {
    const ccrInit = CCR_RESET | V | C;
    const ccr = aluTst(0x80, ccrInit);
    expect(ccrHas(ccr, N)).toBe(true);
    expect(ccrHas(ccr, V)).toBe(false);
    expect(ccrHas(ccr, C)).toBe(false);
  });
});
